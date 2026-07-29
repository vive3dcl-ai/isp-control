import { Injectable, Logger } from '@nestjs/common';
import * as snmp from 'net-snmp';
import {
  IF_MIB,
  ZTE_LEGACY,
  ZTE_V21,
  ZTE_XPON_ONU_IF,
  buildOnuIf,
  decodeOnuIdIfIndex,
  encodeOnuIdIfIndex,
  encodeXponOnuIfIndex,
  lastOidIndex,
  mapV21Status,
  parseOnuIf,
  parseWalkIndexes,
  rawOpticalToDbm,
} from './zte-olt-snmp.oids';

export type ZteSnmpConn = {
  host: string;
  snmpPort?: number | null;
  /** Read-only community only — never pass RW here. */
  snmpCommunity: string;
};

export type ZteSnmpOnuRow = {
  onuIf: string;
  shelf: string;
  slot: string;
  port: string;
  onuId: string;
  sn: string | null;
  name: string | null;
  phaseState: string | null;
  online: boolean;
  status: 'online' | 'offline';
  signalDbm: number | null;
  /** IF-MIB ifIndex when resolved via ifName. */
  ifIndex: number | null;
  /** OLT input octets (customer upload). */
  inOctets: number | null;
  /** OLT output octets (customer download). */
  outOctets: number | null;
};

export type ZteSnmpMonitorResult = {
  ok: boolean;
  error?: string;
  source: 'snmp_v21' | 'snmp_legacy' | 'none';
  onus: ZteSnmpOnuRow[];
  probedAt: string;
};

export type ZteSnmpProbeResult = {
  ok: boolean;
  error?: string;
  sysUpTimeTicks?: number;
  /** Whether the SNMPv2 IF-MIB ifXTable can be walked on this firmware. */
  ifTableV2Compatible?: boolean;
  warning?: string;
};

export type ZteSnmpPortRow = {
  ifName: string;
  ifIndex: number;
  kind: 'uplink' | 'pon';
  family: 'gpon' | 'epon' | null;
  shelf: string | null;
  slot: string | null;
  port: string | null;
  adminEnabled: boolean;
  operUp: boolean;
  /** Human status similar to CLI (Up / Down / 10G-FullD / …). */
  status: string;
  speedMbps: number | null;
  inOctets: number | null;
  outOctets: number | null;
};

export type ZteSnmpPortsResult = {
  ok: boolean;
  error?: string;
  uplinks: ZteSnmpPortRow[];
  ponPorts: ZteSnmpPortRow[];
  probedAt: string;
};

type Session = ReturnType<typeof snmp.createSession>;

type SnmpLockPriority = 'interactive' | 'background';

type SnmpLockWaiter = {
  priority: SnmpLockPriority;
  run: () => void;
};

/**
 * ZTE OLT SNMP v2c client — GET/WALK only (no SET).
 * Used for ONU monitoring so Telnet/SSH stays free for provisioning.
 */
@Injectable()
export class ZteOltSnmpClient {
  private readonly logger = new Logger(ZteOltSnmpClient.name);
  /** Cache IF-MIB ifIndex per host+onuIf (filled by full walks / live samples). */
  private readonly ifIndexCache = new Map<string, number>();
  /**
   * Some ZTE firmwares only expose PON/uplink ifNames (gpon_1/2/x), not
   * per-ONU gpon-onu_* — IF-MIB counters are useless for ONU traffic then.
   */
  private readonly hostLacksOnuIfNames = new Set<string>();
  /** Per-host SNMP serialization (OLT agents dislike concurrent walks/GETs). */
  private readonly snmpBusy = new Set<string>();
  private readonly snmpWaiters = new Map<string, SnmpLockWaiter[]>();

  private ifIndexKey(host: string, onuIf: string) {
    return `${host.trim().toLowerCase()}|${onuIf.trim().toLowerCase()}`;
  }

  /** True when this OLT's ifName table has no gpon-onu_* / epon-onu_* rows. */
  lacksOnuIfNames(host: string): boolean {
    return this.hostLacksOnuIfNames.has(this.hostKey(host));
  }

  private hostKey(host: string) {
    return host.trim().toLowerCase();
  }

  /**
   * Serialize SNMP per OLT. Interactive (modal live) jumps the queue ahead of
   * background walks so charts can refresh every few seconds.
   */
  private withSnmpLock<T>(
    host: string,
    priority: SnmpLockPriority,
    fn: () => Promise<T>,
  ): Promise<T> {
    const key = this.hostKey(host);
    return new Promise<T>((resolve, reject) => {
      const waiter: SnmpLockWaiter = {
        priority,
        run: () => {
          void (async () => {
            try {
              resolve(await fn());
            } catch (err) {
              reject(err instanceof Error ? err : new Error(String(err)));
            } finally {
              this.snmpBusy.delete(key);
              this.pumpSnmp(key);
            }
          })();
        },
      };
      const q = this.snmpWaiters.get(key) ?? [];
      if (priority === 'interactive') {
        const firstBg = q.findIndex((w) => w.priority === 'background');
        if (firstBg < 0) q.push(waiter);
        else q.splice(firstBg, 0, waiter);
      } else {
        q.push(waiter);
      }
      this.snmpWaiters.set(key, q);
      this.pumpSnmp(key);
    });
  }

