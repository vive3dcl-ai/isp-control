import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { In } from 'typeorm';
import type { AuthUser } from '../auth/auth.types';
import { TenantConnectionService } from '../database/tenant-connection.service';
import {
  DEFAULT_OLT_PORTS,
  isHuaweiOltDevice,
  isManagedOltDevice,
  OLT_SELECTABLE_SUBTYPES,
} from './olt.constants';
import { ZteOltClient } from './zte-olt.client';
import { ZteOltSnmpClient } from './zte-olt-snmp.client';
import { HuaweiOltClient } from './huawei-olt.client';
import { HuaweiOltSnmpClient } from './huawei-olt-snmp.client';
import type { NetworkDevice } from './entities/network-device.entity';
import type { Onu } from './entities/onu.entity';
import { OnuMetricSample } from './entities/onu-metric-sample.entity';
import { OnuCatalogAdminService } from './onu-catalog-admin.service';
import { normalizeOnuModelName } from './onu-model-catalog';
import {
  OnuTypeOltSyncService,
  type AuthorizeProbeStep,
} from './onu-type-olt-sync.service';
import { vendorFromSn } from './zte-olt-onu-type.util';

export type OnuImportSnapshot = {
  onuIf: string;
  ponType?: string;
  board?: string;
  port?: string;
  onuId?: string;
  sn?: string | null;
  onuType?: string | null;
  name?: string | null;
  description?: string | null;
  status?: string;
  phaseState?: string;
  adminState?: string;
  online?: boolean;
  signalDbm?: number | null;
  mode?: string | null;
  vlan?: number | null;
  vlans?: number[];
};

@Injectable()
export class OnuConnectedService {
  private readonly logger = new Logger(OnuConnectedService.name);
  private readonly pollInFlight = new Set<string>();
  /** Round-robin offset for traffic sampling subsets per OLT. */
  private readonly trafficRoundRobin = new Map<string, number>();
  /** Last IF-MIB octet counters for SNMP delta → bps. */
  private readonly snmpTrafficPrev = new Map<
    string,
    { inOctets: number; outOctets: number; atMs: number }
  >();
  /** Coalesce concurrent live modal refreshes per ONU. */
  private readonly liveRefreshInFlight = new Map<string, Promise<void>>();
  /** Last persisted live sample wall-clock (avoid >~1 write / 3s per ONU). */
  private readonly liveSampleLastWriteMs = new Map<string, number>();
  /** Prevents poll/sync from resurrecting an ONU right after Delete (2 min). */
  private readonly recentlyDeletedUntil = new Map<string, number>();

  constructor(
    private readonly tenantConnections: TenantConnectionService,
    private readonly zteOlt: ZteOltClient,
    private readonly zteSnmp: ZteOltSnmpClient,
    private readonly huaweiOlt: HuaweiOltClient,
    private readonly huaweiSnmp: HuaweiOltSnmpClient,
    private readonly onuCatalog: OnuCatalogAdminService,
    private readonly onuTypeSync: OnuTypeOltSyncService,
  ) {}

  private recentlyDeletedKey(schema: string, kind: 'sn' | 'if', value: string) {
    return `${schema}:${kind}:${value}`;
  }

  private markRecentlyDeleted(
    schema: string,
    oltId: string,
    onuIf: string,
    sn?: string | null,
  ) {
    const until = Date.now() + 120_000;
    this.recentlyDeletedUntil.set(
      this.recentlyDeletedKey(schema, 'if', `${oltId}:${onuIf.toLowerCase()}`),
      until,
    );
    if (sn?.trim()) {
      this.recentlyDeletedUntil.set(
        this.recentlyDeletedKey(schema, 'sn', sn.trim().toUpperCase()),
        until,
      );
    }
  }

  private isRecentlyDeleted(
    schema: string,
    oltId: string,
    onuIf: string,
    sn?: string | null,
  ): boolean {
    const now = Date.now();
    for (const [k, until] of this.recentlyDeletedUntil) {
      if (until <= now) this.recentlyDeletedUntil.delete(k);
    }
    const ifKey = this.recentlyDeletedKey(
      schema,
      'if',
      `${oltId}:${onuIf.toLowerCase()}`,
    );
    if ((this.recentlyDeletedUntil.get(ifKey) ?? 0) > now) return true;
    if (sn?.trim()) {
      const snKey = this.recentlyDeletedKey(
        schema,
        'sn',
        sn.trim().toUpperCase(),
      );
      if ((this.recentlyDeletedUntil.get(snKey) ?? 0) > now) return true;
    }
    return false;
  }

  /** Remove ONU row + links without resurrecting via later poll.save(). */
  private async purgeOnuRow(schema: string, row: Onu): Promise<void> {
    const onuDbId = row.id;
    const sn = row.sn?.toUpperCase() || null;

    const serviceRepo =
      await this.tenantConnections.getClientServiceRepository(schema);
    await serviceRepo
      .createQueryBuilder()
      .update()
      .set({ onuId: null })
      .where('onu_id = :id', { id: onuDbId })
      .execute();

    try {
      const allocRepo =
        await this.tenantConnections.getIpPoolAllocationRepository(schema);
      await allocRepo.delete({ onuId: onuDbId });
      // Liberar huérfanas ligadas a las IPs de esta ONU (por si onu_id ya era NULL).
      for (const ip of [row.mgmtIp, row.wanIp]) {
        if (!ip) continue;
        await allocRepo
          .createQueryBuilder()
          .delete()
          .where('ip_address = :ip', { ip })
          .andWhere('(onu_id IS NULL OR onu_id = :id)', { id: onuDbId })
          .execute();
      }
    } catch (err) {
      this.logger.warn(
        `purgeOnuRow allocations ${onuDbId}: ${
          err instanceof Error ? err.message : err
        }`,
      );
    }

    const onuRepo = await this.tenantConnections.getOnuRepository(schema);
    await onuRepo.delete({ id: onuDbId });

    if (sn) {
      const deniedRepo =
        await this.tenantConnections.getOnuDeniedRepository(schema);
      await deniedRepo.delete({ sn });
    }
  }

  private requireSchema(user: AuthUser): string {
    if (!user.schemaName) {
      throw new BadRequestException('Tenant schema missing from session');
    }
    return user.schemaName;
  }

  private zteConn(device: NetworkDevice) {
    if (!device.mgmtHost || !device.mgmtUsername || !device.mgmtPassword) {
      throw new BadRequestException(
        `OLT «${device.name}» sin credenciales de gestión`,
      );
    }
    const protocol: 'telnet' | 'ssh' =
      device.mgmtProtocol === 'ssh' ? 'ssh' : 'telnet';
    const port =
      device.mgmtPort ??
      (protocol === 'ssh' ? DEFAULT_OLT_PORTS.ssh : DEFAULT_OLT_PORTS.telnet);
    return {
      host: device.mgmtHost,
      port,
      protocol,
      username: device.mgmtUsername,
      password: device.mgmtPassword,
      subtypeHint: device.subtype ?? null,
      firmwareHint: device.metricVersion ?? null,
    };
  }

  /** SNMP RO params — never includes RW community. */
  private snmpConn(device: NetworkDevice): {
    host: string;
    snmpPort: number;
    snmpCommunity: string;
  } | null {
    const community = device.snmpCommunity?.trim();
    if (!device.mgmtHost?.trim() || !community) return null;
    return {
      host: device.mgmtHost.trim(),
      snmpPort: device.snmpPort && device.snmpPort > 0 ? device.snmpPort : 161,
      snmpCommunity: community,
    };
  }

  private oltCli(device: NetworkDevice): ZteOltClient {
    return (isHuaweiOltDevice(device.type, device.subtype)
      ? this.huaweiOlt
      : this.zteOlt) as unknown as ZteOltClient;
  }

  private oltSnmp(device: NetworkDevice): ZteOltSnmpClient {
    return (isHuaweiOltDevice(device.type, device.subtype)
      ? this.huaweiSnmp
      : this.zteSnmp) as unknown as ZteOltSnmpClient;
  }

  private async requireManagedOlt(schema: string, oltId: string) {
    const repo =
      await this.tenantConnections.getNetworkDeviceRepository(schema);
    const olt = await repo.findOne({ where: { id: oltId } });
    if (!olt) throw new NotFoundException('OLT no encontrada');
    if (!isManagedOltDevice(olt.type, olt.subtype)) {
      throw new BadRequestException('Device is not a managed OLT');
    }
    return olt;
  }

  private async listManagedOlts(schema: string): Promise<NetworkDevice[]> {
    const repo =
      await this.tenantConnections.getNetworkDeviceRepository(schema);
    const devices = await repo.find({
      where: {
        subtype: In([...OLT_SELECTABLE_SUBTYPES, 'zte_c3xx']),
      },
      order: { name: 'ASC' },
    });
    return devices.filter((d) => isManagedOltDevice(d.type, d.subtype));
  }

