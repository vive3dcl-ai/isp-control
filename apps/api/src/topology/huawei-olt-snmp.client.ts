import { Injectable, Logger } from '@nestjs/common';
import * as snmp from 'net-snmp';
import {
  HW_ONT,
  IF_MIB,
  buildHuaweiOnuIf,
  decodeHuaweiPonIfIndex,
  encodeHuaweiPonIfIndex,
  hwOpticalToDbm,
  mapHwRunStatus,
  parseHwWalkIndexes,
  parseHuaweiOnuIf,
} from './huawei-olt-snmp.oids';
import type {
  ZteSnmpMonitorResult,
  ZteSnmpOnuRow,
  ZteSnmpPortRow,
  ZteSnmpPortsResult,
  ZteSnmpProbeResult,
} from './zte-olt-snmp.client';
import { canonicalizeHuaweiPonIfName } from './huawei-olt-onu.util';

export type HuaweiSnmpConn = {
  host: string;
  snmpPort?: number | null;
  snmpCommunity: string;
};

export type HuaweiSnmpOnuRow = ZteSnmpOnuRow;
export type HuaweiSnmpMonitorResult = Omit<ZteSnmpMonitorResult, 'source'> & {
  source: 'snmp_huawei' | 'none';
};

type Session = ReturnType<typeof snmp.createSession>;

type SnmpLockPriority = 'interactive' | 'background';

type SnmpLockWaiter = {
  priority: SnmpLockPriority;
  run: () => void;
};

/**
 * Huawei SmartAX OLT SNMP v2c — GET/WALK only (no SET).
 * Return shapes align with ZTE so pollers can share persistence logic.
 */
@Injectable()
export class HuaweiOltSnmpClient {
  private readonly logger = new Logger(HuaweiOltSnmpClient.name);
  private readonly ifIndexCache = new Map<string, number>();
  private readonly snmpBusy = new Set<string>();
  private readonly snmpWaiters = new Map<string, SnmpLockWaiter[]>();

  private ifIndexKey(host: string, onuIf: string) {
    return `${host.trim().toLowerCase()}|${onuIf.trim().toLowerCase()}`;
  }

  private hostKey(host: string) {
    return host.trim().toLowerCase();
  }

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

  lacksOnuIfNames(_host: string): boolean {
    void _host;
    return true; // Huawei ONT traffic uses enterprise counters, not IF-MIB ONU names
  }

  async sampleOneOnu(
    params: HuaweiSnmpConn & { onuIf: string; ifIndexHint?: number | null },
  ): Promise<{ ok: boolean; error?: string; onu?: HuaweiSnmpOnuRow }> {
    return this.withSnmpLock(params.host, 'interactive', () =>
      this.sampleOneOnuUnlocked(params),
    );
  }