  private pumpSnmp(key: string) {
    if (this.snmpBusy.has(key)) return;
    const q = this.snmpWaiters.get(key);
    if (!q?.length) return;
    // Prefer interactive waiters already unshifted; keep FIFO within priority.
    const idx = q.findIndex((w) => w.priority === 'interactive');
    const next = idx >= 0 ? q.splice(idx, 1)[0] : q.shift();
    if (!next) return;
    this.snmpBusy.add(key);
    next.run();
  }

  rememberIfIndex(host: string, onuIf: string, ifIndex: number) {
    if (ifIndex > 0) {
      this.ifIndexCache.set(this.ifIndexKey(host, onuIf), ifIndex);
    }
  }

  /**
   * Fast GET for a single ONU (modal live view). No full walk.
   * Status + Rx via V2.1 OIDs; traffic if ifIndex is cached or resolved once.
   */
  async sampleOneOnu(
    params: ZteSnmpConn & { onuIf: string; ifIndexHint?: number | null },
  ): Promise<{ ok: boolean; error?: string; onu?: ZteSnmpOnuRow }> {
    return this.withSnmpLock(params.host, 'interactive', () =>
      this.sampleOneOnuUnlocked(params),
    );
  }

  private async sampleOneOnuUnlocked(
    params: ZteSnmpConn & { onuIf: string; ifIndexHint?: number | null },
  ): Promise<{ ok: boolean; error?: string; onu?: ZteSnmpOnuRow }> {
    const community = params.snmpCommunity?.trim();
    const parsed = parseOnuIf(params.onuIf);
    if (!params.host?.trim() || !community) {
      return { ok: false, error: 'SNMP host/community missing' };
    }
    if (!parsed) {
      return { ok: false, error: `onuIf inválido: ${params.onuIf}` };
    }

    let session: Session | null = null;
    try {
      // Live GETs are fast; ifIndex resolve may walk ifName once.
      session = this.openSession(params, { timeoutMs: 10_000, retries: 1 });
      const ponIfIndex = encodeOnuIdIfIndex(parsed.slot, parsed.pon);
      const suffix = `${ponIfIndex}.${parsed.onuId}`;

      const basics = await this.getMany(session, [
        `${ZTE_V21.status}.${suffix}`,
        `${ZTE_V21.rxPower}.${suffix}`,
        `${ZTE_V21.name}.${suffix}`,
        `${ZTE_V21.serial}.${suffix}`,
      ]);
      const byOid = new Map(basics.map((v) => [v.oid.replace(/^\./, ''), v]));
      const statusVb = byOid.get(`${ZTE_V21.status}.${suffix}`);
      const rxVb = byOid.get(`${ZTE_V21.rxPower}.${suffix}`);
      const nameVb = byOid.get(`${ZTE_V21.name}.${suffix}`);
      const snVb = byOid.get(`${ZTE_V21.serial}.${suffix}`);

      const code = this.asNumber(statusVb?.value);
      const mapped =
        code != null
          ? mapV21Status(code)
          : {
              phaseState: null as string | null,
              online: false,
              status: 'offline' as const,
            };

      const row: ZteSnmpOnuRow = {
        onuIf: params.onuIf.trim(),
        shelf: String(parsed.shelf),
        slot: String(parsed.slot),
        port: String(parsed.pon),
        onuId: String(parsed.onuId),
        sn: this.asSerial(snVb?.value),
        name: this.asString(nameVb?.value)?.trim() || null,
        phaseState: mapped.phaseState,
        online: mapped.online,
        status: mapped.status,
        signalDbm: (() => {
          const raw = this.asNumber(rxVb?.value);
          return raw != null ? rawOpticalToDbm(raw) : null;
        })(),
        ifIndex: null,
        inOctets: null,
        outOctets: null,
      };

      // Some firmwares expose Rx under …onuId.1 (channel).
      if (row.signalDbm == null) {
        const rxCh = await this.getOne(
          session,
          `${ZTE_V21.rxPower}.${suffix}.1`,
        );
        const raw = this.asNumber(rxCh?.value);
        if (raw != null) row.signalDbm = rawOpticalToDbm(raw);
      }

      // Per-ONU traffic via ZTE XPON MIB (not IF-MIB — many OLTs omit gpon-onu_*).
      const xponIdx = encodeXponOnuIfIndex(
        parsed.slot,
        parsed.pon,
        parsed.onuId,
      );
      row.ifIndex = xponIdx;
      this.rememberIfIndex(params.host, row.onuIf, xponIdx);
      try {
        const counters = await this.getMany(session, [
          `${ZTE_XPON_ONU_IF.rxOctets}.${xponIdx}`,
          `${ZTE_XPON_ONU_IF.txOctets}.${xponIdx}`,
        ]);
        const byOid = new Map(
          counters.map((v) => [v.oid.replace(/^\./, ''), v]),
        );
        // RxOctets = OLT input (upload); TxOctets = OLT output (download).
        row.inOctets = this.asCounter(
          byOid.get(`${ZTE_XPON_ONU_IF.rxOctets}.${xponIdx}`)?.value,
        );
        row.outOctets = this.asCounter(
          byOid.get(`${ZTE_XPON_ONU_IF.txOctets}.${xponIdx}`)?.value,
        );
      } catch {
        /* counters optional */
      }

      return { ok: true, onu: row };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    } finally {
      try {
        session?.close();
      } catch {
        /* ignore */
      }
    }
  }

