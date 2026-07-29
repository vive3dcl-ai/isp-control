/**
 * Huawei SmartAX OLT SNMP v2c OID helpers (read-only).
 * Enterprise: 1.3.6.1.4.1.2011 (HUAWEI-GPON / XPON MIB family).
 *
 * ONT tables are indexed by PON ifIndex + ontId.
 * Common ifIndex layout: 4194304000 + slot*8192 + port*256
 * Canonical onuIf: gpon-onu_0/{slot}/{port}:{ontId}
 */

export const HUAWEI_ENTERPRISE = '1.3.6.1.4.1.2011';

/** GPON device / ONT trees under SmartAX. */
export const HW_GPON = `${HUAWEI_ENTERPRISE}.6.128.1.1`;

export const HW_ONT = {
  /** hwGponDeviceOntSn / auth value */
  serial: `${HW_GPON}.2.43.1.3`,
  /** Line profile name */
  lineProfile: `${HW_GPON}.2.43.1.7`,
  /** Service profile name */
  srvProfile: `${HW_GPON}.2.43.1.8`,
  /** Description */
  description: `${HW_GPON}.2.43.1.9`,
  /** Run status: up(1) down(2) */
  runStatus: `${HW_GPON}.2.46.1.15`,
  /** Ranging distance (meters) */
  distance: `${HW_GPON}.2.46.1.20`,
  /** Last down cause code */
  lastDownCause: `${HW_GPON}.2.46.1.24`,
  /** Optical DDM temperature */
  opticTemp: `${HW_GPON}.2.51.1.1`,
  /** ONT RX optical power */
  rxPower: `${HW_GPON}.2.51.1.4`,
  /** ONT TX optical power (some firmwares) */
  txPower: `${HW_GPON}.2.51.1.5`,
  /** OLT RX of this ONT */
  oltRxPower: `${HW_GPON}.2.51.1.6`,
  /** Autofind serial */
  autofindSn: `${HW_GPON}.2.52.1.2`,
  /** Traffic: outbound octets (download) */
  outOctets: `${HW_GPON}.4.23.1.3`,
  /** Traffic: inbound octets (upload) */
  inOctets: `${HW_GPON}.4.23.1.4`,
  /** GPON port control / link status */
  ponControlStatus: `${HW_GPON}.2.21.1.10`,
} as const;

export const IF_MIB = {
  ifName: '1.3.6.1.2.1.31.1.1.1.1',
  ifHCInOctets: '1.3.6.1.2.1.31.1.1.1.6',
  ifHCOutOctets: '1.3.6.1.2.1.31.1.1.1.10',
  ifHighSpeed: '1.3.6.1.2.1.31.1.1.1.15',
  ifInOctets: '1.3.6.1.2.1.2.2.1.10',
  ifOutOctets: '1.3.6.1.2.1.2.2.1.16',
  ifAdminStatus: '1.3.6.1.2.1.2.2.1.7',
  ifOperStatus: '1.3.6.1.2.1.2.2.1.8',
  sysUpTime: '1.3.6.1.2.1.1.3.0',
  sysDescr: '1.3.6.1.2.1.1.1.0',
} as const;

/** Base used by many MA5600T / MA5800 GPON ifIndex encodings. */
export const HW_PON_IFINDEX_BASE = 4194304000;

export function encodeHuaweiPonIfIndex(slot: number, port: number): number {
  return HW_PON_IFINDEX_BASE + slot * 8192 + port * 256;
}

export function decodeHuaweiPonIfIndex(
  ifIndex: number,
): { frame: number; slot: number; port: number } | null {
  const n = ifIndex >>> 0;
  if (n < HW_PON_IFINDEX_BASE) {
    // Alternate decode used by some scripts
    const slot = (n & (15 << 13)) >> 13;
    const port = (n & (15 << 8)) >> 8;
    if (slot >= 0 && port >= 0) return { frame: 0, slot, port };
    return null;
  }
  const rem = n - HW_PON_IFINDEX_BASE;
  const slot = Math.floor(rem / 8192);
  const port = Math.floor((rem % 8192) / 256);
  if (slot < 0 || slot > 31 || port < 0 || port > 31) return null;
  return { frame: 0, slot, port };
}

export function buildHuaweiOnuIf(
  family: 'gpon',
  frame: number,
  slot: number,
  port: number,
  ontId: number,
): string {
  return `${family}-onu_${frame}/${slot}/${port}:${ontId}`;
}

/** Parse `gpon-onu_0/1/0:5` (Huawei) or compatible ZTE-shaped strings. */
export function parseHuaweiOnuIf(onuIf: string): {
  family: 'gpon';
  frame: number;
  slot: number;
  port: number;
  ontId: number;
} | null {
  const m = onuIf.trim().match(/^gpon-onu_(\d+)\/(\d+)\/(\d+):(\d+)$/i);
  if (!m) return null;
  return {
    family: 'gpon',
    frame: Number(m[1]),
    slot: Number(m[2]),
    port: Number(m[3]),
    ontId: Number(m[4]),
  };
}

/**
 * Huawei optical values are often 0.01 dBm (e.g. -2150 → -21.50).
 * Some firmwares return already-scaled tenths; clamp invalid sentinels.
 */
export function hwOpticalToDbm(raw: number): number | null {
  if (!Number.isFinite(raw)) return null;
  if (
    raw === 2147483647 ||
    raw === -2147483648 ||
    raw === 0x7fffffff ||
    raw === -1 ||
    raw === -10001 ||
    raw === 65535
  ) {
    return null;
  }
  let dbm = raw;
  if (Math.abs(raw) > 100) {
    dbm = raw / 100;
  } else if (Math.abs(raw) > 40 && Math.abs(raw) <= 100) {
    dbm = raw / 10;
  }
  if (!Number.isFinite(dbm) || dbm < -50 || dbm > 10) return null;
  return Math.round(dbm * 100) / 100;
}

export function mapHwRunStatus(code: number): {
  phaseState: string;
  online: boolean;
  status: 'online' | 'offline';
} {
  if (code === 1) {
    return { phaseState: 'up', online: true, status: 'online' };
  }
  if (code === 2) {
    return { phaseState: 'down', online: false, status: 'offline' };
  }
  return {
    phaseState: `code=${code}`,
    online: false,
    status: 'offline',
  };
}

/** Parse trailing `.ponIfIndex.ontId` from a walked OID. */
export function parseHwWalkIndexes(
  oid: string,
  baseOid: string,
): { ponIfIndex: number; ontId: number } | null {
  const clean = oid.replace(/^\./, '');
  const base = baseOid.replace(/^\./, '');
  if (!clean.startsWith(base + '.') && clean !== base) return null;
  const suffix = clean.slice(base.length).replace(/^\./, '');
  if (!suffix) return null;
  const parts = suffix.split('.').map(Number);
  if (parts.length < 2) return null;
  const ontId = parts[parts.length - 1];
  const ponIfIndex = parts[parts.length - 2];
  if (!Number.isFinite(ontId) || !Number.isFinite(ponIfIndex)) return null;
  return { ponIfIndex, ontId };
}

export function lastOidIndex(oid: string): number | null {
  const parts = oid.replace(/^\./, '').split('.');
  const n = Number(parts[parts.length - 1]);
  return Number.isFinite(n) ? n : null;
}
