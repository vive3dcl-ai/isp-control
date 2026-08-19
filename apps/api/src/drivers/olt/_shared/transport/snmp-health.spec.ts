import {
  HEALTH_REDISCOVER_MS,
  HEALTH_RETRY_UNSUPPORTED_MS,
  ZTE_HEALTH_OIDS,
  healthCacheIsStale,
  isUsablePercent,
  memSizeToBytes,
  normalizeTemperature,
  pickBestMemSizeRow,
  pickBestPercentRow,
  pickBestTemperatureRow,
  readOltHealthSnmp,
  toSnmpNumber,
  type OltHealthOidCache,
  type SnmpVarbind,
} from './snmp-health';

const CPU_BASE = ZTE_HEALTH_OIDS.cpu[0];
const MEM_BASE = ZTE_HEALTH_OIDS.mem[0];
const SIZE_BASE = ZTE_HEALTH_OIDS.memSize[0];
const TEMP_BASE = ZTE_HEALTH_OIDS.temp[0];

describe('olt-snmp-health.util', () => {
  describe('toSnmpNumber', () => {
    it('reads numbers, strings and big-endian buffers', () => {
      expect(toSnmpNumber(42)).toBe(42);
      expect(toSnmpNumber('17')).toBe(17);
      expect(toSnmpNumber(Buffer.from([0x01, 0x00]))).toBe(256);
      expect(toSnmpNumber(Number.NaN)).toBeNull();
      expect(toSnmpNumber(null)).toBeNull();
      expect(toSnmpNumber(Buffer.alloc(0))).toBeNull();
    });
  });

  describe('isUsablePercent', () => {
    it('treats the vendor 0 sentinel as absent', () => {
      expect(isUsablePercent(0)).toBe(false);
      expect(isUsablePercent(1)).toBe(true);
      expect(isUsablePercent(100)).toBe(true);
      expect(isUsablePercent(101)).toBe(false);
      expect(isUsablePercent(null)).toBe(false);
    });
  });

  describe('pickBestPercentRow', () => {
    it('picks the busiest board and skips unsupported ones', () => {
      const rows: SnmpVarbind[] = [
        { oid: `${CPU_BASE}.1`, value: 0 },
        { oid: `${CPU_BASE}.2`, value: 12 },
        { oid: `${CPU_BASE}.3`, value: 47 },
        { oid: `${CPU_BASE}.4`, value: 250 },
      ];
      expect(pickBestPercentRow(rows)?.oid).toBe(`${CPU_BASE}.3`);
    });

    it('returns null when every board reports the sentinel', () => {
      expect(
        pickBestPercentRow([
          { oid: `${CPU_BASE}.1`, value: 0 },
          { oid: `${CPU_BASE}.2`, value: 0 },
        ]),
      ).toBeNull();
    });
  });

  describe('memSizeToBytes', () => {
    it('accepts ZTE megabytes and Huawei bytes', () => {
      expect(memSizeToBytes(512)).toBe(512 * 1024 * 1024);
      expect(memSizeToBytes(2 * 1024 * 1024 * 1024)).toBe(2147483648);
    });

    it('rejects implausible sizes', () => {
      expect(memSizeToBytes(0)).toBeNull();
      expect(memSizeToBytes(-5)).toBeNull();
      expect(memSizeToBytes(2)).toBeNull();
      expect(memSizeToBytes(9e15)).toBeNull();
    });

    it('picks the largest plausible board', () => {
      const rows: SnmpVarbind[] = [
        { oid: `${SIZE_BASE}.1`, value: 0 },
        { oid: `${SIZE_BASE}.2`, value: 256 },
        { oid: `${SIZE_BASE}.3`, value: 1024 },
      ];
      expect(pickBestMemSizeRow(rows)?.oid).toBe(`${SIZE_BASE}.3`);
    });
  });

  describe('normalizeTemperature', () => {
    it('scales milli and centi degrees down', () => {
      expect(normalizeTemperature(42)).toBe(42);
      expect(normalizeTemperature(415)).toBe(41.5);
      expect(normalizeTemperature(41500)).toBe(41.5);
    });

    it('discards readings outside a credible range', () => {
      expect(normalizeTemperature(0)).toBeNull();
      expect(normalizeTemperature(-10)).toBeNull();
      expect(normalizeTemperature(150)).toBeNull();
      expect(normalizeTemperature(null)).toBeNull();
    });

    it('picks the hottest sensor', () => {
      const rows: SnmpVarbind[] = [
        { oid: `${TEMP_BASE}.1`, value: 38 },
        { oid: `${TEMP_BASE}.2`, value: 51 },
        { oid: `${TEMP_BASE}.3`, value: 0 },
      ];
      expect(pickBestTemperatureRow(rows)?.oid).toBe(`${TEMP_BASE}.2`);
    });
  });

  describe('healthCacheIsStale', () => {
    it('retries unsupported hosts far less often than resolved ones', () => {
      const resolved: OltHealthOidCache = {
        cpu: `${CPU_BASE}.1`,
        resolvedAt: 0,
      };
      const unsupported: OltHealthOidCache = {
        cpu: null,
        mem: null,
        memSize: null,
        temp: null,
        resolvedAt: 0,
      };

      expect(healthCacheIsStale({}, 1_000)).toBe(true);
      expect(healthCacheIsStale(resolved, HEALTH_RETRY_UNSUPPORTED_MS)).toBe(
        false,
      );
      expect(healthCacheIsStale(resolved, HEALTH_REDISCOVER_MS)).toBe(true);
      expect(healthCacheIsStale(unsupported, HEALTH_RETRY_UNSUPPORTED_MS)).toBe(
        true,
      );
    });
  });

  describe('readOltHealthSnmp', () => {
    function makeAgent(table: Record<string, number>) {
      const walks: string[] = [];
      const gets: string[] = [];
      return {
        walks,
        gets,
        walk: (base: string) => {
          walks.push(base);
          return Promise.resolve(
            Object.entries(table)
              .filter(([oid]) => oid.startsWith(`${base}.`))
              .map(([oid, value]) => ({ oid, value })),
          );
        },
        get: (oid: string) => {
          gets.push(oid);
          return Promise.resolve(
            oid in table ? { oid, value: table[oid] } : null,
          );
        },
      };
    }

    const zteTable = {
      [`${CPU_BASE}.1`]: 0,
      [`${CPU_BASE}.2`]: 23,
      [`${MEM_BASE}.1`]: 0,
      [`${MEM_BASE}.2`]: 61,
      [`${SIZE_BASE}.2`]: 1024,
      [`${TEMP_BASE}.2`]: 47,
    };

    it('discovers the leaf OIDs and returns the metrics', async () => {
      const agent = makeAgent(zteTable);
      const cache: OltHealthOidCache = {};

      const health = await readOltHealthSnmp({
        candidates: ZTE_HEALTH_OIDS,
        get: agent.get,
        walk: agent.walk,
        cache,
        now: 1_000,
      });

      expect(health).toEqual({
        cpuLoad: 23,
        memoryUsedPct: 61,
        totalMemoryBytes: 1024 * 1024 * 1024,
        temperature: 47,
      });
      expect(cache.cpu).toBe(`${CPU_BASE}.2`);
      expect(cache.resolvedAt).toBe(1_000);
    });

    it('reuses the cache on the next poll instead of walking again', async () => {
      const cache: OltHealthOidCache = {};
      const first = makeAgent(zteTable);
      await readOltHealthSnmp({
        candidates: ZTE_HEALTH_OIDS,
        get: first.get,
        walk: first.walk,
        cache,
        now: 1_000,
      });

      const second = makeAgent(zteTable);
      const health = await readOltHealthSnmp({
        candidates: ZTE_HEALTH_OIDS,
        get: second.get,
        walk: second.walk,
        cache,
        now: 2_000,
      });

      expect(second.walks).toEqual([]);
      expect(second.gets).toContain(`${CPU_BASE}.2`);
      expect(health.cpuLoad).toBe(23);
    });

    it('falls back to the next candidate tree', async () => {
      const agent = makeAgent({
        [`${ZTE_HEALTH_OIDS.cpu[1]}.5`]: 8,
      });
      const cache: OltHealthOidCache = {};

      const health = await readOltHealthSnmp({
        candidates: ZTE_HEALTH_OIDS,
        get: agent.get,
        walk: agent.walk,
        cache,
        now: 1_000,
      });

      expect(cache.cpu).toBe(`${ZTE_HEALTH_OIDS.cpu[1]}.5`);
      expect(health).toEqual({ cpuLoad: 8 });
    });

    it('reports nothing when the OLT answers no health OID', async () => {
      const agent = makeAgent({});
      const cache: OltHealthOidCache = {};

      const health = await readOltHealthSnmp({
        candidates: ZTE_HEALTH_OIDS,
        get: agent.get,
        walk: agent.walk,
        cache,
        now: 1_000,
      });

      expect(health).toEqual({});
      expect(cache.cpu).toBeNull();
      expect(agent.gets).toEqual([]);
    });

    it('survives a walk that throws', async () => {
      const cache: OltHealthOidCache = {};
      const health = await readOltHealthSnmp({
        candidates: ZTE_HEALTH_OIDS,
        get: () => Promise.resolve(null),
        walk: () => Promise.reject(new Error('timeout')),
        cache,
        now: 1_000,
      });
      expect(health).toEqual({});
    });

    it('forces a re-discovery when a resolved leaf stops answering', async () => {
      const cache: OltHealthOidCache = {};
      const agent = makeAgent(zteTable);
      await readOltHealthSnmp({
        candidates: ZTE_HEALTH_OIDS,
        get: agent.get,
        walk: agent.walk,
        cache,
        now: 1_000,
      });
      expect(cache.resolvedAt).toBe(1_000);

      const moved = makeAgent({});
      await readOltHealthSnmp({
        candidates: ZTE_HEALTH_OIDS,
        get: moved.get,
        walk: moved.walk,
        cache,
        now: 2_000,
      });

      expect(cache.resolvedAt).toBeUndefined();
      expect(healthCacheIsStale(cache, 2_000)).toBe(true);
    });
  });
});