  /** Resolve IF-MIB ifIndex for one onuIf (cached after first hit). */
  private async resolveIfIndex(
    session: Session,
    onuIf: string,
    host?: string,
  ): Promise<number | null> {
    const want = onuIf.trim().toLowerCase();
    const short =
      want.match(/^(?:g|e)pon-onu_\d+\/(\d+)\/(\d+):(\d+)$/i) ??
      want.match(/(\d+)\/(\d+):(\d+)$/);
    const shortKey = short
      ? `${short[1]}/${short[2]}:${short[3]}`.toLowerCase()
      : null;
    try {
      const names = await this.subtree(session, IF_MIB.ifName);
      let onuNameCount = 0;
      for (const vb of names) {
        const name = this.asString(vb.value)?.trim().toLowerCase();
        if (!name || !/^(g|e)pon-onu_/i.test(name)) continue;
        onuNameCount += 1;
        const idx = lastOidIndex(vb.oid);
        if (idx == null) continue;
        if (name === want) return idx;
        if (shortKey) {
          const m = name.match(/^(?:g|e)pon-onu_[\d/]*?(\d+)\/(\d+):(\d+)$/i);
          if (m && `${m[1]}/${m[2]}:${m[3]}`.toLowerCase() === shortKey) {
            return idx;
          }
        }
      }
      if (host && onuNameCount === 0) {
        this.hostLacksOnuIfNames.add(this.hostKey(host));
        this.logger.warn(
          `IF-MIB ifName on ${host}: ${names.length} ifaces, 0 ONU — traffic via CLI`,
        );
      } else {
        this.logger.debug(
          `resolveIfIndex: no match for ${onuIf} in ${names.length} ifNames (${onuNameCount} ONU)`,
        );
      }
    } catch (err) {
      this.logger.warn(
        `resolveIfIndex(${onuIf}): ${err instanceof Error ? err.message : err}`,
      );
      return null;
    }
    return null;
  }

