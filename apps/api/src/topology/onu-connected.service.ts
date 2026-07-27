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
  isZteOltDevice,
  OLT_SELECTABLE_SUBTYPES,
} from './olt.constants';
import { ZteOltClient } from './zte-olt.client';
import type { NetworkDevice } from './entities/network-device.entity';
import type { Onu } from './entities/onu.entity';
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
  /** Prevents poll/sync from resurrecting an ONU right after Delete (2 min). */
  private readonly recentlyDeletedUntil = new Map<string, number>();

  constructor(
    private readonly tenantConnections: TenantConnectionService,
    private readonly zteOlt: ZteOltClient,
    private readonly onuCatalog: OnuCatalogAdminService,
    private readonly onuTypeSync: OnuTypeOltSyncService,
  ) {}

  private recentlyDeletedKey(
    schema: string,
    kind: 'sn' | 'if',
    value: string,
  ) {
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
  private async purgeOnuRow(
    schema: string,
    row: Onu,
  ): Promise<void> {
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
    };
  }

  private async requireZteOlt(schema: string, oltId: string) {
    const repo =
      await this.tenantConnections.getNetworkDeviceRepository(schema);
    const olt = await repo.findOne({ where: { id: oltId } });
    if (!olt) throw new NotFoundException('OLT no encontrada');
    if (!isZteOltDevice(olt.type, olt.subtype)) {
      throw new BadRequestException('El equipo no es una OLT ZTE');
    }
    return olt;
  }

  private async listZteOlts(schema: string): Promise<NetworkDevice[]> {
    const repo =
      await this.tenantConnections.getNetworkDeviceRepository(schema);
    const devices = await repo.find({
      where: {
        subtype: In([...OLT_SELECTABLE_SUBTYPES, 'zte_c3xx']),
      },
      order: { name: 'ASC' },
    });
    return devices.filter((d) => isZteOltDevice(d.type, d.subtype));
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
          reject(e);
        },
      );
    });
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
    if (snap.online != null) row.online = snap.online;
    if (snap.signalDbm !== undefined) row.signalDbm = snap.signalDbm;
    if (snap.mode) row.mode = snap.mode;
    if (snap.vlan !== undefined && snap.vlan != null) row.vlan = snap.vlan;
    if (snap.vlans?.length) row.vlans = snap.vlans;
    row.lastProbedAt = now;
  }

  private async rememberModel(schema: string, onuType: string | null | undefined) {
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
    const olt = await this.requireZteOlt(schema, oltId);
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

  async discover(user: AuthUser, oltId: string) {
    const schema = this.requireSchema(user);
    const olt = await this.requireZteOlt(schema, oltId);
    const onuRepo = await this.tenantConnections.getOnuRepository(schema);
    const importedCount = await onuRepo.count({ where: { oltId } });

    const result = await this.withTimeout(
      this.zteOlt.listConnectedOnus(this.zteConn(olt)),
      300_000,
      `Discover ONUs ${olt.name}`,
    );
    if (!result.ok) {
      throw new BadRequestException(
        result.error || 'No se pudieron descubrir ONUs',
      );
    }

    const portMap = new Map<
      string,
      { ifName: string; board: string; port: string; count: number; online: number }
    >();
    for (const o of result.onus) {
      const oltIf = o.onuIf.replace(/-onu_/i, '-olt_').replace(/:\d+$/, '');
      const cur = portMap.get(oltIf) ?? {
        ifName: oltIf,
        board: o.board,
        port: o.port,
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
      probedAt: result.probedAt,
      total: result.onus.length,
      online: result.onus.filter((o) => o.online).length,
      importedCount,
      suggestOnuImport: importedCount === 0 && !olt.onusImportPromptedAt,
      ports: [...portMap.values()].sort((a, b) =>
        a.ifName.localeCompare(b.ifName, undefined, { numeric: true }),
      ),
      onus: result.onus.map((o) => ({
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
      })),
    };
  }

  async importSkip(user: AuthUser, oltId: string) {
    const schema = this.requireSchema(user);
    const olt = await this.requireZteOlt(schema, oltId);
    const repo =
      await this.tenantConnections.getNetworkDeviceRepository(schema);
    olt.onusImportPromptedAt = new Date();
    await repo.save(olt);
    return { ok: true };
  }

  async importOne(user: AuthUser, oltId: string, snap: OnuImportSnapshot) {
    const schema = this.requireSchema(user);
    await this.requireZteOlt(schema, oltId);
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
   * Excludes manually denied SNs and SNs already in Conectadas.
   * Bloqueadas = solo denylist de huérfanas; no se mezcla con disable en Conectadas.
   */
  async listUncfg(user: AuthUser, oltId?: string) {
    const schema = this.requireSchema(user);
    const olts = oltId
      ? [await this.requireZteOlt(schema, oltId)]
      : await this.listZteOlts(schema);

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
    }> = [];
    const errors: Array<{ oltId: string; oltName: string; error: string }> = [];

    const deniedRepo =
      await this.tenantConnections.getOnuDeniedRepository(schema);
    const onuRepo = await this.tenantConnections.getOnuRepository(schema);

    const knownRows = await onuRepo
      .createQueryBuilder('o')
      .select(['o.id', 'o.sn'])
      .where('o.sn IS NOT NULL')
      .andWhere("o.sn <> ''")
      .getMany();
    const knownBySn = new Set(
      knownRows
        .map((r) => r.sn?.trim().toUpperCase())
        .filter((sn): sn is string => !!sn),
    );

    // Stale denylist: SN already in Conectadas must not stay in Bloqueadas
    await this.purgeDeniedAlreadyConnected(deniedRepo, knownBySn);

    const deniedRows = await deniedRepo.find();
    const deniedSn = new Set(deniedRows.map((d) => d.sn.toUpperCase()));

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
          this.zteOlt.listUncfgOnus(this.zteConn(olt)),
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
        for (const u of result.onus) {
          const sn = u.sn.toUpperCase();
          // Already in Conectadas → never orphan (disable stays only in Conectadas)
          if (knownBySn.has(sn)) continue;
          if (deniedSn.has(sn)) continue;
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

    return {
      onus,
      olts: olts.map((o) => ({ id: o.id, name: o.name })),
      errors,
      total: onus.length,
      deniedCount,
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
    const olt = await this.requireZteOlt(schema, body.oltId);
    const oltIf = body.oltIf?.trim();
    const onuId = String(body.onuId ?? '').trim();
    const sn = body.sn?.trim().toUpperCase();
    const preferred = body.onuType?.trim() || null;
    if (!oltIf || !onuId || !sn) {
      throw new BadRequestException('oltIf, onuId y sn son requeridos');
    }

    const ponType: 'gpon' | 'epon' = oltIf.startsWith('epon')
      ? 'epon'
      : 'gpon';
    const steps: AuthorizeProbeStep[] = [];
    const snVendor = vendorFromSn(sn);

    steps.push({
      step: 'sync_types',
      status: 'info',
      message: `SN ${sn} → vendor ${snVendor}; sincronizando perfiles…`,
    });
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
          ? ensured.message || `Type «${cand.name}» listo en OLT`
          : ensured.error || `No se pudo crear «${cand.name}» en OLT`,
        typeName: cand.name,
      });
      if (!ensured.ok) {
        lastError = ensured.error || lastError;
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
          ? normalizeOnuModelName(
              sw.equip.model || sw.equip.equipId || '',
            )
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
                    catalogItem!.ponType === 'epon' ? ('epon' as const) : ponType,
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

    const parts = onuIf.match(
      /^(?:gpon|epon)-onu_(\d+)\/(\d+)\/(\d+):(\d+)$/i,
    );
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
    const olts = await this.listZteOlts(schema);
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
    const olt = await this.requireZteOlt(schema, oltId);
    const discovered = await this.discover(user, oltId);
    const onuRepo = await this.tenantConnections.getOnuRepository(schema);
    const existing = await onuRepo.find({ where: { oltId } });
    const byIf = new Map(existing.map((e) => [e.onuIf.toLowerCase(), e]));
    const seen = new Set<string>();
    const now = new Date();
    let updated = 0;
    let added = 0;
    let removed = 0;

    for (const snap of discovered.onus) {
      if (
        this.isRecentlyDeleted(schema, oltId, snap.onuIf, snap.sn ?? null)
      ) {
        this.logger.log(
          `sync skip recently deleted ${snap.onuIf} (${snap.sn ?? 'sin SN'})`,
        );
        continue;
      }
      seen.add(snap.onuIf.toLowerCase());
      let row = byIf.get(snap.onuIf.toLowerCase());
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
    const olt = await this.requireZteOlt(schema, row.oltId);

    const result = await this.withTimeout(
      this.zteOlt.getConnectedOnuDetail({
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
  async updateDescription(
    user: AuthUser,
    id: string,
    description: string,
  ) {
    const schema = this.requireSchema(user);
    const onuRepo = await this.tenantConnections.getOnuRepository(schema);
    const row = await onuRepo.findOne({ where: { id } });
    if (!row) throw new NotFoundException('ONU no encontrada');
    const olt = await this.requireZteOlt(schema, row.oltId);

    const next = description.trim().replace(/["\r\n]+/g, ' ').slice(0, 200);
    const result = await this.withTimeout(
      this.zteOlt.configureOnuDescription({
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
    const olt = await this.requireZteOlt(schema, row.oltId);

    const nextId =
      zoneId === undefined || zoneId === null || zoneId === ''
        ? null
        : zoneId;
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

  async metrics(user: AuthUser, id: string, hours = 6) {
    const schema = this.requireSchema(user);
    const onuRepo = await this.tenantConnections.getOnuRepository(schema);
    const row = await onuRepo.findOne({ where: { id } });
    if (!row) throw new NotFoundException('ONU no encontrada');
    const since = new Date(Date.now() - Math.max(1, hours) * 3600_000);
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
      hours,
      samples: rows.map((s) => ({
        kind: s.kind,
        value: s.value,
        sampledAt: s.sampledAt.toISOString(),
      })),
    };
  }

  /**
   * Live status report (optical, detail, LAN, MAC…). Display-only — no DB write
   * except best-effort refresh of onuType from remote equip/model when missing.
   */
  async statusReport(user: AuthUser, oltId: string, onuIf: string) {
    const schema = this.requireSchema(user);
    const olt = await this.requireZteOlt(schema, oltId);
    if (!onuIf?.trim()) {
      throw new BadRequestException('onuIf requerido');
    }
    const ifName = onuIf.trim();
    const result = await this.withTimeout(
      this.zteOlt.getOnuStatusReport({
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
        if (row && (!row.onuType || row.onuType === 'N/A' || row.onuType === '—')) {
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
    const olt = await this.requireZteOlt(schema, oltId);
    if (!onuIf?.trim()) {
      throw new BadRequestException('onuIf requerido');
    }
    const result = await this.withTimeout(
      this.zteOlt.getConnectedOnuDetail({
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
    const olt = await this.requireZteOlt(schema, oltId);
    if (!onuIf?.trim()) {
      throw new BadRequestException('onuIf requerido');
    }
    const result = await this.withTimeout(
      this.zteOlt.getOnuSwInfo({
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
    const olt = await this.requireZteOlt(schema, oltId);
    if (!onuIf?.trim()) {
      throw new BadRequestException('onuIf requerido');
    }
    const result = await this.withTimeout(
      this.zteOlt.getOnuLiveTraffic({
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

  async detail(user: AuthUser, oltId: string, onuIf: string) {
    const schema = this.requireSchema(user);
    const olt = await this.requireZteOlt(schema, oltId);
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
    try {
      live = await this.withTimeout(
        this.zteOlt.getConnectedOnuDetail({
          ...this.zteConn(olt),
          onuIf: onuIf.trim(),
        }),
        90_000,
        `Detail ${onuIf}`,
      );
    } catch {
      live = null;
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

    const persisted = row
      ? this.serializeOnu(row, olt.name)
      : base;

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
      const poolRepo =
        await this.tenantConnections.getIpPoolRepository(schema);
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
        onlineDuration: o?.onlineDuration ?? null,
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
    const olt = await this.requireZteOlt(schema, oltId);
    if (!onuIf?.trim()) {
      throw new BadRequestException('onuIf requerido');
    }
    const result = await this.withTimeout(
      this.zteOlt.rebootOnu({
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
    const olt = await this.requireZteOlt(schema, oltId);
    if (!onuIf?.trim()) {
      throw new BadRequestException('onuIf requerido');
    }
    const ifName = onuIf.trim();
    const result = await this.withTimeout(
      this.zteOlt.disableOnu({
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
    const olt = await this.requireZteOlt(schema, oltId);
    if (!onuIf?.trim()) {
      throw new BadRequestException('onuIf requerido');
    }
    const ifName = onuIf.trim();
    const result = await this.withTimeout(
      this.zteOlt.enableOnu({
        ...this.zteConn(olt),
        onuIf: ifName,
      }),
      60_000,
      `ONU enable ${ifName}`,
    );
    if (!result.ok) {
      throw new BadRequestException(
        result.error || 'Fallo al rehabilitar ONU',
      );
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
    const olt = await this.requireZteOlt(schema, oltId);
    if (!onuIf?.trim()) {
      throw new BadRequestException('onuIf requerido');
    }
    const ifName = onuIf.trim();
    const result = await this.withTimeout(
      this.zteOlt.deleteOnu({
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
   * samples, and sample traffic rates (~1/min per online ONU).
   */
  async pollMetricsForSchema(schema: string): Promise<void> {
    const olts = await this.listZteOlts(schema);
    const onuRepo = await this.tenantConnections.getOnuRepository(schema);
    const samples =
      await this.tenantConnections.getOnuMetricSampleRepository(schema);

    for (const olt of olts) {
      if (olt.connectionStatus === 'disconnected') continue;
      if (!olt.mgmtHost || !olt.mgmtUsername || !olt.mgmtPassword) continue;
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
    try {
      const traffic = await this.withTimeout(
        this.zteOlt.sampleOnuTrafficRates({
          ...this.zteConn(olt),
          onuIfs: rows.map((r) => r.onuIf),
        }),
        120_000,
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
    onuRepo: Awaited<
      ReturnType<TenantConnectionService['getOnuRepository']>
    >,
    samples: Awaited<
      ReturnType<TenantConnectionService['getOnuMetricSampleRepository']>
    >,
  ) {
    const existing = await onuRepo.find({ where: { oltId: olt.id } });

    // Speed samples first (target ~1/min), before slower inventory refresh.
    const previouslyOnline = existing.filter((r) => r.online);
    if (previouslyOnline.length > 0) {
      await this.sampleTrafficForOnus(olt, previouslyOnline, samples);
    }

    const discovered = await this.withTimeout(
      this.zteOlt.listConnectedOnus({
        ...this.zteConn(olt),
        // Names come from Sync / detail — avoid full running-config every minute.
        includeRunningConfig: false,
      }),
      180_000,
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
      if (
        this.isRecentlyDeleted(schema, olt.id, snap.onuIf, snap.sn ?? null)
      ) {
        continue;
      }
      seen.add(snap.onuIf.toLowerCase());
      const row = byIf.get(snap.onuIf.toLowerCase());
      if (!row) continue; // inventory add is Sync's job
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
      // Soft-offline only; do not save() a detached entity (that resurrects deletes).
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

    // Backfill SN (and name if still empty) via detail-info — max 8 / tick.
    const stillThere = await onuRepo.find({ where: { oltId: olt.id } });
    const missing = stillThere
      .filter((r) => !r.sn || !r.name)
      .slice(0, 8);
    for (const row of missing) {
      if (this.isRecentlyDeleted(schema, olt.id, row.onuIf, row.sn)) {
        continue;
      }
      try {
        const detail = await this.withTimeout(
          this.zteOlt.getConnectedOnuDetail({
            ...this.zteConn(olt),
            onuIf: row.onuIf,
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
            status: o.status ?? row.status,
            phaseState: o.phaseState ?? row.phaseState,
            adminState: o.adminState ?? row.adminState,
            online: o.online ?? row.online,
            signalDbm: o.signalDbm ?? row.signalDbm,
            mode: o.mode ?? row.mode,
            vlan: o.vlan ?? row.vlan,
            vlans: o.vlans?.length ? o.vlans : row.vlans,
            lastProbedAt: new Date(),
          },
        );
      } catch {
        /* skip one */
      }
    }

    // Register model codes in global catalog / tenant types
    const after = await onuRepo.find({ where: { oltId: olt.id } });
    const models = new Set(
      [
        ...discovered.onus.map((o) => o.onuType),
        ...after.map((r) => r.onuType),
      ].filter((t): t is string => Boolean(t?.trim())),
    );
    for (const m of models) {
      await this.rememberModel(schema, m);
    }
  }
}