  private withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
    return new Promise((resolve, reject) => {
      const t = setTimeout(
        () => reject(new BadRequestException(`Timeout: ${label}`)),
        ms,
      );
      p.then(
        (v) => {
          clearTimeout(t);
          resolve(v);
        },
        (e) => {
          clearTimeout(t);
          reject(e instanceof Error ? e : new Error(String(e)));
        },
      );
    });
  }

  private formatOnlineDuration(since: Date | null | undefined): string | null {
    if (!since) return null;
    const sec = Math.max(0, Math.floor((Date.now() - since.getTime()) / 1000));
    const d = Math.floor(sec / 86400);
    const h = Math.floor((sec % 86400) / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    return `${d} days, ${h} hours, ${m} minutes, ${s} seconds`;
  }

  private serializeOnu(row: Onu, oltName: string) {
    return {
      id: row.id,
      oltId: row.oltId,
      oltName,
      onuIf: row.onuIf,
      ponType: row.ponType,
      board: row.board,
      port: row.port,
      onuId: row.onuId,
      status: row.status,
      online: row.online,
      phaseState: row.phaseState,
      adminState: row.adminState,
      sn: row.sn,
      onuType: row.onuType,
      name: row.name,
      description: row.description || null,
      signalDbm: row.signalDbm,
      mode: row.mode as 'bridge' | 'router' | null,
      vlan: row.vlan,
      vlans: row.vlans ?? [],
      zone: row.zone,
      zoneId: row.zoneId ?? null,
      odb: row.odb,
      voip: row.voip,
      tv: row.tv,
      authDate: row.authDate?.toISOString() ?? null,
      probedAt: row.lastProbedAt?.toISOString() ?? null,
      onlineSince: row.onlineSince?.toISOString() ?? null,
      onlineDuration: this.formatOnlineDuration(row.onlineSince),
      mgmtIp: row.mgmtIp ?? null,
      mgmtPoolId: row.mgmtPoolId ?? null,
      wanIp: row.wanIp ?? null,
      wanPoolId: row.wanPoolId ?? null,
      tr069ProfileId: row.tr069ProfileId ?? null,
      provisionMode: (row.provisionMode as 'auto' | 'manual') ?? 'auto',
    };
  }

  private applySnapshot(row: Onu, snap: OnuImportSnapshot, now: Date) {
    if (snap.ponType) row.ponType = snap.ponType;
    if (snap.board != null) row.board = snap.board;
    if (snap.port != null) row.port = snap.port;
    if (snap.onuId != null) row.onuId = snap.onuId;
    // Never wipe identity fields with null from a partial probe.
    if (snap.sn) row.sn = snap.sn;
    if (snap.onuType) {
      row.onuType = normalizeOnuModelName(snap.onuType) || snap.onuType;
    }
    // Ignore SmartOLT-style placeholders (ONU-6:1); keep the intended client label.
    if (snap.name && !/^ONU-\d+:\d+$/i.test(snap.name.trim())) {
      row.name = snap.name;
    }
    if (snap.description) row.description = snap.description;
    if (snap.status) row.status = snap.status;
    if (snap.phaseState != null) row.phaseState = snap.phaseState;
    if (snap.adminState != null) row.adminState = snap.adminState;
    if (snap.online != null) {
      const wasOnline = row.online;
      const nextOnline = !!snap.online;
      row.online = nextOnline;
      if (nextOnline) {
        if (!wasOnline) {
          row.onlineSince = now;
        } else if (!row.onlineSince) {
          // Bootstrap after deploy: keep counting from last probe if possible.
          row.onlineSince = row.lastProbedAt ?? now;
        }
      } else {
        row.onlineSince = null;
      }
    }
    // Never wipe a good reading with SNMP null / missing optics.
    if (snap.signalDbm != null && Number.isFinite(snap.signalDbm)) {
      row.signalDbm = snap.signalDbm;
    }
    if (snap.mode) row.mode = snap.mode;
    if (snap.vlan !== undefined && snap.vlan != null) row.vlan = snap.vlan;
    if (snap.vlans?.length) row.vlans = snap.vlans;
    row.lastProbedAt = now;
  }

  private async rememberModel(
    schema: string,
    onuType: string | null | undefined,
  ) {
    if (!onuType?.trim()) return;
    try {
      await this.onuCatalog.ensureModelSeen(schema, onuType);
    } catch (err) {
      this.logger.warn(
        `ensureModelSeen(${onuType}): ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  async suggestImport(user: AuthUser, oltId: string) {
    const schema = this.requireSchema(user);
    const olt = await this.requireManagedOlt(schema, oltId);
    const onuRepo = await this.tenantConnections.getOnuRepository(schema);
    const count = await onuRepo.count({ where: { oltId } });
    return {
      suggestOnuImport:
        olt.connectionStatus === 'connected' &&
        count === 0 &&
        !olt.onusImportPromptedAt,
      importedCount: count,
      promptedAt: olt.onusImportPromptedAt?.toISOString() ?? null,
    };
  }

  async discover(
    user: AuthUser,
    oltId: string,
    opts?: { includeRunningConfig?: boolean; preferSnmp?: boolean },
  ) {
    const schema = this.requireSchema(user);
    const olt = await this.requireManagedOlt(schema, oltId);
    const onuRepo = await this.tenantConnections.getOnuRepository(schema);
    const importedCount = await onuRepo.count({ where: { oltId } });

    const preferSnmp = opts?.preferSnmp !== false;
    const includeRunningConfig = opts?.includeRunningConfig !== false;

    type Snap = {
      onuIf: string;
      ponType?: string;
      board?: string;
      port?: string;
      onuId?: string;
      sn?: string | null;
      onuType?: string | null;
      name?: string | null;
      description?: string | null;
      status?: string;
      phaseState?: string;
      adminState?: string;
      online?: boolean;
      signalDbm?: number | null;
      mode?: string | null;
      vlan?: number | null;
      vlans?: number[];
    };

    let onus: Snap[] = [];
    let probedAt = new Date().toISOString();
    let source: 'snmp' | 'cli' = 'cli';

    const snmp = preferSnmp ? this.snmpConn(olt) : null;
    if (snmp) {
      try {
        const monitored = await this.withTimeout(
          this.oltSnmp(olt).walkOnuMonitor(snmp),
          45_000,
          `SNMP discover ${olt.name}`,
        );
        if (monitored.ok && monitored.onus.length > 0) {
          source = 'snmp';
          probedAt = monitored.probedAt;
          onus = monitored.onus.map((o) => ({
            onuIf: o.onuIf,
            ponType: o.onuIf.startsWith('epon') ? 'epon' : 'gpon',
            board: o.slot,
            port: o.port,
            onuId: o.onuId,
            sn: o.sn,
            onuType: null,
            name: o.name,
            description: null,
            status: o.status,
            phaseState: o.phaseState ?? undefined,
            adminState: undefined,
            online: o.online,
            signalDbm: o.signalDbm,
            mode: null,
            vlan: null,
            vlans: [],
          }));
          this.logger.log(
            `Discover ${olt.name}: SNMP ${monitored.source} → ${onus.length} ONUs`,
          );
        }
      } catch (err) {
        this.logger.warn(
          `Discover ${olt.name}: SNMP miss — CLI fallback: ${
            err instanceof Error ? err.message : err
          }`,
        );
      }
    }

    if (!onus.length) {
      const result = await this.withTimeout(
        this.oltCli(olt).listConnectedOnus({
          ...this.zteConn(olt),
          // Sync/reconcile needs inventory, not full running-config names.
          includeRunningConfig: source === 'cli' ? includeRunningConfig : false,
        }),
        includeRunningConfig ? 300_000 : 180_000,
        `Discover ONUs ${olt.name}`,
      );
      if (!result.ok) {
        throw new BadRequestException(
          result.error || 'No se pudieron descubrir ONUs',
        );
      }
      probedAt = result.probedAt;
      onus = result.onus.map((o) => ({
        onuIf: o.onuIf,
        ponType: o.ponType,
        board: o.board,
        port: o.port,
        onuId: o.onuId,
        sn: o.sn,
        onuType: o.onuType,
        name: o.name,
        description: o.description,
        status: o.status,
        phaseState: o.phaseState,
        adminState: o.adminState,
        online: o.online,
        signalDbm: o.signalDbm,
        mode: o.mode,
        vlan: o.vlan,
        vlans: o.vlans,
      }));
    }

    const portMap = new Map<
      string,
      {
        ifName: string;
        board: string;
        port: string;
        count: number;
        online: number;
      }
    >();
    for (const o of onus) {
      const oltIf = o.onuIf.replace(/-onu_/i, '-olt_').replace(/:\d+$/, '');
      const cur = portMap.get(oltIf) ?? {
        ifName: oltIf,
        board: o.board ?? '',
        port: o.port ?? '',
        count: 0,
        online: 0,
      };
      cur.count += 1;
      if (o.online) cur.online += 1;
      portMap.set(oltIf, cur);
    }

    return {
      oltId: olt.id,
      oltName: olt.name,
      probedAt,
      source,
      total: onus.length,
      online: onus.filter((o) => o.online).length,
      importedCount,
      suggestOnuImport: importedCount === 0 && !olt.onusImportPromptedAt,
      ports: [...portMap.values()].sort((a, b) =>
        a.ifName.localeCompare(b.ifName, undefined, { numeric: true }),
      ),
      onus,
    };
  }

  async importSkip(user: AuthUser, oltId: string) {
    const schema = this.requireSchema(user);
    const olt = await this.requireManagedOlt(schema, oltId);
    const repo =
      await this.tenantConnections.getNetworkDeviceRepository(schema);
    olt.onusImportPromptedAt = new Date();
    await repo.save(olt);
    return { ok: true };
  }

  async importOne(user: AuthUser, oltId: string, snap: OnuImportSnapshot) {
    const schema = this.requireSchema(user);
    await this.requireManagedOlt(schema, oltId);
    if (!snap.onuIf?.trim()) {
      throw new BadRequestException('onuIf requerido');
    }
    const onuIf = snap.onuIf.trim();
    const onuRepo = await this.tenantConnections.getOnuRepository(schema);
    const now = new Date();
    let row = await onuRepo.findOne({ where: { oltId, onuIf } });
    const isNew = !row;
    if (!row) {
      row = onuRepo.create({
        oltId,
        onuIf,
        ponType: snap.ponType ?? 'gpon',
        board: snap.board ?? '',
        port: snap.port ?? '',
        onuId: snap.onuId ?? '',
        description: '',
        status: 'other',
        phaseState: '',
        adminState: '',
        online: false,
        vlans: [],
        authDate: now,
      });
    }
    this.applySnapshot(row, snap, now);
    if (isNew && !row.authDate) row.authDate = now;
    await onuRepo.save(row);
    await this.rememberModel(schema, row.onuType);

    const devices =
      await this.tenantConnections.getNetworkDeviceRepository(schema);
    const olt = await devices.findOne({ where: { id: oltId } });
    if (olt && !olt.onusImportPromptedAt) {
      olt.onusImportPromptedAt = now;
      await devices.save(olt);
    }

    return {
      ok: true,
      created: isNew,
      onu: this.serializeOnu(row, olt?.name ?? ''),
    };
  }

  /**
   * List ONUs waiting for authorization (uncfg) on one or all ZTE OLTs.
   * Excludes manually denied SNs and SNs already authorized on the same OLT.
   * Bloqueadas = solo denylist de huérfanas; no se mezcla con disable en Conectadas.
   */
  async listUncfg(user: AuthUser, oltId?: string) {
    const schema = this.requireSchema(user);
    const olts = oltId
      ? [await this.requireManagedOlt(schema, oltId)]
      : await this.listManagedOlts(schema);

    const onus: Array<{
      oltId: string;
      oltName: string;
      oltIf: string;
      onuIfHint: string | null;
      sn: string;
      state: string | null;
      ponType: string;
      board: string;
      port: string;
      suggestedOnuId: number | null;
      /** SN also exists in Conectadas (posible registro obsoleto). */
      inConnected: boolean;
    }> = [];
    const errors: Array<{ oltId: string; oltName: string; error: string }> = [];

    const deniedRepo =
      await this.tenantConnections.getOnuDeniedRepository(schema);
    const onuRepo = await this.tenantConnections.getOnuRepository(schema);

    const knownRows = await onuRepo
      .createQueryBuilder('o')
      .select(['o.id', 'o.oltId', 'o.sn'])
      .where('o.sn IS NOT NULL')
      .andWhere("o.sn <> ''")
      .getMany();
    const knownByOltSn = new Map<string, Set<string>>();
    const knownBySn = new Set<string>();
    for (const r of knownRows) {
      const sn = r.sn?.trim().toUpperCase();
      if (!sn) continue;
      knownBySn.add(sn);
      const set = knownByOltSn.get(r.oltId) ?? new Set<string>();
      set.add(sn);
      knownByOltSn.set(r.oltId, set);
    }

    // Stale denylist: SN already in Conectadas must not stay in Bloqueadas
    await this.purgeDeniedAlreadyConnected(deniedRepo, knownBySn);

    const deniedRows = await deniedRepo.find();
    const deniedSn = new Set(deniedRows.map((d) => d.sn.toUpperCase()));

    let rawUncfg = 0;
    let alsoInConnected = 0;
    let hiddenDenied = 0;

    for (const olt of olts) {
      if (!olt.mgmtHost || !olt.mgmtUsername || !olt.mgmtPassword) {
        errors.push({
          oltId: olt.id,
          oltName: olt.name,
          error: 'Sin credenciales de gestión',
        });
        continue;
      }
      try {
        const result = await this.withTimeout(
          this.oltCli(olt).listUncfgOnus(this.zteConn(olt)),
          300_000,
          `Uncfg ${olt.name}`,
        );
        if (!result.ok) {
          errors.push({
            oltId: olt.id,
            oltName: olt.name,
            error: result.error || 'Fallo uncfg',
          });
          continue;
        }
        const knownOnThisOlt = knownByOltSn.get(olt.id) ?? new Set<string>();
        for (const u of result.onus) {
          rawUncfg += 1;
          const sn = u.sn.trim().toUpperCase();
          if (!sn) continue;
          // Denylist only — OLT uncfg is source of truth (even if SN still in DB).
          if (deniedSn.has(sn)) {
            hiddenDenied += 1;
            continue;
          }
          const inConnected = knownOnThisOlt.has(sn);
          if (inConnected) alsoInConnected += 1;
          onus.push({
            oltId: olt.id,
            oltName: olt.name,
            oltIf: u.oltIf,
            onuIfHint: u.onuIfHint,
            sn: u.sn,
            state: u.state,
            ponType: u.ponType,
            board: u.board,
            port: u.port,
            suggestedOnuId: u.suggestedOnuId,
            inConnected,
          });
        }
      } catch (err) {
        errors.push({
          oltId: olt.id,
          oltName: olt.name,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const deniedCount = await deniedRepo.count();

    this.logger.log(
      `uncfg list: raw=${rawUncfg} shown=${onus.length} alsoInConnected=${alsoInConnected} hiddenDenied=${hiddenDenied} errors=${errors.length}`,
    );

    return {
      onus,
      olts: olts.map((o) => ({ id: o.id, name: o.name })),
      errors,
      total: onus.length,
      deniedCount,
      rawUncfg,
      alsoInConnected,
      probedAt: new Date().toISOString(),
    };
  }

  async listDenied(user: AuthUser) {
    const schema = this.requireSchema(user);
    const deniedRepo =
      await this.tenantConnections.getOnuDeniedRepository(schema);
    const onuRepo = await this.tenantConnections.getOnuRepository(schema);

    const knownRows = await onuRepo
      .createQueryBuilder('o')
      .select(['o.sn'])
      .where('o.sn IS NOT NULL')
      .andWhere("o.sn <> ''")
      .getMany();
    const knownBySn = new Set(
      knownRows
        .map((r) => r.sn?.trim().toUpperCase())
        .filter((sn): sn is string => !!sn),
    );
    await this.purgeDeniedAlreadyConnected(deniedRepo, knownBySn);

    const rows = await deniedRepo.find({ order: { deniedAt: 'DESC' } });
    return {
      denied: rows.map((r) => ({
        id: r.id,
        sn: r.sn,
        oltId: r.oltId,
        oltIf: r.oltIf,
        oltName: r.oltName,
        board: r.board,
        port: r.port,
        ponType: r.ponType,
        note: r.note,
        deniedAt: r.deniedAt.toISOString(),
      })),
      total: rows.length,
    };
  }

  async denyOrphan(
    user: AuthUser,
    body: {
      sn: string;
      oltId?: string | null;
      oltIf?: string | null;
      oltName?: string | null;
      board?: string | null;
      port?: string | null;
      ponType?: string | null;
      note?: string | null;
    },
  ) {
    const schema = this.requireSchema(user);
    const sn = body.sn?.trim().toUpperCase();
    if (!sn) throw new BadRequestException('sn requerido');

    const onuRepo = await this.tenantConnections.getOnuRepository(schema);
    const inConnected = await onuRepo
      .createQueryBuilder('o')
      .where('UPPER(o.sn) = :sn', { sn })
      .getCount();
    if (inConnected > 0) {
      throw new BadRequestException(
        `El SN ${sn} ya está en Conectadas. Usa Disable / Delete desde el detalle; Bloqueadas es solo para huérfanas.`,
      );
    }

    const deniedRepo =
      await this.tenantConnections.getOnuDeniedRepository(schema);
    let row = await deniedRepo.findOne({ where: { sn } });
    const now = new Date();
    if (!row) {
      row = deniedRepo.create({
        sn,
        oltId: body.oltId ?? null,
        oltIf: body.oltIf ?? null,
        oltName: body.oltName ?? null,
        board: body.board ?? null,
        port: body.port ?? null,
        ponType: body.ponType ?? null,
        note: body.note ?? null,
        deniedAt: now,
      });
    } else {
      row.oltId = body.oltId ?? row.oltId;
      row.oltIf = body.oltIf ?? row.oltIf;
      row.oltName = body.oltName ?? row.oltName;
      row.board = body.board ?? row.board;
      row.port = body.port ?? row.port;
      row.ponType = body.ponType ?? row.ponType;
      if (body.note !== undefined) row.note = body.note;
      row.deniedAt = now;
    }
    await deniedRepo.save(row);
    return {
      ok: true,
      message: `SN ${sn} denegado; no aparecerá en Huérfanas`,
      denied: {
        id: row.id,
        sn: row.sn,
        oltId: row.oltId,
        oltIf: row.oltIf,
        oltName: row.oltName,
        board: row.board,
        port: row.port,
        ponType: row.ponType,
        note: row.note,
        deniedAt: row.deniedAt.toISOString(),
      },
    };
  }

  async undeny(user: AuthUser, id: string) {
    const schema = this.requireSchema(user);
    const deniedRepo =
      await this.tenantConnections.getOnuDeniedRepository(schema);
    const row = await deniedRepo.findOne({ where: { id } });
    if (!row) throw new NotFoundException('SN denegado no encontrado');
    const sn = row.sn;

    await deniedRepo.remove(row);
    return {
      ok: true,
      message: `SN ${sn} quitado de bloqueadas; volverá a Huérfanas si sigue en uncfg`,
      sn,
    };
  }

  /**
   * Authorize ONU on OLT by SN, then import into Conectadas.
   * Probes ONU-type profiles (by SN vendor) until the OLT accepts one,
   * then silently reads SW equip to learn the real model.
   */
  async authorize(
    user: AuthUser,
    body: {
      oltId: string;
      oltIf: string;
      onuId: string | number;
      sn: string;
      onuType?: string | null;
      name?: string | null;
      description?: string | null;
    },
  ) {
    const schema = this.requireSchema(user);
    const olt = await this.requireManagedOlt(schema, body.oltId);
    const oltIf = body.oltIf?.trim();
    const onuId = String(body.onuId ?? '').trim();
    const sn = body.sn?.trim().toUpperCase();
    const preferred = body.onuType?.trim() || null;
    if (!oltIf || !onuId || !sn) {
      throw new BadRequestException('oltIf, onuId y sn son requeridos');
    }

    const ponType: 'gpon' | 'epon' = oltIf.startsWith('epon') ? 'epon' : 'gpon';
    if (isHuaweiOltDevice(olt.type, olt.subtype)) {
      const steps: AuthorizeProbeStep[] = [];
      try {
        const sync = await this.onuTypeSync.syncTypesForConnectedOlt(
          schema,
          olt,
        );
        steps.push({
          step: 'sync_types',
          status: sync.ok ? 'ok' : 'fail',
          message: sync.ok
            ? `Perfiles OLT sincronizados (${sync.steps.length} pasos)`
            : sync.error || 'Sync parcial de perfiles',
        });
      } catch (err) {
        steps.push({
          step: 'sync_types',
          status: 'skip',
          message:
            err instanceof Error ? err.message : 'Sync de perfiles omitido',
        });
      }

      const candidates = await this.onuTypeSync.buildAuthorizeCandidates(
        schema,
        sn,
        ponType,
        preferred,
      );
      const tryTypes = candidates.length
        ? candidates.map((c) => c.name)
        : [preferred || '10'];

      let lastError = '';
      let authorizedType: string | null = null;
      let canonical: string | null = null;

      for (const typeName of tryTypes) {
        const ensured = await this.onuTypeSync.ensureTypeOnOlt(olt, {
          name: typeName,
          ponType,
          ethernetPorts: 4,
          wifiSsids: 0,
          voipPorts: 0,
          catv: false,
        });
        steps.push({
          step: 'ensure_type',
          status: ensured.ok ? 'ok' : 'fail',
          message: ensured.ok
            ? ('message' in ensured ? ensured.message : undefined) ||
              `Perfil «${typeName}» listo`
            : ('error' in ensured ? ensured.error : undefined) ||
              `No se pudo asegurar «${typeName}»`,
          typeName,
        });
        if (!ensured.ok) {
          lastError =
            ('error' in ensured ? ensured.error : undefined) || lastError;
          continue;
        }

        const result = await this.withTimeout(
          this.huaweiOlt.authorizeOnu({
            ...this.zteConn(olt),
            oltIf,
            onuId,
            onuType: typeName,
            sn,
            name: body.name,
          }),
          90_000,
          `Authorize ${sn} on Huawei (${typeName})`,
        );
        if (!result.ok) {
          lastError = result.error || lastError;
          steps.push({
            step: 'try_type',
            status: 'fail',
            message: result.error || `Falló con «${typeName}»`,
            typeName,
          });
          continue;
        }
        authorizedType = typeName;
        const baseIf = oltIf.replace(/-olt_/i, '-onu_');
        const onuIf = baseIf.includes(':') ? baseIf : `${baseIf}:${onuId}`;
        const parts = onuIf.match(
          /^(gpon|epon)-onu_(\d+)\/(\d+)\/(\d+):(\d+)$/i,
        );
        canonical = parts
          ? `${parts[1].toLowerCase()}-onu_${parts[2]}/${parts[3]}/${parts[4]}:${parts[5]}`
          : onuIf;
        steps.push({
          step: 'done',
          status: 'ok',
          message: `Autorizada con perfil «${typeName}»`,
          typeName,
        });
        break;
      }

      if (!authorizedType || !canonical) {
        throw new BadRequestException(
          lastError ||
            'No se pudo autorizar la ONU en Huawei con los perfiles disponibles',
        );
      }

      const parts = canonical.match(
        /^(?:gpon|epon)-onu_(\d+)\/(\d+)\/(\d+):(\d+)$/i,
      );
      const imported = await this.importOne(user, body.oltId, {
        onuIf: canonical,
        ponType,
        board: parts?.[2] ?? '',
        port: parts?.[3] ?? '',
        onuId,
        sn,
        onuType: authorizedType,
        name: body.name?.trim() || null,
        description: body.description?.trim() || null,
        status: 'online',
        phaseState: 'working',
        adminState: 'enable',
        online: true,
      });
      const deniedRepo =
        await this.tenantConnections.getOnuDeniedRepository(schema);
      await deniedRepo.delete({ sn });
      return {
        ok: true,
        message: `ONU ${sn} autorizada`,
        onuIf: canonical,
        onu: imported.onu,
        authorizedType,
        detectedModel: authorizedType,
        steps,
      };
    }
    const steps: AuthorizeProbeStep[] = [];
    const snVendor = vendorFromSn(sn);

    steps.push({
      step: 'sync_types',
      status: 'info',
      message: `SN ${sn} → vendor ${snVendor}; sincronizando perfiles…`,
    });
    try {
      const sync = await this.onuTypeSync.syncTypesForConnectedOlt(schema, olt);
      steps.push({
        step: 'sync_types',
        status: sync.ok ? 'ok' : 'fail',
        message: sync.ok
          ? `Perfiles OLT sincronizados (${sync.steps.length} pasos)`
          : sync.error || 'Sync parcial de perfiles',
      });
    } catch (err) {
      steps.push({
        step: 'sync_types',
        status: 'skip',
        message:
          err instanceof Error ? err.message : 'Sync de perfiles omitido',
      });
    }

    const candidates = await this.onuTypeSync.buildAuthorizeCandidates(
      schema,
      sn,
      ponType,
      preferred,
    );
    if (!candidates.length) {
      throw new BadRequestException(
        'No hay tipos ONU en el catálogo/tenant para probar. Agrega tipos en Ajustes → ONUs o en Admin.',
      );
    }

    let authorizedType: string | null = null;
    let onuIf: string | null = null;
    let lastError = '';

    for (const cand of candidates) {
      const ensured = await this.onuTypeSync.ensureTypeOnOlt(olt, cand.spec);
      steps.push({
        step: 'ensure_type',
        status: ensured.ok ? 'ok' : 'fail',
        message: ensured.ok
          ? ('message' in ensured ? ensured.message : undefined) ||
            `Type «${cand.name}» listo en OLT`
          : ('error' in ensured ? ensured.error : undefined) ||
            `No se pudo crear «${cand.name}» en OLT`,
        typeName: cand.name,
      });
      if (!ensured.ok) {
        lastError =
          ('error' in ensured ? ensured.error : undefined) || lastError;
        continue;
      }

      steps.push({
        step: 'try_type',
        status: 'info',
        message: `Probando type «${cand.name}»…`,
        typeName: cand.name,
      });

      const result = await this.withTimeout(
        this.zteOlt.authorizeOnu({
          ...this.zteConn(olt),
          oltIf,
          onuId,
          onuType: cand.name,
          sn,
          name: body.name,
          description: body.description,
        }),
        90_000,
        `Authorize ${sn} as ${cand.name}`,
      );

      if (result.ok && result.onuIf) {
        authorizedType = cand.name;
        onuIf = result.onuIf;
        steps.push({
          step: 'try_type',
          status: 'ok',
          message: `OLT aceptó «${cand.name}»`,
          typeName: cand.name,
        });
        break;
      }

      lastError = result.error || `Rechazado type «${cand.name}»`;
      steps.push({
        step: 'try_type',
        status: 'fail',
        message: lastError,
        typeName: cand.name,
      });
    }

    if (!authorizedType || !onuIf) {
      throw new BadRequestException(
        `No se pudo autorizar ${sn}. Se probaron ${candidates.length} type(s) (${snVendor}). ` +
          `Último error: ${lastError || 'desconocido'}`,
      );
    }

    // Silent SW equip → real model (best-effort)
    let displayType = authorizedType;
    await new Promise((r) => setTimeout(r, 4_000));
    try {
      const sw = await this.withTimeout(
        this.zteOlt.getOnuSwInfo({
          ...this.zteConn(olt),
          onuIf,
        }),
        45_000,
        `SW info ${onuIf}`,
      );
      const rawModel =
        sw.ok && sw.equip
          ? normalizeOnuModelName(sw.equip.model || sw.equip.equipId || '')
          : '';
      if (rawModel) {
        steps.push({
          step: 'sw_info',
          status: 'ok',
          message: `SW info: modelo «${rawModel}»`,
          model: rawModel,
          typeName: authorizedType,
        });
        displayType = rawModel;
        await this.onuCatalog.ensureModelSeen(schema, rawModel);

        if (rawModel.toLowerCase() !== authorizedType.toLowerCase()) {
          // Only push if we already have a real profile (catalog or tenant)
          const catalogItem = await this.onuCatalog.getByModelName(rawModel);
          const typeRepo =
            await this.tenantConnections.getOnuTypeRepository(schema);
          const tenantType = await typeRepo
            .createQueryBuilder('t')
            .where('LOWER(t.name) = LOWER(:name)', { name: rawModel })
            .getOne();

          const knownProfile =
            (catalogItem &&
              catalogItem.registrationStatus === 'approved' &&
              catalogItem.isActive) ||
            tenantType;

          if (knownProfile) {
            const spec = tenantType
              ? {
                  name: rawModel,
                  ponType,
                  ethernetPorts: tenantType.ethernetPorts || 1,
                  wifiSsids: tenantType.wifiSsids || 0,
                  voipPorts: tenantType.voipPorts || 0,
                  catv: !!tenantType.catv,
                  description: null as string | null,
                }
              : {
                  name: rawModel,
                  ponType:
                    catalogItem!.ponType === 'epon'
                      ? ('epon' as const)
                      : ponType,
                  ethernetPorts: catalogItem!.ethernetPorts || 1,
                  wifiSsids: catalogItem!.wifiSsids || 0,
                  voipPorts: catalogItem!.voipPorts || 0,
                  catv: !!catalogItem!.catv,
                  description: catalogItem!.note || null,
                };

            const created = await this.onuTypeSync.ensureTypeOnOlt(olt, spec);
            steps.push({
              step: 'create_real_type',
              status: created.ok ? 'ok' : 'skip',
              message: created.ok
                ? created.created
                  ? `Perfil «${rawModel}» empujado a la OLT (auth quedó con «${authorizedType}»)`
                  : `Perfil «${rawModel}» ya existía en la OLT`
                : `No se pudo empujar «${rawModel}»; se mantiene «${authorizedType}»`,
              model: rawModel,
              typeName: authorizedType,
            });
          } else {
            steps.push({
              step: 'create_real_type',
              status: 'skip',
              message: `Modelo «${rawModel}» no está en nuestro catálogo aún (queda pendiente); auth con «${authorizedType}»`,
              model: rawModel,
              typeName: authorizedType,
            });
          }
        }
      } else {
        steps.push({
          step: 'sw_info',
          status: 'skip',
          message: 'SW info sin modelo aún (OMCI); se deja el type que dio OK',
          typeName: authorizedType,
        });
      }
    } catch (err) {
      steps.push({
        step: 'sw_info',
        status: 'skip',
        message:
          err instanceof Error
            ? `SW info omitido: ${err.message}`
            : 'SW info omitido',
        typeName: authorizedType,
      });
    }

    const parts = onuIf.match(/^(?:gpon|epon)-onu_(\d+)\/(\d+)\/(\d+):(\d+)$/i);
    const imported = await this.importOne(user, body.oltId, {
      onuIf,
      ponType,
      board: parts?.[2] ?? '',
      port: parts?.[3] ?? '',
      onuId: parts?.[4] ?? onuId,
      sn,
      onuType: displayType,
      name: body.name?.trim() || null,
      description: body.description?.trim() || null,
      status: 'online',
      phaseState: 'working',
      adminState: 'enable',
      online: true,
    });

    const deniedRepo =
      await this.tenantConnections.getOnuDeniedRepository(schema);
    await deniedRepo.delete({ sn });

    steps.push({
      step: 'done',
      status: 'ok',
      message: `ONU ${sn} autorizada como ${onuIf} (type OLT: ${authorizedType}${
        displayType !== authorizedType ? `, modelo: ${displayType}` : ''
      })`,
      typeName: authorizedType,
      model: displayType,
    });

    return {
      ok: true,
      message: steps[steps.length - 1]?.message ?? `ONU ${sn} autorizada`,
      onuIf,
      onu: imported.onu,
      authorizedType,
      detectedModel: displayType,
      steps,
    };
  }

  /** Insert-or-update denied SN without unique-constraint races. */
  private async upsertDeniedSn(
    deniedRepo: Awaited<
      ReturnType<TenantConnectionService['getOnuDeniedRepository']>
    >,
    data: {
      sn: string;
      oltId: string | null;
      oltIf: string | null;
      oltName: string | null;
      board: string | null;
      port: string | null;
      ponType: string | null;
      note: string | null;
    },
  ) {
    const sn = data.sn.toUpperCase();
    let row = await deniedRepo.findOne({ where: { sn } });
    const now = new Date();
    if (!row) {
      row = deniedRepo.create({
        sn,
        oltId: data.oltId,
        oltIf: data.oltIf,
        oltName: data.oltName,
        board: data.board,
        port: data.port,
        ponType: data.ponType,
        note: data.note,
        deniedAt: now,
      });
    } else {
      row.oltId = data.oltId ?? row.oltId;
      row.oltIf = data.oltIf ?? row.oltIf;
      row.oltName = data.oltName ?? row.oltName;
      row.board = data.board ?? row.board;
      row.port = data.port ?? row.port;
      row.ponType = data.ponType ?? row.ponType;
      row.note = data.note ?? row.note;
      row.deniedAt = now;
    }
    try {
      await deniedRepo.save(row);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!/uq_onu_denied_sn|duplicate key/i.test(msg)) throw err;
      // Concurrent insert won the race — treat as ok.
    }
  }

  /**
   * Bloqueadas must not include SNs already in Conectadas.
   * Clears stale rows left by older disable/auto-block logic (e.g. HWTC…).
   */
  private async purgeDeniedAlreadyConnected(
    deniedRepo: Awaited<
      ReturnType<TenantConnectionService['getOnuDeniedRepository']>
    >,
    knownBySn: Set<string>,
  ): Promise<number> {
    if (knownBySn.size === 0) return 0;
    const deniedRows = await deniedRepo.find();
    let removed = 0;
    for (const d of deniedRows) {
      if (knownBySn.has(d.sn.toUpperCase())) {
        await deniedRepo.remove(d);
        removed += 1;
      }
    }
    return removed;
  }

  async list(user: AuthUser) {
    const schema = this.requireSchema(user);
    const olts = await this.listManagedOlts(schema);
    const oltName = new Map(olts.map((o) => [o.id, o.name]));
    const onuRepo = await this.tenantConnections.getOnuRepository(schema);
    const rows = await onuRepo.find({ order: { onuIf: 'ASC' } });
    const onus = rows.map((r) =>
      this.serializeOnu(r, oltName.get(r.oltId) ?? 'OLT'),
    );
    return {
      onus,
      olts: olts.map((o) => ({ id: o.id, name: o.name })),
      errors: [] as Array<{ oltId: string; oltName: string; error: string }>,
      total: onus.length,
      online: onus.filter((o) => o.online).length,
      message:
        olts.length === 0
          ? 'No hay OLTs ZTE en topología.'
          : onus.length === 0
            ? 'No hay ONUs importadas. Prueba la conexión de una OLT para importarlas.'
            : null,
      fromDatabase: true,
    };
  }

  async sync(user: AuthUser, oltId: string) {
    const schema = this.requireSchema(user);
    const olt = await this.requireManagedOlt(schema, oltId);
    // Prefer SNMP for speed; CLI only if SNMP unavailable.
    const discovered = await this.discover(user, oltId, {
      preferSnmp: true,
      includeRunningConfig: false,
    });
    const onuRepo = await this.tenantConnections.getOnuRepository(schema);
    const existing = await onuRepo.find({ where: { oltId } });
    const byIf = new Map(existing.map((e) => [e.onuIf.toLowerCase(), e]));
    const bySn = new Map(
      existing.filter((e) => e.sn).map((e) => [e.sn!.toUpperCase(), e]),
    );
    const seen = new Set<string>();
    const now = new Date();
    let updated = 0;
    let added = 0;
    let removed = 0;

    for (const snap of discovered.onus) {
      if (this.isRecentlyDeleted(schema, oltId, snap.onuIf, snap.sn ?? null)) {
        this.logger.log(
          `sync skip recently deleted ${snap.onuIf} (${snap.sn ?? 'sin SN'})`,
        );
        continue;
      }
      seen.add(snap.onuIf.toLowerCase());
      let row =
        byIf.get(snap.onuIf.toLowerCase()) ||
        (snap.sn ? bySn.get(snap.sn.toUpperCase()) : undefined);
      if (!row) {
        row = onuRepo.create({
          oltId,
          onuIf: snap.onuIf,
          description: '',
          vlans: [],
          authDate: now,
        });
        added += 1;
      } else {
        updated += 1;
        // Keep stable onuIf if we matched by SN with a slightly different ifName.
        if (row.onuIf.toLowerCase() !== snap.onuIf.toLowerCase()) {
          seen.add(row.onuIf.toLowerCase());
        }
      }
      this.applySnapshot(row, snap, now);
      await onuRepo.save(row);
    }

    const models = new Set(
      discovered.onus
        .map((o) => o.onuType)
        .filter((t): t is string => Boolean(t?.trim())),
    );
    for (const m of models) {
      await this.rememberModel(schema, m);
    }

    // Absent from OLT inventory ⇒ not authorized anymore. Remove from Conectadas
    // (soft-offline used to keep the SN and hide it from Huérfanas forever).
    for (const row of existing) {
      if (seen.has(row.onuIf.toLowerCase())) continue;
      await this.purgeOnuRow(schema, row);
      removed += 1;
    }

    return {
      ok: true,
      oltId,
      oltName: olt.name,
      source: discovered.source,
      totalLive: discovered.total,
      updated,
      added,
      missing: removed,
      removed,
      probedAt: discovered.probedAt,
    };
  }

  async refresh(user: AuthUser, id: string) {
    const schema = this.requireSchema(user);
    const onuRepo = await this.tenantConnections.getOnuRepository(schema);
    const row = await onuRepo.findOne({ where: { id } });
    if (!row) throw new NotFoundException('ONU no encontrada');
    const olt = await this.requireManagedOlt(schema, row.oltId);

    const result = await this.withTimeout(
      this.oltCli(olt).getConnectedOnuDetail({
        ...this.zteConn(olt),
        onuIf: row.onuIf,
      }),
      120_000,
      `Refresh ${row.onuIf}`,
    );
    if (!result.ok || !result.onu) {
      throw new BadRequestException(
        result.error || 'No se pudo refrescar la ONU',
      );
    }
    const o = result.onu;
    const now = new Date();
    this.applySnapshot(
      row,
      {
        onuIf: o.onuIf,
        ponType: o.ponType,
        board: o.board,
        port: o.port,
        onuId: o.onuId,
        sn: o.sn,
        onuType: o.onuType,
        name: o.name,
        description: o.description,
        status: o.status,
        phaseState: o.phaseState,
        adminState: o.adminState,
        online: o.online,
        signalDbm: o.signalDbm,
        mode: o.mode,
        vlan: o.vlan,
        vlans: o.vlans,
      },
      now,
    );
    await onuRepo.save(row);

    const sampleRepo =
      await this.tenantConnections.getOnuMetricSampleRepository(schema);
    const toSave: Array<{ kind: string; value: number }> = [];
    if (o.signalDbm != null && Number.isFinite(o.signalDbm)) {
      toSave.push({ kind: 'signal', value: o.signalDbm });
    }
    if (o.downloadBps != null && Number.isFinite(o.downloadBps)) {
      toSave.push({ kind: 'rx_bps', value: o.downloadBps });
    }
    if (o.uploadBps != null && Number.isFinite(o.uploadBps)) {
      toSave.push({ kind: 'tx_bps', value: o.uploadBps });
    }
    if (toSave.length) {
      await sampleRepo.save(
        toSave.map((s) =>
          sampleRepo.create({
            onuId: row.id,
            kind: s.kind,
            value: s.value,
            sampledAt: now,
          }),
        ),
      );
    }

    return {
      probedAt: result.probedAt,
      onu: {
        ...this.serializeOnu(row, olt.name),
        downloadBps: o.downloadBps ?? null,
        uploadBps: o.uploadBps ?? null,
      },
    };
  }

  /**
   * Write OLT interface `description` (dirección / comentario) and persist locally.
   */
  async updateDescription(user: AuthUser, id: string, description: string) {
    const schema = this.requireSchema(user);
    const onuRepo = await this.tenantConnections.getOnuRepository(schema);
    const row = await onuRepo.findOne({ where: { id } });
    if (!row) throw new NotFoundException('ONU no encontrada');
    const olt = await this.requireManagedOlt(schema, row.oltId);

    const next = description
      .trim()
      .replace(/["\r\n]+/g, ' ')
      .slice(0, 200);
    const result = await this.withTimeout(
      this.oltCli(olt).configureOnuDescription({
        ...this.zteConn(olt),
        onuIf: row.onuIf,
        description: next || null,
      }),
      60_000,
      `Description ${row.onuIf}`,
    );
    if (!result.ok) {
      throw new BadRequestException(
        result.error || 'No se pudo actualizar description en la OLT',
      );
    }

    row.description = next;
    await onuRepo.save(row);

    return {
      ok: true,
      message: result.message || 'Description actualizada',
      description: row.description || null,
      onu: this.serializeOnu(row, olt.name),
    };
  }

  /**
   * Asigna una zona del catálogo CRM a la ONU (o la quita).
   * Guarda `zoneId` y el nombre en `zone` para la lista.
   */
  async updateZone(
    user: AuthUser,
    id: string,
    zoneId: string | null | undefined,
  ) {
    const schema = this.requireSchema(user);
    const onuRepo = await this.tenantConnections.getOnuRepository(schema);
    const row = await onuRepo.findOne({ where: { id } });
    if (!row) throw new NotFoundException('ONU no encontrada');
    const olt = await this.requireManagedOlt(schema, row.oltId);

    const nextId =
      zoneId === undefined || zoneId === null || zoneId === '' ? null : zoneId;
    if (nextId) {
      const zoneRepo = await this.tenantConnections.getZoneRepository(schema);
      const zone = await zoneRepo.findOne({ where: { id: nextId } });
      if (!zone) throw new BadRequestException('Zone not found');
      row.zoneId = zone.id;
      row.zone = zone.name;
    } else {
      row.zoneId = null;
      row.zone = null;
    }
    await onuRepo.save(row);

    return {
      ok: true,
      message: nextId ? 'Zona actualizada' : 'Zona eliminada',
      zone: row.zone,
      zoneId: row.zoneId,
      onu: this.serializeOnu(row, olt.name),
    };
  }

  async metrics(user: AuthUser, id: string, hours = 24, live = false) {
    const schema = this.requireSchema(user);
    const onuRepo = await this.tenantConnections.getOnuRepository(schema);
    const row = await onuRepo.findOne({ where: { id } });
    if (!row) throw new NotFoundException('ONU no encontrada');
    const clampedHours = Math.min(Math.max(hours || 24, 1), 24);
    if (live) {
      // Non-blocking: return DB samples immediately; live SNMP writes the next point.
      void this.refreshOnuLiveSample(schema, row).catch((err) => {
        this.logger.debug(
          `Live metrics ${row.onuIf}: ${
            err instanceof Error ? err.message : err
          }`,
        );
      });
    }
    const since = new Date(Date.now() - clampedHours * 3600_000);
    const samples =
      await this.tenantConnections.getOnuMetricSampleRepository(schema);
    const rows = await samples
      .createQueryBuilder('s')
      .where('s.onu_id = :id', { id })
      .andWhere('s.sampled_at >= :since', { since })
      .orderBy('s.sampled_at', 'ASC')
      .getMany();
    return {
      onuId: id,
      hours: clampedHours,
      live: !!live,
      samples: rows.map((s) => ({
        kind: s.kind,
        value: s.value,
        sampledAt: s.sampledAt.toISOString(),
      })),
    };
  }

  /**
   * SNMP GET for one ONU while its detail modal is open (~2–3s poll).
   * Does not walk the OLT or touch other ONUs.
   */
  private async refreshOnuLiveSample(schema: string, row: Onu) {
    const flightKey = `${schema}:${row.id}`;
    const existing = this.liveRefreshInFlight.get(flightKey);
    if (existing) {
      await existing;
      return;
    }
    const run = this.doRefreshOnuLiveSample(schema, row).finally(() => {
      this.liveRefreshInFlight.delete(flightKey);
    });
    this.liveRefreshInFlight.set(flightKey, run);
    await run;
  }

  private async doRefreshOnuLiveSample(schema: string, row: Onu) {
    let olt: NetworkDevice;
    try {
      olt = await this.requireManagedOlt(schema, row.oltId);
    } catch {
      return;
    }
    const snmp = this.snmpConn(olt);
    if (!snmp || !row.onuIf?.trim()) return;

    let sampled: Awaited<ReturnType<ZteOltSnmpClient['sampleOneOnu']>>;
    try {
      sampled = await this.withTimeout(
        this.oltSnmp(olt).sampleOneOnu({
          ...snmp,
          onuIf: row.onuIf,
          ifIndexHint: row.ifIndex,
        }),
        25_000,
        `SNMP live ${row.onuIf}`,
      );
    } catch (err) {
      this.logger.debug(
        `Live SNMP ${row.onuIf}: ${err instanceof Error ? err.message : err}`,
      );
      return;
    }
    if (!sampled.ok || !sampled.onu) return;

    const snap = sampled.onu;
    const now = new Date();
    const atMs = now.getTime();
    const onuRepo = await this.tenantConnections.getOnuRepository(schema);
    const samples =
      await this.tenantConnections.getOnuMetricSampleRepository(schema);

    if (
      snap.ifIndex != null &&
      snap.ifIndex > 0 &&
      row.ifIndex !== snap.ifIndex
    ) {
      row.ifIndex = snap.ifIndex;
    }

    this.applySnapshot(
      row,
      {
        onuIf: row.onuIf,
        board: snap.slot || row.board,
        port: snap.port || row.port,
        onuId: snap.onuId || row.onuId,
        sn: snap.sn,
        name: snap.name,
        status: snap.status,
        phaseState: snap.phaseState ?? undefined,
        online: snap.online,
        signalDbm: snap.signalDbm,
      },
      now,
    );
    await onuRepoUpdateSafe(onuRepo, row);

    const sampleRows: Array<{
      onuId: string;
      kind: string;
      value: number;
      sampledAt: Date;
    }> = [];

    if (snap.signalDbm != null && Number.isFinite(snap.signalDbm)) {
      sampleRows.push({
        onuId: row.id,
        kind: 'signal',
        value: snap.signalDbm,
        sampledAt: now,
      });
    }

    if (
      snap.inOctets != null &&
      snap.outOctets != null &&
      Number.isFinite(snap.inOctets) &&
      Number.isFinite(snap.outOctets)
    ) {
      const key = `${olt.id}:${row.onuIf.toLowerCase()}`;
      const prev = this.snmpTrafficPrev.get(key);
      this.snmpTrafficPrev.set(key, {
        inOctets: snap.inOctets,
        outOctets: snap.outOctets,
        atMs,
      });
      // Modal polls ~3s — allow shorter windows than the 30s global poller.
      if (prev && atMs > prev.atMs) {
        const dt = (atMs - prev.atMs) / 1000;
        if (dt >= 1.5) {
          const dIn = counterDelta(prev.inOctets, snap.inOctets);
          const dOut = counterDelta(prev.outOctets, snap.outOctets);
          const uploadBps = (dIn * 8) / dt;
          const downloadBps = (dOut * 8) / dt;
          if (Number.isFinite(downloadBps) && downloadBps >= 0) {
            sampleRows.push({
              onuId: row.id,
              kind: 'rx_bps',
              value: downloadBps,
              sampledAt: now,
            });
          }
          if (Number.isFinite(uploadBps) && uploadBps >= 0) {
            sampleRows.push({
              onuId: row.id,
              kind: 'tx_bps',
              value: uploadBps,
              sampledAt: now,
            });
          }
        }
      }
    }
    // No CLI here: `show interface` is too slow for the ~3s live chart.
    // Fleet traffic uses XPON SNMP walks; live uses XPON GET on the same OIDs.

    if (sampleRows.length) {
      const writeKey = row.id;
      const lastWrite = this.liveSampleLastWriteMs.get(writeKey) ?? 0;
      // Modal polls ~2.5–3s; persist at most ~every 3s (still denser than fleet 1/min).
      if (Date.now() - lastWrite >= 2_800) {
        await samples.save(sampleRows.map((s) => samples.create(s)));
        this.liveSampleLastWriteMs.set(writeKey, Date.now());
      }
    }
  }

  /**
   * Live status report (optical, detail, LAN, MAC…). Display-only — no DB write
   * except best-effort refresh of onuType from remote equip/model when missing.
   */
  async statusReport(user: AuthUser, oltId: string, onuIf: string) {
    const schema = this.requireSchema(user);
    const olt = await this.requireManagedOlt(schema, oltId);
    if (!onuIf?.trim()) {
      throw new BadRequestException('onuIf requerido');
    }
    const ifName = onuIf.trim();
    const result = await this.withTimeout(
      this.oltCli(olt).getOnuStatusReport({
        ...this.zteConn(olt),
        onuIf: ifName,
      }),
      120_000,
      `Status ${ifName}`,
    );
    if (!result.ok || !result.report) {
      throw new BadRequestException(
        result.error || 'No se pudo obtener el estado de la ONU',
      );
    }

    const liveModel = normalizeOnuModelName(
      result.swInfo?.model || result.swInfo?.equipId || '',
    );
    if (liveModel) {
      try {
        const onuRepo = await this.tenantConnections.getOnuRepository(schema);
        const row = await onuRepo.findOne({
          where: { oltId, onuIf: ifName },
        });
        if (
          row &&
          (!row.onuType || row.onuType === 'N/A' || row.onuType === '—')
        ) {
          row.onuType = liveModel;
          await onuRepo.save(row);
        }
      } catch {
        /* ignore — status display must not fail on type refresh */
      }
    }

    return {
      oltId: olt.id,
      oltName: olt.name,
      onuIf: ifName,
      probedAt: result.probedAt,
      report: result.report,
      runningConfig: result.runningConfig ?? '',
      swInfo: result.swInfo
        ? {
            vendorId: result.swInfo.vendorId,
            version: result.swInfo.version,
            model: result.swInfo.model,
            equipId: result.swInfo.equipId,
            sn: result.swInfo.sn,
            omccVersion: result.swInfo.omccVersion,
            fields: result.swInfo.fields,
            raw: result.swInfo.raw,
          }
        : null,
    };
  }

  /** Running-config of ONU interface — display-only. */
  async runningConfig(user: AuthUser, oltId: string, onuIf: string) {
    const schema = this.requireSchema(user);
    const olt = await this.requireManagedOlt(schema, oltId);
    if (!onuIf?.trim()) {
      throw new BadRequestException('onuIf requerido');
    }
    const result = await this.withTimeout(
      this.oltCli(olt).getConnectedOnuDetail({
        ...this.zteConn(olt),
        onuIf: onuIf.trim(),
      }),
      90_000,
      `Running-config ${onuIf}`,
    );
    if (!result.ok || !result.onu) {
      throw new BadRequestException(
        result.error || 'No se pudo obtener running-config',
      );
    }
    return {
      oltId: olt.id,
      oltName: olt.name,
      onuIf: onuIf.trim(),
      probedAt: result.probedAt,
      runningConfig: result.onu.runningConfig || '(vacío)',
    };
  }

  /** Remote ONU software / equipment info — display-only. */
  async swInfo(user: AuthUser, oltId: string, onuIf: string) {
    const schema = this.requireSchema(user);
    const olt = await this.requireManagedOlt(schema, oltId);
    if (!onuIf?.trim()) {
      throw new BadRequestException('onuIf requerido');
    }
    const result = await this.withTimeout(
      this.oltCli(olt).getOnuSwInfo({
        ...this.zteConn(olt),
        onuIf: onuIf.trim(),
      }),
      60_000,
      `SW info ${onuIf}`,
    );
    if (!result.ok || !result.equip) {
      throw new BadRequestException(
        result.error || 'No se pudo obtener SW info de la ONU',
      );
    }
    const e = result.equip;
    const lines =
      e.fields.length > 0
        ? e.fields.map((f) => `${f.label}: ${f.value}`)
        : e.raw
          ? [e.raw]
          : ['(sin datos)'];
    return {
      oltId: olt.id,
      oltName: olt.name,
      onuIf: onuIf.trim(),
      probedAt: result.probedAt,
      report: lines.join('\n'),
      equip: {
        vendorId: e.vendorId,
        version: e.version,
        model: e.model,
        equipId: e.equipId,
        sn: e.sn,
        omccVersion: e.omccVersion,
        fields: e.fields,
        raw: e.raw,
      },
    };
  }

  /**
   * LIVE traffic snapshot from OLT (display-only; does not persist samples).
   * Poll this endpoint while the LIVE modal is open.
   */
  async liveTraffic(user: AuthUser, oltId: string, onuIf: string) {
    const schema = this.requireSchema(user);
    const olt = await this.requireManagedOlt(schema, oltId);
    if (!onuIf?.trim()) {
      throw new BadRequestException('onuIf requerido');
    }
    const result = await this.withTimeout(
      this.oltCli(olt).getOnuLiveTraffic({
        ...this.zteConn(olt),
        onuIf: onuIf.trim(),
      }),
      25_000,
      `LIVE traffic ${onuIf}`,
    );
    if (!result.ok) {
      throw new BadRequestException(
        result.error || 'No se pudo leer tráfico en vivo',
      );
    }
    const upBps = result.uploadBps;
    const downBps = result.downloadBps;
    const upPps = result.uploadPps;
    const downPps = result.downloadPps;
    const avgSize = (bps: number | null, pps: number | null) => {
      if (bps == null || pps == null || pps <= 0) return null;
      return Math.round(bps / pps);
    };
    return {
      oltId: olt.id,
      oltName: olt.name,
      onuIf: onuIf.trim(),
      probedAt: result.probedAt,
      downloadBps: downBps,
      uploadBps: upBps,
      downloadPps: downPps,
      uploadPps: upPps,
      downloadAvgSize: avgSize(downBps, downPps),
      uploadAvgSize: avgSize(upBps, upPps),
    };
  }

  async detail(
    user: AuthUser,
    oltId: string,
    onuIf: string,
    opts?: { live?: boolean },
  ) {
    const schema = this.requireSchema(user);
    const olt = await this.requireManagedOlt(schema, oltId);
    if (!onuIf?.trim()) {
      throw new BadRequestException('onuIf requerido');
    }
    const onuRepo = await this.tenantConnections.getOnuRepository(schema);
    const row = await onuRepo.findOne({
      where: { oltId, onuIf: onuIf.trim() },
    });

    let live: Awaited<
      ReturnType<ZteOltClient['getConnectedOnuDetail']>
    > | null = null;
    // Default: DB only (SNMP poller keeps signal/online fresh). CLI only if live=true.
    if (opts?.live) {
      try {
        live = await this.withTimeout(
          this.oltCli(olt).getConnectedOnuDetail({
            ...this.zteConn(olt),
            onuIf: onuIf.trim(),
          }),
          90_000,
          `Detail ${onuIf}`,
        );
      } catch {
        live = null;
      }
    }

    const base = row
      ? this.serializeOnu(row, olt.name)
      : {
          id: `${olt.id}:${onuIf}`,
          oltId: olt.id,
          oltName: olt.name,
          onuIf,
          ponType: 'gpon',
          board: '',
          port: '',
          onuId: '',
          status: 'other',
          online: false,
          phaseState: '',
          adminState: '',
          sn: null as string | null,
          onuType: null as string | null,
          name: null as string | null,
          description: null as string | null,
          signalDbm: null as number | null,
          mode: null as 'bridge' | 'router' | null,
          vlan: null as number | null,
          vlans: [] as number[],
          zone: null,
          zoneId: null,
          odb: null,
          voip: null,
          tv: null,
          authDate: null,
          probedAt: null,
          mgmtIp: null as string | null,
          mgmtPoolId: null as string | null,
          wanIp: null as string | null,
          wanPoolId: null as string | null,
          tr069ProfileId: null as string | null,
          provisionMode: 'auto' as 'auto' | 'manual',
        };

    const o = live?.ok ? live.onu : null;

    // Persist identity / signal from live detail so the list catches up.
    if (row && o) {
      const now = new Date();
      this.applySnapshot(
        row,
        {
          onuIf: o.onuIf,
          sn: o.sn,
          onuType: o.onuType,
          name: o.name,
          description: o.description,
          status: o.status,
          phaseState: o.phaseState,
          adminState: o.adminState,
          online: o.online,
          signalDbm: o.signalDbm,
          mode: o.mode,
          vlan: o.vlan,
          vlans: o.vlans,
        },
        now,
      );
      await onuRepo.save(row);
      const samples =
        await this.tenantConnections.getOnuMetricSampleRepository(schema);
      const toSave: Array<{ kind: string; value: number }> = [];
      if (o.signalDbm != null && Number.isFinite(o.signalDbm)) {
        toSave.push({ kind: 'signal', value: o.signalDbm });
      }
      if (o.downloadBps != null && Number.isFinite(o.downloadBps)) {
        toSave.push({ kind: 'rx_bps', value: o.downloadBps });
      }
      if (o.uploadBps != null && Number.isFinite(o.uploadBps)) {
        toSave.push({ kind: 'tx_bps', value: o.uploadBps });
      }
      if (toSave.length) {
        await samples.save(
          toSave.map((s) =>
            samples.create({
              onuId: row.id,
              kind: s.kind,
              value: s.value,
              sampledAt: now,
            }),
          ),
        );
      }
    }

    const persisted = row ? this.serializeOnu(row, olt.name) : base;

    let tr069ProfileName: string | null = null;
    const profileId =
      (persisted as { tr069ProfileId?: string | null }).tr069ProfileId ??
      row?.tr069ProfileId ??
      null;
    if (profileId) {
      const profileRepo =
        await this.tenantConnections.getTr069ProfileRepository(schema);
      const profile = await profileRepo.findOne({ where: { id: profileId } });
      tr069ProfileName = profile?.name ?? null;
    }

    let mgmtVlanId: number | null = null;
    let wanVlanId: number | null = null;
    if (row?.mgmtPoolId || row?.wanPoolId) {
      const poolRepo = await this.tenantConnections.getIpPoolRepository(schema);
      if (row.mgmtPoolId) {
        const mp = await poolRepo.findOne({ where: { id: row.mgmtPoolId } });
        mgmtVlanId = mp?.vlanId ?? null;
      }
      if (row.wanPoolId) {
        const wp = await poolRepo.findOne({ where: { id: row.wanPoolId } });
        wanVlanId = wp?.vlanId ?? null;
      }
    }
    if (wanVlanId == null && persisted.vlan != null) {
      wanVlanId = persisted.vlan;
    }

    return {
      probedAt: live?.probedAt ?? row?.lastProbedAt?.toISOString() ?? null,
      fromDatabase: !!row,
      onu: {
        ...persisted,
        ...(o
          ? {
              sn: o.sn ?? persisted.sn,
              onuType: o.onuType ?? persisted.onuType,
              name: o.name ?? persisted.name,
              description: o.description ?? persisted.description,
              signalDbm: o.signalDbm ?? persisted.signalDbm,
              online: o.online,
              status: o.status,
              phaseState: o.phaseState,
              // WAN gestionada ⇒ modo router; si no, usa el probe/OLT.
              mode: row?.wanPoolId ? 'router' : (o.mode ?? persisted.mode),
              // Prefer pool-assigned WAN VLAN over OLT probe when we manage WAN
              vlan: row?.wanPoolId
                ? (persisted.vlan ?? o.vlan)
                : (o.vlan ?? persisted.vlan),
              vlans: o.vlans?.length ? o.vlans : persisted.vlans,
            }
          : {}),
        oltRxDbm: o?.oltRxDbm ?? null,
        distanceM: o?.distanceM ?? null,
        onlineDuration:
          o?.onlineDuration ??
          this.formatOnlineDuration(row?.onlineSince) ??
          (persisted as { onlineDuration?: string | null }).onlineDuration ??
          null,
        downloadBps: o?.downloadBps ?? null,
        uploadBps: o?.uploadBps ?? null,
        contact: null,
        address: o?.description ?? persisted.description,
        configurationPreset: null,
        tr069Profile: tr069ProfileName,
        tr069ProfileId: profileId,
        tr069Enabled: !!profileId && !!(row?.mgmtIp ?? persisted.mgmtIp),
        mgmtIp: persisted.mgmtIp ?? null,
        mgmtPoolId: persisted.mgmtPoolId ?? null,
        mgmtVlanId,
        wanIp: persisted.wanIp ?? null,
        wanPoolId: persisted.wanPoolId ?? null,
        wanVlanId,
        wanSetupMode: persisted.wanIp ? 'static' : null,
        runningConfig: o?.runningConfig ?? '',
        detailInfoRaw: o?.detailInfoRaw ?? '',
        ethernetPorts: o?.ethernetPorts ?? [],
        wifiPorts: o?.wifiPorts ?? [],
        voipSupported: o?.voipSupported ?? null,
        catvSupported: o?.catvSupported ?? null,
        speedProfile: { download: null, upload: null },
        imageUrl: null,
      },
    };
  }

  async reboot(user: AuthUser, oltId: string, onuIf: string) {
    const schema = this.requireSchema(user);
    const olt = await this.requireManagedOlt(schema, oltId);
    if (!onuIf?.trim()) {
      throw new BadRequestException('onuIf requerido');
    }
    const result = await this.withTimeout(
      this.oltCli(olt).rebootOnu({
        ...this.zteConn(olt),
        onuIf: onuIf.trim(),
      }),
      60_000,
      `ONU reboot ${onuIf}`,
    );
    if (!result.ok) {
      throw new BadRequestException(result.error || 'Fallo al reiniciar ONU');
    }
    return result;
  }

  /** Admin-disable ONU on OLT; keeps registration in Conectadas as offline. */
  async disable(user: AuthUser, oltId: string, onuIf: string) {
    const schema = this.requireSchema(user);
    const olt = await this.requireManagedOlt(schema, oltId);
    if (!onuIf?.trim()) {
      throw new BadRequestException('onuIf requerido');
    }
    const ifName = onuIf.trim();
    const result = await this.withTimeout(
      this.oltCli(olt).disableOnu({
        ...this.zteConn(olt),
        onuIf: ifName,
      }),
      60_000,
      `ONU disable ${ifName}`,
    );
    if (!result.ok) {
      throw new BadRequestException(
        result.error || 'Fallo al deshabilitar ONU',
      );
    }

    const onuRepo = await this.tenantConnections.getOnuRepository(schema);
    const row = await onuRepo.findOne({ where: { oltId, onuIf: ifName } });
    if (row) {
      row.online = false;
      row.adminState = 'disable';
      row.status = 'offline';
      row.phaseState = row.phaseState || 'OffLine';
      row.lastProbedAt = new Date();
      await onuRepo.save(row);
    }

    return result;
  }

  /** Re-enable a previously admin-disabled ONU on OLT. */
  async enable(user: AuthUser, oltId: string, onuIf: string) {
    const schema = this.requireSchema(user);
    const olt = await this.requireManagedOlt(schema, oltId);
    if (!onuIf?.trim()) {
      throw new BadRequestException('onuIf requerido');
    }
    const ifName = onuIf.trim();
    const result = await this.withTimeout(
      this.oltCli(olt).enableOnu({
        ...this.zteConn(olt),
        onuIf: ifName,
      }),
      60_000,
      `ONU enable ${ifName}`,
    );
    if (!result.ok) {
      throw new BadRequestException(result.error || 'Fallo al rehabilitar ONU');
    }

    const onuRepo = await this.tenantConnections.getOnuRepository(schema);
    const row = await onuRepo.findOne({ where: { oltId, onuIf: ifName } });
    if (row) {
      row.adminState = 'enable';
      row.lastProbedAt = new Date();
      await onuRepo.save(row);

      if (row.sn) {
        const deniedRepo =
          await this.tenantConnections.getOnuDeniedRepository(schema);
        await deniedRepo.delete({ sn: row.sn.toUpperCase() });
      }
    }

    return result;
  }

  /**
   * Delete ONU from OLT (`no onu`) and remove from Conectadas.
   * Device returns to Huérfanas if still connected.
   */
  async deleteOnu(user: AuthUser, oltId: string, onuIf: string) {
    const schema = this.requireSchema(user);
    const olt = await this.requireManagedOlt(schema, oltId);
    if (!onuIf?.trim()) {
      throw new BadRequestException('onuIf requerido');
    }
    const ifName = onuIf.trim();
    const result = await this.withTimeout(
      this.oltCli(olt).deleteOnu({
        ...this.zteConn(olt),
        onuIf: ifName,
      }),
      60_000,
      `ONU delete ${ifName}`,
    );
    if (!result.ok) {
      throw new BadRequestException(result.error || 'Fallo al borrar ONU');
    }

    const onuRepo = await this.tenantConnections.getOnuRepository(schema);
    const allOnOlt = await onuRepo.find({ where: { oltId } });
    const matches = allOnOlt.filter(
      (r) => r.onuIf.toLowerCase() === ifName.toLowerCase(),
    );
    // Also purge any other Conectadas row with the same SN (stale duplicates).
    const sns = new Set(
      matches
        .map((r) => r.sn?.trim().toUpperCase())
        .filter((s): s is string => !!s),
    );
    const bySn = allOnOlt.filter((r) => {
      const sn = r.sn?.trim().toUpperCase();
      return !!sn && sns.has(sn);
    });
    const toPurge = new Map<string, Onu>();
    for (const r of [...matches, ...bySn]) toPurge.set(r.id, r);

    for (const row of toPurge.values()) {
      this.markRecentlyDeleted(schema, oltId, row.onuIf, row.sn);
      await this.purgeOnuRow(schema, row);
    }
    // Even if no DB row matched, remember the ifName so poll/sync cannot re-add.
    if (toPurge.size === 0) {
      this.markRecentlyDeleted(schema, oltId, ifName, null);
    }

    return result;
  }

  /**
   * Background tick: refresh online/signal for imported ONUs, write signal
   * samples, and sample traffic rates. Prefers SNMP RO; falls back to CLI.
   */
  async pollMetricsForSchema(schema: string): Promise<void> {
    const olts = await this.listManagedOlts(schema);
    const onuRepo = await this.tenantConnections.getOnuRepository(schema);
    const samples =
      await this.tenantConnections.getOnuMetricSampleRepository(schema);

    for (const olt of olts) {
      if (olt.connectionStatus === 'disconnected') continue;
      if (!olt.mgmtHost) continue;
      const hasSnmp = !!this.snmpConn(olt);
      const hasCli = !!(olt.mgmtUsername && olt.mgmtPassword);
      if (!hasSnmp && !hasCli) continue;
      const imported = await onuRepo.count({ where: { oltId: olt.id } });
      if (imported === 0) continue;

      const lockKey = `${schema}:${olt.id}`;
      if (this.pollInFlight.has(lockKey)) continue;
      this.pollInFlight.add(lockKey);
      try {
        await this.pollOneOlt(schema, olt, onuRepo, samples);
      } catch (err) {
        this.logger.warn(
          `ONU poll ${olt.name}: ${err instanceof Error ? err.message : err}`,
        );
      } finally {
        this.pollInFlight.delete(lockKey);
      }
    }

    await this.pruneOnuMetricSamples(schema, samples);
  }

  /** Keep the last 24h of ONU metric history (1-min fleet + denser live). */
  private async pruneOnuMetricSamples(
    schema: string,
    samples: Awaited<
      ReturnType<TenantConnectionService['getOnuMetricSampleRepository']>
    >,
  ) {
    try {
      const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
      await samples
        .createQueryBuilder()
        .delete()
        .from(OnuMetricSample)
        .where('sampled_at < :cutoff', { cutoff })
        .execute();
    } catch (err) {
      this.logger.warn(
        `prune onu_metric_samples ${schema}: ${
          err instanceof Error ? err.message : err
        }`,
      );
    }
  }

  /** Persist rx_bps / tx_bps for the given ONUs (~target: once per minute). */
  private async sampleTrafficForOnus(
    olt: NetworkDevice,
    rows: Array<{ id: string; onuIf: string }>,
    samples: Awaited<
      ReturnType<TenantConnectionService['getOnuMetricSampleRepository']>
    >,
  ) {
    if (rows.length === 0) return;
    // Rotate a subset so we never hold the OLT lock for hundreds of iface shows.
    const maxPerTick = 24;
    const slice =
      rows.length <= maxPerTick
        ? rows
        : (() => {
            const key = `traf:${olt.id}`;
            const start = (this.trafficRoundRobin.get(key) ?? 0) % rows.length;
            this.trafficRoundRobin.set(key, start + maxPerTick);
            const out: typeof rows = [];
            for (let i = 0; i < maxPerTick; i++) {
              out.push(rows[(start + i) % rows.length]);
            }
            return out;
          })();
    try {
      const traffic = await this.withTimeout(
        this.oltCli(olt).sampleOnuTrafficRates({
          ...this.zteConn(olt),
          onuIfs: slice.map((r) => r.onuIf),
          priority: 'background',
        }),
        90_000,
        `Traffic sample ${olt.name}`,
      );
      if (!traffic.ok || !traffic.rates.length) return;
      const trafficAt = new Date(traffic.probedAt);
      const byRow = new Map(rows.map((r) => [r.onuIf.toLowerCase(), r]));
      const trafficSamples: Array<{
        onuId: string;
        kind: string;
        value: number;
        sampledAt: Date;
      }> = [];
      for (const rate of traffic.rates) {
        const row = byRow.get(rate.onuIf.toLowerCase());
        if (!row) continue;
        if (rate.downloadBps != null && Number.isFinite(rate.downloadBps)) {
          trafficSamples.push({
            onuId: row.id,
            kind: 'rx_bps',
            value: rate.downloadBps,
            sampledAt: trafficAt,
          });
        }
        if (rate.uploadBps != null && Number.isFinite(rate.uploadBps)) {
          trafficSamples.push({
            onuId: row.id,
            kind: 'tx_bps',
            value: rate.uploadBps,
            sampledAt: trafficAt,
          });
        }
      }
      if (trafficSamples.length) {
        await samples.save(trafficSamples.map((s) => samples.create(s)));
      }
    } catch (err) {
      this.logger.warn(
        `Traffic sample ${olt.name}: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  private async pollOneOlt(
    schema: string,
    olt: NetworkDevice,
    onuRepo: Awaited<ReturnType<TenantConnectionService['getOnuRepository']>>,
    samples: Awaited<
      ReturnType<TenantConnectionService['getOnuMetricSampleRepository']>
    >,
  ) {
    const existing = await onuRepo.find({ where: { oltId: olt.id } });
    if (existing.length === 0) return;

    const snmp = this.snmpConn(olt);
    if (snmp) {
      try {
        const monitored = await this.withTimeout(
          this.oltSnmp(olt).walkOnuMonitor(snmp),
          90_000,
          `SNMP ONUs ${olt.name}`,
        );
        if (monitored.ok && monitored.onus.length > 0) {
          const matched = await this.applySnmpMonitor(
            schema,
            olt,
            existing,
            monitored.onus,
            onuRepo,
            samples,
            new Date(monitored.probedAt),
          );
          if (matched > 0) {
            this.logger.log(
              `ONU poll ${olt.name}: SNMP ${monitored.source} matched ${matched}/${existing.length}`,
            );
            // CLI traffic only if XPON/IF-MIB counters were missing this tick.
            const snmpTraffic = monitored.onus.some(
              (o) => o.inOctets != null && o.outOctets != null,
            );
            if (!snmpTraffic && olt.mgmtUsername && olt.mgmtPassword) {
              const online = existing.filter((r) => r.online);
              if (online.length > 0) {
                await this.sampleTrafficForOnus(olt, online, samples);
              }
            }
            return;
          }
          this.logger.warn(
            `ONU poll ${olt.name}: SNMP returned rows but none matched DB — CLI fallback`,
          );
        } else {
          this.logger.warn(
            `ONU poll ${olt.name}: SNMP miss (${monitored.error ?? 'empty'}) — CLI fallback`,
          );
        }
      } catch (err) {
        this.logger.warn(
          `ONU poll ${olt.name}: SNMP error — CLI fallback: ${
            err instanceof Error ? err.message : err
          }`,
        );
      }
    }

    if (!olt.mgmtUsername || !olt.mgmtPassword) return;
    await this.pollOneOltViaCli(schema, olt, existing, onuRepo, samples);
  }

  private async applySnmpMonitor(
    schema: string,
    olt: NetworkDevice,
    existing: Onu[],
    snmpOnus: Array<{
      onuIf: string;
      slot: string;
      port: string;
      onuId: string;
      sn: string | null;
      name: string | null;
      phaseState: string | null;
      online: boolean;
      status: 'online' | 'offline';
      signalDbm: number | null;
      inOctets: number | null;
      outOctets: number | null;
      ifIndex?: number | null;
    }>,
    onuRepo: Awaited<ReturnType<TenantConnectionService['getOnuRepository']>>,
    samples: Awaited<
      ReturnType<TenantConnectionService['getOnuMetricSampleRepository']>
    >,
    now: Date,
  ): Promise<number> {
    const byIf = new Map(existing.map((e) => [e.onuIf.toLowerCase(), e]));
    const bySn = new Map(
      existing.filter((e) => e.sn).map((e) => [e.sn!.toUpperCase(), e]),
    );
    const bySlotPortId = new Map(
      existing.map((e) => [`${e.board}/${e.port}:${e.onuId}`.toLowerCase(), e]),
    );

    const seen = new Set<string>();
    const sampleRows: Array<{
      onuId: string;
      kind: string;
      value: number;
      sampledAt: Date;
    }> = [];
    let matched = 0;
    const atMs = now.getTime();

    for (const snap of snmpOnus) {
      if (this.isRecentlyDeleted(schema, olt.id, snap.onuIf, snap.sn ?? null)) {
        continue;
      }
      const row =
        byIf.get(snap.onuIf.toLowerCase()) ||
        (snap.sn ? bySn.get(snap.sn.toUpperCase()) : undefined) ||
        bySlotPortId.get(
          `${snap.slot}/${snap.port}:${snap.onuId}`.toLowerCase(),
        );
      if (!row) continue;
      matched += 1;
      seen.add(row.onuIf.toLowerCase());

      if (snap.ifIndex != null && snap.ifIndex > 0) {
        row.ifIndex = snap.ifIndex;
        this.oltSnmp(olt).rememberIfIndex(
          olt.mgmtHost ?? '',
          row.onuIf,
          snap.ifIndex,
        );
      }

      this.applySnapshot(
        row,
        {
          onuIf: row.onuIf,
          board: snap.slot || row.board,
          port: snap.port || row.port,
          onuId: snap.onuId || row.onuId,
          sn: snap.sn,
          name: snap.name,
          status: snap.status,
          phaseState: snap.phaseState ?? undefined,
          online: snap.online,
          signalDbm: snap.signalDbm,
        },
        now,
      );
      await onuRepoUpdateSafe(onuRepo, row);

      if (snap.signalDbm != null && Number.isFinite(snap.signalDbm)) {
        sampleRows.push({
          onuId: row.id,
          kind: 'signal',
          value: snap.signalDbm,
          sampledAt: now,
        });
      }

      if (
        snap.inOctets != null &&
        snap.outOctets != null &&
        Number.isFinite(snap.inOctets) &&
        Number.isFinite(snap.outOctets)
      ) {
        const key = `${olt.id}:${row.onuIf.toLowerCase()}`;
        const prev = this.snmpTrafficPrev.get(key);
        this.snmpTrafficPrev.set(key, {
          inOctets: snap.inOctets,
          outOctets: snap.outOctets,
          atMs,
        });
        if (prev && atMs > prev.atMs) {
          const dt = (atMs - prev.atMs) / 1000;
          if (dt >= 5) {
            const dIn = counterDelta(prev.inOctets, snap.inOctets);
            const dOut = counterDelta(prev.outOctets, snap.outOctets);
            // OLT input = upload (tx_bps); OLT output = download (rx_bps)
            const uploadBps = (dIn * 8) / dt;
            const downloadBps = (dOut * 8) / dt;
            if (Number.isFinite(downloadBps) && downloadBps >= 0) {
              sampleRows.push({
                onuId: row.id,
                kind: 'rx_bps',
                value: downloadBps,
                sampledAt: now,
              });
            }
            if (Number.isFinite(uploadBps) && uploadBps >= 0) {
              sampleRows.push({
                onuId: row.id,
                kind: 'tx_bps',
                value: uploadBps,
                sampledAt: now,
              });
            }
          }
        }
      }
    }

    for (const row of existing) {
      if (seen.has(row.onuIf.toLowerCase())) continue;
      await onuRepo.update(
        { id: row.id },
        {
          online: false,
          status: 'offline',
          lastProbedAt: now,
        },
      );
    }

    if (sampleRows.length) {
      await samples.save(sampleRows.map((s) => samples.create(s)));
    }
    return matched;
  }

  private async pollOneOltViaCli(
    schema: string,
    olt: NetworkDevice,
    existing: Onu[],
    onuRepo: Awaited<ReturnType<TenantConnectionService['getOnuRepository']>>,
    samples: Awaited<
      ReturnType<TenantConnectionService['getOnuMetricSampleRepository']>
    >,
  ) {
    const previouslyOnline = existing.filter((r) => r.online);
    if (previouslyOnline.length > 0) {
      await this.sampleTrafficForOnus(olt, previouslyOnline, samples);
    }

    const onlyOltIfs = [
      ...new Set(
        existing
          .map((r) => {
            const m = r.onuIf.match(/^((?:gpon|epon)-onu_[\d/]+):\d+$/i);
            return m ? m[1].replace(/-onu_/i, '-olt_') : null;
          })
          .filter((x): x is string => !!x),
      ),
    ];

    const discovered = await this.withTimeout(
      this.oltCli(olt).listConnectedOnus({
        ...this.zteConn(olt),
        includeRunningConfig: false,
        onlyOltIfs: onlyOltIfs.length ? onlyOltIfs : undefined,
        priority: 'background',
      }),
      120_000,
      `Poll ONUs ${olt.name}`,
    );
    if (!discovered.ok) return;

    const byIf = new Map(existing.map((e) => [e.onuIf.toLowerCase(), e]));
    const seen = new Set<string>();
    const now = new Date();
    const sampleRows: Array<{
      onuId: string;
      kind: string;
      value: number;
      sampledAt: Date;
    }> = [];

    for (const snap of discovered.onus) {
      if (this.isRecentlyDeleted(schema, olt.id, snap.onuIf, snap.sn ?? null)) {
        continue;
      }
      seen.add(snap.onuIf.toLowerCase());
      const row = byIf.get(snap.onuIf.toLowerCase());
      if (!row) continue;
      this.applySnapshot(row, snap, now);
      const result = await onuRepo.update(
        { id: row.id },
        {
          ponType: row.ponType,
          board: row.board,
          port: row.port,
          onuId: row.onuId,
          sn: row.sn,
          onuType: row.onuType,
          name: row.name,
          description: row.description,
          status: row.status,
          phaseState: row.phaseState,
          adminState: row.adminState,
          online: row.online,
          signalDbm: row.signalDbm,
          mode: row.mode,
          vlan: row.vlan,
          vlans: row.vlans,
          lastProbedAt: row.lastProbedAt,
        },
      );
      if (!result.affected) continue;
      if (snap.signalDbm != null && Number.isFinite(snap.signalDbm)) {
        sampleRows.push({
          onuId: row.id,
          kind: 'signal',
          value: snap.signalDbm,
          sampledAt: now,
        });
      }
    }

    for (const row of existing) {
      if (seen.has(row.onuIf.toLowerCase())) continue;
      await onuRepo.update(
        { id: row.id },
        {
          online: false,
          status: 'offline',
          lastProbedAt: now,
        },
      );
    }

    if (sampleRows.length) {
      await samples.save(sampleRows.map((s) => samples.create(s)));
    }

    const stillThere = await onuRepo.find({ where: { oltId: olt.id } });
    const missing = stillThere.filter((r) => !r.sn || !r.name).slice(0, 8);
    for (const row of missing) {
      if (this.isRecentlyDeleted(schema, olt.id, row.onuIf, row.sn)) {
        continue;
      }
      try {
        const detail = await this.withTimeout(
          this.oltCli(olt).getConnectedOnuDetail({
            ...this.zteConn(olt),
            onuIf: row.onuIf,
            priority: 'background',
          }),
          45_000,
          `Backfill ${row.onuIf}`,
        );
        if (!detail.ok || !detail.onu) continue;
        const o = detail.onu;
        await onuRepo.update(
          { id: row.id },
          {
            sn: o.sn ?? row.sn,
            onuType: o.onuType ?? row.onuType,
            name: o.name ?? row.name,
            description: o.description ?? row.description,
            lastProbedAt: new Date(),
          },
        );
      } catch {
        /* skip */
      }
    }
  }
}

function counterDelta(prev: number, next: number): number {
  if (next >= prev) return next - prev;
  // 32-bit wrap
  if (prev <= 0xffffffff && next <= 0xffffffff) {
    return next + (0xffffffff - prev) + 1;
  }
  // 64-bit wrap (approx)
  return next;
}

async function onuRepoUpdateSafe(
  onuRepo: Awaited<ReturnType<TenantConnectionService['getOnuRepository']>>,
  row: Onu,
) {
  const patch: Record<string, unknown> = {
    board: row.board,
    port: row.port,
    onuId: row.onuId,
    sn: row.sn,
    name: row.name,
    status: row.status,
    phaseState: row.phaseState,
    online: row.online,
    lastProbedAt: row.lastProbedAt,
    onlineSince: row.onlineSince,
  };
  if (row.signalDbm != null && Number.isFinite(row.signalDbm)) {
    patch.signalDbm = row.signalDbm;
  }
  if (row.ifIndex != null && row.ifIndex > 0) {
    patch.ifIndex = row.ifIndex;
  }
  await onuRepo.update({ id: row.id }, patch);
}