  async probeSnmp(params: ZteSnmpConn): Promise<ZteSnmpProbeResult> {
    const community = params.snmpCommunity?.trim();
    if (!params.host?.trim() || !community) {
      return { ok: false, error: 'SNMP host/community missing' };
    }
    try {
      const session = this.openSession(params);
      try {
        const vb = await this.getOne(session, IF_MIB.sysUpTime);
        const ticks = this.asNumber(vb?.value);
        let ifNames: Array<{ oid: string; value: unknown }> = [];
        let warning: string | undefined;
        try {
          ifNames = await this.subtree(session, IF_MIB.ifName);
          if (
            !ifNames.some((row) => Boolean(this.asString(row.value)?.trim()))
          ) {
            warning =
              'IF-MIB ifXTable v2 incompatible: ifName vacío; inventario/contadores usarán MIB propietaria o CLI';
          }
        } catch (error) {
          warning = `IF-MIB ifXTable v2 incompatible: ${
            error instanceof Error ? error.message : String(error)
          }`;
        }
        if (warning) this.logger.warn(`${params.host}: ${warning}`);
        return {
          ok: true,
          sysUpTimeTicks: ticks ?? undefined,
          ifTableV2Compatible: !warning,
          warning,
        };
      } finally {
        session.close();
      }
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Walk ONU status + serial + Rx power (+ IF-MIB counters when possible).
   * Prefer V2.1 (3902.1082); fall back to legacy 1012 tree.
   */
  async walkOnuMonitor(params: ZteSnmpConn): Promise<ZteSnmpMonitorResult> {
    return this.withSnmpLock(params.host, 'background', () =>
      this.walkOnuMonitorUnlocked(params),
    );
  }

  private async walkOnuMonitorUnlocked(
    params: ZteSnmpConn,
  ): Promise<ZteSnmpMonitorResult> {
    const probedAt = new Date().toISOString();
    const community = params.snmpCommunity?.trim();
    if (!params.host?.trim() || !community) {
      return {
        ok: false,
        error: 'SNMP host/community missing',
        source: 'none',
        onus: [],
        probedAt,
      };
    }

    let session: Session | null = null;
    try {
      // Walks (esp. ifName) need a longer per-PDU budget than live GETs.
      session = this.openSession(params, { timeoutMs: 12_000, retries: 1 });

      let rows = await this.collectV21(session);
      let source: ZteSnmpMonitorResult['source'] = 'snmp_v21';
      if (!rows.size) {
        rows = await this.collectLegacy(session);
        source = rows.size ? 'snmp_legacy' : 'none';
      }

      if (!rows.size) {
        return {
          ok: false,
          error: 'SNMP walk returned no ONU rows',
          source: 'none',
          onus: [],
          probedAt,
        };
      }

      await this.attachXponTrafficCounters(session, rows, params.host);
      // Optional IF-MIB fallback when XPON MIB is empty (rare firmwares).
      let withTraffic = [...rows.values()].filter(
        (o) => o.inOctets != null && o.outOctets != null,
      ).length;
      if (withTraffic === 0) {
        await this.attachTrafficCounters(session, rows, params.host);
        withTraffic = [...rows.values()].filter(
          (o) => o.inOctets != null && o.outOctets != null,
        ).length;
      }

      const onus = [...rows.values()].sort((a, b) =>
        a.onuIf.localeCompare(b.onuIf, undefined, { numeric: true }),
      );
      const withIf = onus.filter((o) => o.ifIndex != null).length;
      this.logger.log(
        `SNMP monitor ${params.host}: ${onus.length} ONUs (${source}), ${withIf} with ifIndex, ${withTraffic} with traffic`,
      );
      return { ok: true, source, onus, probedAt };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`SNMP monitor ${params.host}: ${message}`);
      return {
        ok: false,
        error: message,
        source: 'none',
        onus: [],
        probedAt,
      };
    } finally {
      try {
        session?.close();
      } catch {
        /* ignore */
      }
    }
  }

  /**
   * List uplink (gei_/xgei_) + PON OLT ports via IF-MIB (status/speed/counters).
   * Config (description, tagged VLANs, ranges) is not here — use CLI cache.
   */
  async walkOltPorts(params: ZteSnmpConn): Promise<ZteSnmpPortsResult> {
    return this.withSnmpLock(params.host, 'background', () =>
      this.walkOltPortsUnlocked(params),
    );
  }

  private async walkOltPortsUnlocked(
    params: ZteSnmpConn,
  ): Promise<ZteSnmpPortsResult> {
    const probedAt = new Date().toISOString();
    const community = params.snmpCommunity?.trim();
    if (!params.host?.trim() || !community) {
      return {
        ok: false,
        error: 'SNMP host/community missing',
        uplinks: [],
        ponPorts: [],
        probedAt,
      };
    }

    let session: Session | null = null;
    try {
      session = this.openSession(params);
      const ifNames = await this.subtree(session, IF_MIB.ifName);
      const wanted: Array<{
        ifIndex: number;
        ifName: string;
        kind: 'uplink' | 'pon';
        family: 'gpon' | 'epon' | null;
        shelf: string | null;
        slot: string | null;
        port: string | null;
      }> = [];

      for (const vb of ifNames) {
        const name = this.asString(vb.value)?.trim();
        if (!name) continue;
        const ifIndex = lastOidIndex(vb.oid);
        if (ifIndex == null) continue;
        const up = name.match(/^((?:x)?gei_[\d/]+)$/i);
        if (up) {
          wanted.push({
            ifIndex,
            ifName: up[1],
            kind: 'uplink',
            family: null,
            shelf: null,
            slot: null,
            port: null,
          });
          this.rememberIfIndex(params.host, up[1], ifIndex);
          continue;
        }
        // CLI C3xx: gpon-olt_1/2/1; C6xx: gpon_olt-1/2/1; SNMP short: gpon_1/2/1
        const pon =
          name.match(/^(gpon|epon)-olt_(\d+)\/(\d+)\/(\d+)$/i) ||
          name.match(/^(gpon|epon)_olt-(\d+)\/(\d+)\/(\d+)$/i) ||
          name.match(/^(gpon|epon)_(\d+)\/(\d+)\/(\d+)$/i);
        if (pon) {
          const family = pon[1].toLowerCase() === 'epon' ? 'epon' : 'gpon';
          const canonical = `${family}-olt_${pon[2]}/${pon[3]}/${pon[4]}`;
          wanted.push({
            ifIndex,
            ifName: canonical,
            kind: 'pon',
            family,
            shelf: pon[2],
            slot: pon[3],
            port: pon[4],
          });
          this.rememberIfIndex(params.host, canonical, ifIndex);
          if (name !== canonical) {
            this.rememberIfIndex(params.host, name, ifIndex);
          }
        }
      }

      if (!wanted.length) {
        return {
          ok: false,
          error: 'SNMP: no gei_/xgei_/gpon-olt_/gpon_/epon-olt_ interfaces',
          uplinks: [],
          ponPorts: [],
          probedAt,
        };
      }

      const rows: ZteSnmpPortRow[] = [];
      const chunkSize = 8;
      for (let i = 0; i < wanted.length; i += chunkSize) {
        const chunk = wanted.slice(i, i + chunkSize);
        const oids: string[] = [];
        for (const w of chunk) {
          oids.push(`${IF_MIB.ifAdminStatus}.${w.ifIndex}`);
          oids.push(`${IF_MIB.ifOperStatus}.${w.ifIndex}`);
          oids.push(`${IF_MIB.ifHighSpeed}.${w.ifIndex}`);
          oids.push(`${IF_MIB.ifHCInOctets}.${w.ifIndex}`);
          oids.push(`${IF_MIB.ifHCOutOctets}.${w.ifIndex}`);
        }
        let varbinds: Array<{ oid: string; value: unknown }>;
        try {
          varbinds = await this.getMany(session, oids);
        } catch {
          continue;
        }
        const byOid = new Map(
          varbinds.map((v) => [v.oid.replace(/^\./, ''), v]),
        );
        for (const w of chunk) {
          const admin =
            this.asNumber(
              byOid.get(`${IF_MIB.ifAdminStatus}.${w.ifIndex}`)?.value,
            ) ?? 2;
          const oper =
            this.asNumber(
              byOid.get(`${IF_MIB.ifOperStatus}.${w.ifIndex}`)?.value,
            ) ?? 2;
          const speedMbps = this.asNumber(
            byOid.get(`${IF_MIB.ifHighSpeed}.${w.ifIndex}`)?.value,
          );
          const adminEnabled = admin === 1;
          const operUp = oper === 1;
          rows.push({
            ifName: w.ifName,
            ifIndex: w.ifIndex,
            kind: w.kind,
            family: w.family,
            shelf: w.shelf,
            slot: w.slot,
            port: w.port,
            adminEnabled,
            operUp,
            status: this.formatPortStatus(adminEnabled, operUp, speedMbps),
            speedMbps: speedMbps != null && speedMbps > 0 ? speedMbps : null,
            inOctets: this.asCounter(
              byOid.get(`${IF_MIB.ifHCInOctets}.${w.ifIndex}`)?.value,
            ),
            outOctets: this.asCounter(
              byOid.get(`${IF_MIB.ifHCOutOctets}.${w.ifIndex}`)?.value,
            ),
          });
        }
      }

      const uplinks = rows
        .filter((r) => r.kind === 'uplink')
        .sort((a, b) =>
          a.ifName.localeCompare(b.ifName, undefined, { numeric: true }),
        );
      const ponPorts = rows
        .filter((r) => r.kind === 'pon')
        .sort((a, b) =>
          a.ifName.localeCompare(b.ifName, undefined, { numeric: true }),
        );

      this.logger.log(
        `SNMP ports ${params.host}: ${uplinks.length} uplinks, ${ponPorts.length} PON`,
      );
      return { ok: true, uplinks, ponPorts, probedAt };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`SNMP ports ${params.host}: ${message}`);
      return {
        ok: false,
        error: message,
        uplinks: [],
        ponPorts: [],
        probedAt,
      };
    } finally {
      try {
        session?.close();
      } catch {
        /* ignore */
      }
    }
  }