  private async sampleOneOnuUnlocked(
    params: HuaweiSnmpConn & { onuIf: string; ifIndexHint?: number | null },
  ): Promise<{ ok: boolean; error?: string; onu?: HuaweiSnmpOnuRow }> {
    const community = params.snmpCommunity?.trim();
    const parsed = parseHuaweiOnuIf(params.onuIf);
    if (!params.host?.trim() || !community) {
      return { ok: false, error: 'SNMP host/community missing' };
    }
    if (!parsed) {
      return { ok: false, error: `Invalid Huawei onuIf: ${params.onuIf}` };
    }

    let session: Session | null = null;
    try {
      session = this.openSession(params, { timeoutMs: 5_000, retries: 1 });
      const ponIf = encodeHuaweiPonIfIndex(parsed.slot, parsed.port);
      const suffix = `${ponIf}.${parsed.ontId}`;

      const [statusVb, snVb, rxVb, inVb, outVb] = await Promise.all([
        this.getOne(session, `${HW_ONT.runStatus}.${suffix}`),
        this.getOne(session, `${HW_ONT.serial}.${suffix}`),
        this.getOne(session, `${HW_ONT.rxPower}.${suffix}`),
        this.getOne(session, `${HW_ONT.inOctets}.${suffix}`),
        this.getOne(session, `${HW_ONT.outOctets}.${suffix}`),
      ]);

      const code = this.asNumber(statusVb?.value) ?? 2;
      const mapped = mapHwRunStatus(code);
      const rxRaw = this.asNumber(rxVb?.value);
      const onu: HuaweiSnmpOnuRow = {
        onuIf: params.onuIf,
        shelf: String(parsed.frame),
        slot: String(parsed.slot),
        port: String(parsed.port),
        onuId: String(parsed.ontId),
        sn: this.asSerial(snVb?.value),
        name: null,
        phaseState: mapped.phaseState,
        online: mapped.online,
        status: mapped.status,
        signalDbm: rxRaw != null ? hwOpticalToDbm(rxRaw) : null,
        ifIndex: params.ifIndexHint ?? ponIf,
        inOctets: this.asCounter(inVb?.value),
        outOctets: this.asCounter(outVb?.value),
      };
      return { ok: true, onu };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: message };
    } finally {
      try {
        session?.close();
      } catch {
        /* ignore */
      }
    }
  }

  async probeSnmp(params: HuaweiSnmpConn): Promise<ZteSnmpProbeResult> {
    const community = params.snmpCommunity?.trim();
    if (!params.host?.trim() || !community) {
      return { ok: false, error: 'SNMP host/community missing' };
    }
    let session: Session | null = null;
    try {
      session = this.openSession(params, { timeoutMs: 4_000, retries: 1 });
      const vb = await this.getOne(session, IF_MIB.sysUpTime);
      const ticks = this.asNumber(vb?.value);
      if (ticks == null) {
        return { ok: false, error: 'SNMP sysUpTime unavailable' };
      }
      return { ok: true, sysUpTimeTicks: ticks };
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

  async walkOnuMonitor(
    params: HuaweiSnmpConn,
  ): Promise<HuaweiSnmpMonitorResult> {
    return this.withSnmpLock(params.host, 'background', () =>
      this.walkOnuMonitorUnlocked(params),
    );
  }

  private async walkOnuMonitorUnlocked(
    params: HuaweiSnmpConn,
  ): Promise<HuaweiSnmpMonitorResult> {
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
      session = this.openSession(params, { timeoutMs: 12_000, retries: 1 });
      const rows = await this.collectOnts(session);
      if (!rows.size) {
        return {
          ok: false,
          error: 'SNMP walk returned no ONT rows',
          source: 'none',
          onus: [],
          probedAt,
        };
      }
      await this.attachTraffic(session, rows);

      const onus = [...rows.values()].sort((a, b) =>
        a.onuIf.localeCompare(b.onuIf, undefined, { numeric: true }),
      );
      this.logger.log(
        `Huawei SNMP monitor ${params.host}: ${onus.length} ONTs`,
      );
      return { ok: true, source: 'snmp_huawei', onus, probedAt };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Huawei SNMP monitor ${params.host}: ${message}`);
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

  async walkOltPorts(params: HuaweiSnmpConn): Promise<ZteSnmpPortsResult> {
    return this.withSnmpLock(params.host, 'background', () =>
      this.walkOltPortsUnlocked(params),
    );
  }

  private async walkOltPortsUnlocked(
    params: HuaweiSnmpConn,
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
      session = this.openSession(params, { timeoutMs: 12_000, retries: 1 });
      const ifNames = await this.subtree(session, IF_MIB.ifName);
      const admin = await this.subtree(session, IF_MIB.ifAdminStatus);
      const oper = await this.subtree(session, IF_MIB.ifOperStatus);
      const speed = await this.subtree(session, IF_MIB.ifHighSpeed);

      const adminMap = new Map<number, number>();
      for (const vb of admin) {
        const idx = Number(vb.oid.split('.').pop());
        const v = this.asNumber(vb.value);
        if (Number.isFinite(idx) && v != null) adminMap.set(idx, v);
      }
      const operMap = new Map<number, number>();
      for (const vb of oper) {
        const idx = Number(vb.oid.split('.').pop());
        const v = this.asNumber(vb.value);
        if (Number.isFinite(idx) && v != null) operMap.set(idx, v);
      }
      const speedMap = new Map<number, number>();
      for (const vb of speed) {
        const idx = Number(vb.oid.split('.').pop());
        const v = this.asNumber(vb.value);
        if (Number.isFinite(idx) && v != null) speedMap.set(idx, v);
      }

      const uplinks: ZteSnmpPortRow[] = [];
      const ponByName = new Map<string, ZteSnmpPortRow>();

      for (const vb of ifNames) {
        const name = this.asString(vb.value)?.trim();
        if (!name) continue;
        const ifIndex = Number(vb.oid.split('.').pop());
        if (!Number.isFinite(ifIndex)) continue;
        const adminEnabled = (adminMap.get(ifIndex) ?? 1) === 1;
        const operUp = (operMap.get(ifIndex) ?? 2) === 1;
        const speedMbps = speedMap.get(ifIndex) ?? null;

        const lower = name.toLowerCase();
        if (/epon/i.test(lower)) continue;
        // Huawei: GPON0/1/0, XGPON..., Eth / GigabitEthernet / 10GE
        const ponMatch = lower.match(
          /^(?:gpon|xgpon|xgspon)[^\d]*(\d+)\/(\d+)\/(\d+)/i,
        );
        if (ponMatch) {
          const canonical = canonicalizeHuaweiPonIfName(name);
          if (!canonical) continue;
          const row: ZteSnmpPortRow = {
            ifName: canonical,
            ifIndex,
            kind: 'pon',
            family: 'gpon',
            shelf: ponMatch[1],
            slot: ponMatch[2],
            port: ponMatch[3],
            adminEnabled,
            operUp,
            status: operUp ? 'Up' : 'Down',
            speedMbps,
            inOctets: null,
            outOctets: null,
          };
          const previous = ponByName.get(canonical);
          if (!previous || (!previous.operUp && row.operUp)) {
            ponByName.set(canonical, row);
          }
          continue;
        }

        if (
          /^(eth|gigabit|xgigabit|10ge|ge|xge|meth)/i.test(name) ||
          /^0\/\d+\/\d+$/.test(name)
        ) {
          uplinks.push({
            ifName: name,
            ifIndex,
            kind: 'uplink',
            family: null,
            shelf: null,
            slot: null,
            port: null,
            adminEnabled,
            operUp,
            status: operUp ? (speedMbps ? `${speedMbps}M` : 'Up') : 'Down',
            speedMbps,
            inOctets: null,
            outOctets: null,
          });
        }
      }

      return {
        ok: true,
        uplinks,
        ponPorts: [...ponByName.values()],
        probedAt,
      };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
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

  private async collectOnts(
    session: Session,
  ): Promise<Map<string, HuaweiSnmpOnuRow>> {
    const byKey = new Map<string, HuaweiSnmpOnuRow>();

    const ensure = (ponIfIndex: number, ontId: number) => {
      const key = `${ponIfIndex}.${ontId}`;
      let row = byKey.get(key);
      if (row) return row;
      const decoded = decodeHuaweiPonIfIndex(ponIfIndex);
      const frame = decoded?.frame ?? 0;
      const slot = decoded?.slot ?? 0;
      const port = decoded?.port ?? 0;
      row = {
        onuIf: buildHuaweiOnuIf('gpon', frame, slot, port, ontId),
        shelf: String(frame),
        slot: String(slot),
        port: String(port),
        onuId: String(ontId),
        sn: null,
        name: null,
        phaseState: null,
        online: false,
        status: 'offline',
        signalDbm: null,
        ifIndex: ponIfIndex,
        inOctets: null,
        outOctets: null,
      };
      byKey.set(key, row);
      return row;
    };

    const statusWalk = await this.subtree(session, HW_ONT.runStatus);
    for (const vb of statusWalk) {
      const idx = parseHwWalkIndexes(vb.oid, HW_ONT.runStatus);
      if (!idx) continue;
      const row = ensure(idx.ponIfIndex, idx.ontId);
      const code = this.asNumber(vb.value);
      if (code == null) continue;
      const mapped = mapHwRunStatus(code);
      row.phaseState = mapped.phaseState;
      row.online = mapped.online;
      row.status = mapped.status;
    }

    if (!byKey.size) return byKey;

    for (const vb of await this.subtree(session, HW_ONT.serial)) {
      const idx = parseHwWalkIndexes(vb.oid, HW_ONT.serial);
      if (!idx) continue;
      const row = byKey.get(`${idx.ponIfIndex}.${idx.ontId}`);
      if (row) row.sn = this.asSerial(vb.value);
    }

    for (const vb of await this.subtree(session, HW_ONT.description)) {
      const idx = parseHwWalkIndexes(vb.oid, HW_ONT.description);
      if (!idx) continue;
      const row = byKey.get(`${idx.ponIfIndex}.${idx.ontId}`);
      const name = this.asString(vb.value)?.trim();
      if (row && name) row.name = name;
    }

    for (const vb of await this.subtree(session, HW_ONT.rxPower)) {
      const idx = parseHwWalkIndexes(vb.oid, HW_ONT.rxPower);
      if (!idx) continue;
      const row = byKey.get(`${idx.ponIfIndex}.${idx.ontId}`);
      if (!row) continue;
      const raw = this.asNumber(vb.value);
      if (raw == null) continue;
      row.signalDbm = hwOpticalToDbm(raw);
    }

    return byKey;
  }

  private async attachTraffic(
    session: Session,
    rows: Map<string, HuaweiSnmpOnuRow>,
  ) {
    for (const row of rows.values()) {
      const parsed = parseHuaweiOnuIf(row.onuIf);
      if (!parsed) continue;
      const ponIf = encodeHuaweiPonIfIndex(parsed.slot, parsed.port);
      const suffix = `${ponIf}.${parsed.ontId}`;
      try {
        const [inVb, outVb] = await Promise.all([
          this.getOne(session, `${HW_ONT.inOctets}.${suffix}`),
          this.getOne(session, `${HW_ONT.outOctets}.${suffix}`),
        ]);
        row.inOctets = this.asCounter(inVb?.value);
        row.outOctets = this.asCounter(outVb?.value);
      } catch {
        /* ignore per-ONT */
      }
    }
  }

  private openSession(
    params: HuaweiSnmpConn,
    opts?: { timeoutMs?: number; retries?: number },
  ): Session {
    return snmp.createSession(params.host.trim(), params.snmpCommunity.trim(), {
      port: params.snmpPort && params.snmpPort > 0 ? params.snmpPort : 161,
      version: snmp.Version2c,
      timeout: opts?.timeoutMs ?? 5_000,
      retries: opts?.retries ?? 1,
    });
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

  private subtree(
    session: Session,
    oid: string,
  ): Promise<Array<{ oid: string; value: unknown }>> {
    return new Promise((resolve, reject) => {
      const out: Array<{ oid: string; value: unknown }> = [];
      session.subtree(
        oid,
        20,
        (varbinds: snmp.Varbind[]) => {
          for (const vb of varbinds ?? []) {
            if (snmp.isVarbindError(vb)) continue;
            out.push({ oid: vb.oid, value: vb.value });
          }
        },
        (error: Error | null) => {
          if (error) reject(error);
          else resolve(out);
        },
      );
    });
  }

  private asNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'bigint') return Number(value);
    if (Buffer.isBuffer(value)) {
      if (value.length === 0) return null;
      if (value.length <= 4) return value.readUIntBE(0, value.length);
      if (value.length === 8) {
        const hi = value.readUInt32BE(0);
        const lo = value.readUInt32BE(4);
        return hi * 2 ** 32 + lo;
      }
    }
    if (typeof value === 'string' && value.trim() !== '') {
      const n = Number(value);
      return Number.isFinite(n) ? n : null;
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
    if (Buffer.isBuffer(value)) {
      const hex = value.toString('hex').toUpperCase();
      if (hex.length >= 8) return hex;
      const ascii = value.toString('utf8').replace(/\0/g, '').trim();
      return ascii || hex || null;
    }
    if (typeof value === 'string') {
      const t = value.trim();
      return t || null;
    }
    return null;
  }
}
