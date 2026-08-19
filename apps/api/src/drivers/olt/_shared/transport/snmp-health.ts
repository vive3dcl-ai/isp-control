/**
 * OLT health over SNMP RO: CPU load, RAM usage and temperature.
 *
 * The background poller only speaks SNMP to OLTs (Telnet/SSH stays free for
 * provisioning), so the dashboard graphs depend on these columns.
 *
 * OID sources:
 *  - ZTE-AN-EQUIP-MIB   zxAnCardTable  (1015 tree, C300/C320/C6xx)
 *  - ZTE-AN-CHASSIS-MIB zxAnCardTable  (1082 tree, newer firmwares)
 *  - HUAWEI-ENTITY-EXTENT-MIB hwEntityStateTable (MA56xx/MA58xx)
 *
 * Firmware coverage varies wildly, so the working column *and* row index are
 * discovered once per host with a walk and then read with cheap GETs. Values
 * that are out of range are discarded instead of stored, because a wrong
 * reading on a dashboard is worse than an empty one.
 */

export type SnmpVarbind = { oid: string; value: unknown };
export type SnmpGetFn = (oid: string) => Promise<SnmpVarbind | null>;
export type SnmpWalkFn = (oid: string) => Promise<SnmpVarbind[]>;

export type OltHealthMetrics = {
  cpuLoad?: number;
  memoryUsedPct?: number;
  totalMemoryBytes?: number;
  temperature?: number;
};

export type OltHealthCandidates = {
  cpu: readonly string[];
  mem: readonly string[];
  memSize: readonly string[];
  temp: readonly string[];
};

/**
 * Resolved leaf OIDs (column + row index) for one host.
 * `null` means "this OLT does not answer that metric" — retried occasionally.
 */
export type OltHealthOidCache = {
  cpu?: string | null;
  mem?: string | null;
  memSize?: string | null;
  temp?: string | null;
  resolvedAt?: number;
};

/** zxAnCardCpuLoad / zxAnCardMemUsage / zxAnCardMemSize + board temperature. */
export const ZTE_HEALTH_OIDS: OltHealthCandidates = {
  cpu: [
    '1.3.6.1.4.1.3902.1015.2.1.1.3.1.9',
    '1.3.6.1.4.1.3902.1082.10.1.2.4.1.9',
  ],
  mem: [
    '1.3.6.1.4.1.3902.1015.2.1.1.3.1.11',
    '1.3.6.1.4.1.3902.1082.10.1.2.4.1.11',
  ],
  memSize: [
    '1.3.6.1.4.1.3902.1015.2.1.1.3.1.19',
    '1.3.6.1.4.1.3902.1082.10.1.2.4.1.19',
  ],
  temp: [
    '1.3.6.1.4.1.3902.1015.2.1.3.13.5.1.1',
    '1.3.6.1.4.1.3902.1015.2.1.3.2',
  ],
};

/** hwEntityCpuUsage / hwEntityMemUsage / hwEntityMemSize / hwEntityTemperature. */
export const HUAWEI_HEALTH_OIDS: OltHealthCandidates = {
  cpu: ['1.3.6.1.4.1.2011.5.25.31.1.1.1.1.5'],
  mem: ['1.3.6.1.4.1.2011.5.25.31.1.1.1.1.7'],
  memSize: ['1.3.6.1.4.1.2011.5.25.31.1.1.1.1.6'],
  temp: ['1.3.6.1.4.1.2011.5.25.31.1.1.1.1.11'],
};

/** Re-walk periodically so a card swap or a firmware upgrade is picked up. */
export const HEALTH_REDISCOVER_MS = 6 * 60 * 60 * 1000;
/** Hosts that answered nothing are retried far less often than every poll. */
export const HEALTH_RETRY_UNSUPPORTED_MS = 60 * 60 * 1000;

export function toSnmpNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string') {
    const n = Number(value.trim());
    return Number.isFinite(n) ? n : null;
  }
  if (Buffer.isBuffer(value)) {
    if (value.length === 0 || value.length > 8) return null;
    let n = 0;
    for (const byte of value) n = n * 256 + byte;
    return n;
  }
  return null;
}

/**
 * Both vendors document 0 as "board without this attribute", so a zero is
 * treated as absent rather than as an idle CPU.
 */
export function isUsablePercent(value: number | null): value is number {
  return value != null && value > 0 && value <= 100;
}

/**
 * Pick the busiest board. Without walking the card-type column we cannot tell
 * which slot is the control card, and the worst board is the useful signal.
 */
export function pickBestPercentRow(rows: SnmpVarbind[]): SnmpVarbind | null {
  let best: SnmpVarbind | null = null;
  let bestValue = -1;
  for (const row of rows) {
    const value = toSnmpNumber(row.value);
    if (!isUsablePercent(value)) continue;
    if (value > bestValue) {
      bestValue = value;
      best = row;
    }
  }
  return best;
}

/**
 * ZTE reports board memory in MB, Huawei in bytes. No board has less than a
 * few MB nor more than a few million MB, so the magnitude disambiguates.
 */