  private formatPortStatus(
    adminEnabled: boolean,
    operUp: boolean,
    speedMbps: number | null,
  ): string {
    if (!adminEnabled || !operUp) return 'Down';
    if (speedMbps != null && speedMbps >= 10000) return '10G-FullD';
    if (speedMbps != null && speedMbps >= 1000) return '1G-FullD';
    if (speedMbps != null && speedMbps >= 100) return '100M-FullD';
    return 'Up';
  }

  private openSession(
    params: ZteSnmpConn,
    opts?: { timeoutMs?: number; retries?: number },
  ): Session {
    const port = params.snmpPort && params.snmpPort > 0 ? params.snmpPort : 161;
    return snmp.createSession(params.host, params.snmpCommunity.trim(), {
      port,
      version: snmp.Version2c,
      timeout: opts?.timeoutMs ?? 5000,
      retries: opts?.retries ?? 1,
      idBitsSize: 32,
    });
  }

  private async collectV21(
    session: Session,
  ): Promise<Map<string, ZteSnmpOnuRow>> {
    const byKey = new Map<string, ZteSnmpOnuRow>();

    const ensure = (
      ponIfIndex: number,
      onuId: number,
    ): ZteSnmpOnuRow | null => {
      const decoded = decodeOnuIdIfIndex(ponIfIndex);
      if (!decoded) return null;
      const key = `${ponIfIndex}.${onuId}`;
      let row = byKey.get(key);
      if (!row) {
        row = {
          onuIf: buildOnuIf(
            'gpon',
            decoded.shelf,
            decoded.slot,
            decoded.pon,
            onuId,
          ),
          shelf: String(decoded.shelf),
          slot: String(decoded.slot),
          port: String(decoded.pon),
          onuId: String(onuId),
          sn: null,
          name: null,
          phaseState: null,
          online: false,
          status: 'offline',
          signalDbm: null,
          ifIndex: null,
          inOctets: null,
          outOctets: null,
        };
        byKey.set(key, row);
      }
      return row;
    };

    const statusWalk = await this.subtree(session, ZTE_V21.status);
    for (const vb of statusWalk) {
      const idx = parseWalkIndexes(vb.oid, ZTE_V21.status);
      if (!idx) continue;
      const row = ensure(idx.ponIfIndex, idx.onuId);
      if (!row) continue;
      const code = this.asNumber(vb.value);
      if (code == null) continue;
      const mapped = mapV21Status(code);
      row.phaseState = mapped.phaseState;
      row.online = mapped.online;
      row.status = mapped.status;
    }

    if (!byKey.size) return byKey;

    const serialWalk = await this.subtree(session, ZTE_V21.serial);
    for (const vb of serialWalk) {
      const idx = parseWalkIndexes(vb.oid, ZTE_V21.serial);
      if (!idx) continue;
      const row = byKey.get(`${idx.ponIfIndex}.${idx.onuId}`);
      if (!row) continue;
      row.sn = this.asSerial(vb.value);
    }

    const nameWalk = await this.subtree(session, ZTE_V21.name);
    for (const vb of nameWalk) {
      const idx = parseWalkIndexes(vb.oid, ZTE_V21.name);
      if (!idx) continue;
      const row = byKey.get(`${idx.ponIfIndex}.${idx.onuId}`);
      if (!row) continue;
      const name = this.asString(vb.value)?.trim();
      if (name) row.name = name;
    }

    const rxWalk = await this.subtree(session, ZTE_V21.rxPower);
    let rxHits = 0;
    for (const vb of rxWalk) {
      const idx = parseWalkIndexes(vb.oid, ZTE_V21.rxPower);
      if (!idx) continue;
      const row = byKey.get(`${idx.ponIfIndex}.${idx.onuId}`);
      if (!row) continue;
      const raw = this.asNumber(vb.value);
      if (raw == null) continue;
      const dbm = rawOpticalToDbm(raw);
      if (dbm == null) continue;
      row.signalDbm = dbm;
      rxHits += 1;
    }
    if (byKey.size && rxHits === 0) {
      this.logger.warn(
        `SNMP V2.1: ${byKey.size} ONUs but 0 Rx hits (walk=${rxWalk.length})`,
      );
    }

    return byKey;
  }

  /**
   * Legacy tree: match primarily by serial; decode indexes best-effort.
   */
  private async collectLegacy(
    session: Session,
  ): Promise<Map<string, ZteSnmpOnuRow>> {
    const byKey = new Map<string, ZteSnmpOnuRow>();

    const statusWalk = await this.subtree(session, ZTE_LEGACY.status);
    for (const vb of statusWalk) {
      const parts = vb.oid.replace(/^\./, '').split('.');
      const onuId = Number(parts[parts.length - 1]);
      const ponIfIndex = Number(parts[parts.length - 2]);
      if (!Number.isFinite(onuId) || !Number.isFinite(ponIfIndex)) continue;
      const decoded = decodeOnuIdIfIndex(ponIfIndex);
      const shelf = decoded?.shelf ?? 1;
      const slot = decoded?.slot ?? 0;
      const pon = decoded?.pon ?? 0;
      const key = `${ponIfIndex}.${onuId}`;
      const code = this.asNumber(vb.value) ?? 7;
      // Legacy status enums often differ; treat 3/4/6 as online-ish (working).
      const online = code === 3 || code === 4 || code === 6;
      byKey.set(key, {
        onuIf: buildOnuIf('gpon', shelf, slot || 1, pon || 1, onuId),
        shelf: String(shelf),
        slot: String(slot || ''),
        port: String(pon || ''),
        onuId: String(onuId),
        sn: null,
        name: null,
        phaseState: online ? 'working' : 'Offline',
        online,
        status: online ? 'online' : 'offline',
        signalDbm: null,
        ifIndex: null,
        inOctets: null,
        outOctets: null,
      });
    }

    if (!byKey.size) return byKey;

    const serialWalk = await this.subtree(session, ZTE_LEGACY.serial);
    for (const vb of serialWalk) {
      const parts = vb.oid.replace(/^\./, '').split('.');
      const onuId = Number(parts[parts.length - 1]);
      const ponIfIndex = Number(parts[parts.length - 2]);
      const row = byKey.get(`${ponIfIndex}.${onuId}`);
      if (!row) continue;
      row.sn = this.asSerial(vb.value);
    }

    const rxWalk = await this.subtree(session, ZTE_LEGACY.rxPower);
    for (const vb of rxWalk) {
      const parts = vb.oid.replace(/^\./, '').split('.');
      const onuId = Number(parts[parts.length - 1]);
      const ponIfIndex = Number(parts[parts.length - 2]);
      const row = byKey.get(`${ponIfIndex}.${onuId}`);
      if (!row) continue;
      const raw = this.asNumber(vb.value);
      if (raw == null) continue;
      row.signalDbm = rawOpticalToDbm(raw);
    }

    return byKey;
  }