export function memSizeToBytes(raw: number | null): number | null {
  if (raw == null || !Number.isFinite(raw) || raw <= 0) return null;
  const bytes = raw >= 1_000_000 ? raw : raw * 1024 * 1024;
  if (bytes < 8 * 1024 * 1024 || bytes > 1024 * 1024 * 1024 * 1024) return null;
  return Math.round(bytes);
}

export function pickBestMemSizeRow(rows: SnmpVarbind[]): SnmpVarbind | null {
  let best: SnmpVarbind | null = null;
  let bestValue = -1;
  for (const row of rows) {
    const bytes = memSizeToBytes(toSnmpNumber(row.value));
    if (bytes == null) continue;
    if (bytes > bestValue) {
      bestValue = bytes;
      best = row;
    }
  }
  return best;
}

/** Some tables report milli/centi degrees; scale down until it is credible. */
export function normalizeTemperature(raw: number | null): number | null {
  if (raw == null || !Number.isFinite(raw)) return null;
  let value = raw;
  if (value > 1000) value /= 1000;
  else if (value > 200) value /= 10;
  if (value <= 0 || value > 120) return null;
  return Math.round(value * 10) / 10;
}

export function pickBestTemperatureRow(
  rows: SnmpVarbind[],
): SnmpVarbind | null {
  let best: SnmpVarbind | null = null;
  let bestValue = -1;
  for (const row of rows) {
    const temp = normalizeTemperature(toSnmpNumber(row.value));
    if (temp == null) continue;
    if (temp > bestValue) {
      bestValue = temp;
      best = row;
    }
  }
  return best;
}

export function healthCacheIsStale(
  cache: OltHealthOidCache,
  now: number,
): boolean {
  if (cache.resolvedAt == null) return true;
  const anyResolved = Boolean(
    cache.cpu || cache.mem || cache.memSize || cache.temp,
  );
  const ttl = anyResolved ? HEALTH_REDISCOVER_MS : HEALTH_RETRY_UNSUPPORTED_MS;
  return now - cache.resolvedAt >= ttl;
}

async function resolveLeaf(
  walk: SnmpWalkFn,
  bases: readonly string[],
  pick: (rows: SnmpVarbind[]) => SnmpVarbind | null,
): Promise<string | null> {
  for (const base of bases) {
    let rows: SnmpVarbind[];
    try {
      rows = await walk(base);
    } catch {
      continue;
    }
    const best = pick(rows);
    if (best?.oid) return best.oid;
  }
  return null;
}

async function discover(
  candidates: OltHealthCandidates,
  walk: SnmpWalkFn,
  cache: OltHealthOidCache,
  now: number,
): Promise<void> {
  cache.cpu = await resolveLeaf(walk, candidates.cpu, pickBestPercentRow);
  cache.mem = await resolveLeaf(walk, candidates.mem, pickBestPercentRow);
  cache.memSize = await resolveLeaf(
    walk,
    candidates.memSize,
    pickBestMemSizeRow,
  );
  cache.temp = await resolveLeaf(walk, candidates.temp, pickBestTemperatureRow);
  cache.resolvedAt = now;
}

async function readLeaf(
  get: SnmpGetFn,
  oid: string | null | undefined,
): Promise<number | null> {
  if (!oid) return null;
  try {
    const vb = await get(oid);
    return toSnmpNumber(vb?.value);
  } catch {
    return null;
  }
}

/**
 * Read CPU / RAM / temperature, discovering the right OIDs on first use.
 * Mutates `cache` so the caller can keep it per host across polls.
 */
export async function readOltHealthSnmp(params: {
  candidates: OltHealthCandidates;
  get: SnmpGetFn;
  walk: SnmpWalkFn;
  cache: OltHealthOidCache;
  now?: number;
}): Promise<OltHealthMetrics> {
  const { candidates, get, walk, cache } = params;
  const now = params.now ?? Date.now();

  if (healthCacheIsStale(cache, now)) {
    await discover(candidates, walk, cache, now);
  }

  const metrics: OltHealthMetrics = {};
  let lostLeaf = false;

  const cpu = await readLeaf(get, cache.cpu);
  if (isUsablePercent(cpu)) metrics.cpuLoad = Math.round(cpu);
  else if (cache.cpu) lostLeaf = true;

  const mem = await readLeaf(get, cache.mem);
  if (isUsablePercent(mem)) metrics.memoryUsedPct = Math.round(mem * 10) / 10;
  else if (cache.mem) lostLeaf = true;

  const memSize = memSizeToBytes(await readLeaf(get, cache.memSize));
  if (memSize != null) metrics.totalMemoryBytes = memSize;

  const temp = normalizeTemperature(await readLeaf(get, cache.temp));
  if (temp != null) metrics.temperature = temp;
  else if (cache.temp) lostLeaf = true;

  // A resolved leaf that stopped answering usually means the card moved.
  if (lostLeaf) cache.resolvedAt = undefined;

  return metrics;
}