  /**
   * Attach per-ONU octet counters from ZTE XPON MIB (3902.1015.1010.5.5).
   * Prefer this over IF-MIB — C3xx often lists only gpon_1/2/x in ifName.
   */
  private async attachXponTrafficCounters(
    session: Session,
    rows: Map<string, ZteSnmpOnuRow>,
    host?: string,
  ): Promise<void> {
    const wanted: Array<{ row: ZteSnmpOnuRow; idx: number }> = [];
    for (const row of rows.values()) {
      const slot = Number(row.slot);
      const pon = Number(row.port);
      const onuId = Number(row.onuId);
      if (
        !Number.isFinite(slot) ||
        !Number.isFinite(pon) ||
        !Number.isFinite(onuId) ||
        slot < 1 ||
        pon < 1 ||
        onuId < 1
      ) {
        continue;
      }
      const idx = encodeXponOnuIfIndex(slot, pon, onuId);
      wanted.push({ row, idx });
    }
    if (!wanted.length) return;

    let matched = 0;
    const chunkSize = 10;
    for (let i = 0; i < wanted.length; i += chunkSize) {
      const chunk = wanted.slice(i, i + chunkSize);
      const oids: string[] = [];
      for (const w of chunk) {
        oids.push(`${ZTE_XPON_ONU_IF.rxOctets}.${w.idx}`);
        oids.push(`${ZTE_XPON_ONU_IF.txOctets}.${w.idx}`);
      }
      let varbinds: Array<{ oid: string; value: unknown }>;
      try {
        varbinds = await this.getMany(session, oids);
      } catch {
        continue;
      }
      const byOid = new Map(varbinds.map((v) => [v.oid.replace(/^\./, ''), v]));
      for (const w of chunk) {
        const inOctets = this.asCounter(
          byOid.get(`${ZTE_XPON_ONU_IF.rxOctets}.${w.idx}`)?.value,
        );
        const outOctets = this.asCounter(
          byOid.get(`${ZTE_XPON_ONU_IF.txOctets}.${w.idx}`)?.value,
        );
        if (inOctets == null || outOctets == null) continue;
        w.row.ifIndex = w.idx;
        w.row.inOctets = inOctets;
        w.row.outOctets = outOctets;
        if (host) this.rememberIfIndex(host, w.row.onuIf, w.idx);
        matched += 1;
      }
    }

    this.logger.warn(
      `XPON traffic: matched ${matched}/${rows.size} via encoded GET`,
    );
  }

  private async attachTrafficCounters(
    session: Session,
    rows: Map<string, ZteSnmpOnuRow>,
    host?: string,
  ): Promise<void> {
    const byOnuIf = new Map(
      [...rows.values()].map((r) => [r.onuIf.toLowerCase(), r]),
    );
    // Also index without family prefix mismatches: slot/port:id
    const byShort = new Map<string, ZteSnmpOnuRow>();
    for (const r of rows.values()) {
      byShort.set(`${r.slot}/${r.port}:${r.onuId}`.toLowerCase(), r);
    }

    let ifNames: Array<{ oid: string; value: unknown }>;
    try {
      ifNames = await this.subtree(session, IF_MIB.ifName);
    } catch (err) {
      this.logger.warn(
        `IF-MIB ifName walk failed: ${
          err instanceof Error ? err.message : err
        }`,
      );
      return;
    }

    const wanted: Array<{ row: ZteSnmpOnuRow; ifIndex: number }> = [];
    let onuNameCount = 0;
    for (const vb of ifNames) {
      const name = this.asString(vb.value)?.trim().toLowerCase();
      if (!name) continue;
      if (!/^(g|e)pon[-_]onu[_-]/i.test(name)) continue;
      onuNameCount += 1;
      const titan = name.match(/^(g|e)pon_onu-(\d+)\/(\d+)\/(\d+):(\d+)$/i);
      const classic = name.match(/^(g|e)pon-onu_(\d+)\/(\d+)\/(\d+):(\d+)$/i);
      const m = titan || classic;
      if (!m) continue;
      const canonical =
        `${m[1].toLowerCase() === 'e' ? 'epon' : 'gpon'}-onu_${m[2]}/${m[3]}/${m[4]}:${m[5]}`.toLowerCase();
      const ifIndex = lastOidIndex(vb.oid);
      if (ifIndex == null) continue;
      let row = byOnuIf.get(canonical) || byOnuIf.get(name);
      if (!row) {
        row = byShort.get(`${m[3]}/${m[4]}:${m[5]}`.toLowerCase());
      }
      if (!row) continue;
      row.ifIndex = ifIndex;
      row.onuIf = canonical;
      if (host) this.rememberIfIndex(host, row.onuIf, ifIndex);
      wanted.push({ row, ifIndex });
    }

    if (host && onuNameCount === 0) {
      this.hostLacksOnuIfNames.add(this.hostKey(host));
    }

    this.logger.log(
      `IF-MIB: matched ${wanted.length}/${rows.size} ONU ifIndexes (ifName walk ${ifNames.length}, onuNames ${onuNameCount})`,
    );

    if (!wanted.length) return;

    // Batch GETs (max ~20 OIDs per request)
    const chunkSize = 10;
    for (let i = 0; i < wanted.length; i += chunkSize) {
      const chunk = wanted.slice(i, i + chunkSize);
      const oids: string[] = [];
      for (const w of chunk) {
        oids.push(`${IF_MIB.ifHCInOctets}.${w.ifIndex}`);
        oids.push(`${IF_MIB.ifHCOutOctets}.${w.ifIndex}`);
      }
      let varbinds: Array<{ oid: string; value: unknown; type?: number }>;
      try {
        varbinds = await this.getMany(session, oids);
      } catch {
        // Fall back to 32-bit counters
        const oids32: string[] = [];
        for (const w of chunk) {
          oids32.push(`${IF_MIB.ifInOctets}.${w.ifIndex}`);
          oids32.push(`${IF_MIB.ifOutOctets}.${w.ifIndex}`);
        }
        try {
          varbinds = await this.getMany(session, oids32);
        } catch {
          continue;
        }
      }
      const byOid = new Map(varbinds.map((v) => [v.oid.replace(/^\./, ''), v]));
      for (const w of chunk) {
        const inVb =
          byOid.get(`${IF_MIB.ifHCInOctets}.${w.ifIndex}`) ??
          byOid.get(`${IF_MIB.ifInOctets}.${w.ifIndex}`);
        const outVb =
          byOid.get(`${IF_MIB.ifHCOutOctets}.${w.ifIndex}`) ??
          byOid.get(`${IF_MIB.ifOutOctets}.${w.ifIndex}`);
        w.row.inOctets = this.asCounter(inVb?.value);
        w.row.outOctets = this.asCounter(outVb?.value);
      }
    }
  }

  private getOne(
    session: Session,
    oid: string,
  ): Promise<{ oid: string; value: unknown } | null> {
    return new Promise((resolve, reject) => {
      session.get([oid], (error: Error | null, varbinds: snmp.Varbind[]) => {
        if (error) {
          reject(error);
          return;
        }
        const vb = varbinds?.[0];
        if (!vb || snmp.isVarbindError(vb)) {
          resolve(null);
          return;
        }
        resolve({ oid: vb.oid, value: vb.value });
      });
    });
  }

  private getMany(
    session: Session,
    oids: string[],
  ): Promise<Array<{ oid: string; value: unknown; type?: number }>> {
    return new Promise((resolve, reject) => {
      session.get(oids, (error: Error | null, varbinds: snmp.Varbind[]) => {
        if (error) {
          reject(error);
          return;
        }
        const out: Array<{ oid: string; value: unknown; type?: number }> = [];
        for (const vb of varbinds ?? []) {
          if (snmp.isVarbindError(vb)) continue;
          out.push({ oid: vb.oid, value: vb.value, type: vb.type });
        }
        resolve(out);
      });
    });
  }

  private subtree(
    session: Session,
    oid: string,
  ): Promise<Array<{ oid: string; value: unknown }>> {
    return new Promise((resolve, reject) => {
      const rows: Array<{ oid: string; value: unknown }> = [];
      // maxRepetitions 20 — never 0 (hangs on some ZTE OLTs)
      session.subtree(
        oid,
        20,
        (varbinds: snmp.Varbind[]) => {
          for (const vb of varbinds) {
            if (snmp.isVarbindError(vb)) continue;
            rows.push({ oid: vb.oid, value: vb.value });
          }
        },
        (error: Error | null) => {
          if (error) reject(error);
          else resolve(rows);
        },
      );
    });
  }

  private asNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'bigint') return Number(value);
    if (Buffer.isBuffer(value)) {
      if (value.length === 0) return null;
      if (value.length === 1) return value.readUInt8(0);
      if (value.length === 2) return value.readInt16BE(0);
      if (value.length === 4) return value.readInt32BE(0);
      if (value.length <= 8) {
        // Counter64 as big-endian
        let n = 0;
        for (let i = 0; i < value.length; i++) n = n * 256 + value[i];
        return n;
      }
    }
    if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) {
      return Number(value.trim());
    }
    return null;
  }

  private asCounter(value: unknown): number | null {
    const n = this.asNumber(value);
    return n != null && n >= 0 ? n : null;
  }

  private asString(value: unknown): string | null {
    if (typeof value === 'string') return value;
    if (Buffer.isBuffer(value)) {
      return value.toString('utf8').replace(/\0/g, '');
    }
    return null;
  }

  private asSerial(value: unknown): string | null {
    let s = this.asString(value);
    if (!s) {
      // Sometimes SN arrives as hex buffer without printable ASCII
      if (Buffer.isBuffer(value) && value.length >= 4) {
        s = value.toString('hex').toUpperCase();
      } else {
        return null;
      }
    }
    s = s.trim();
    if (s.startsWith('1,')) s = s.slice(2);
    s = s.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    return s.length >= 8 ? s : null;
  }
}
