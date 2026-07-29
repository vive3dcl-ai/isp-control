/**
 * ZTE C3xx SNMP v2c OID helpers (read-only).
 *
 * V2.1 ifIndex encoding matches snmp-olt-zte / live C300↔C320:
 *   onuIdSuffix = 0x11010000 + slot*0x100 + pon
 * Full OID: 1.3.6.1.4.1.3902.1082.<table>.<onuIdSuffix>.<onuId>
 */

export const ZTE_ENTERPRISE = '1.3.6.1.4.1.3902';

/** V2.1 ONU-ID space (name / serial / status / rx / distance). */
export const ZTE_V21_BASE = `${ZTE_ENTERPRISE}.1082`;

export const ZTE_V21 = {
  name: `${ZTE_V21_BASE}.500.10.2.3.3.1.2`,
  description: `${ZTE_V21_BASE}.500.10.2.3.3.1.3`,
  serial: `${ZTE_V21_BASE}.500.10.2.3.3.1.18`,
  status: `${ZTE_V21_BASE}.500.10.2.3.8.1.4`,
  rxPower: `${ZTE_V21_BASE}.500.20.2.2.2.1.10`,
  distance: `${ZTE_V21_BASE}.500.10.2.3.10.1.2`,
} as const;

/** Legacy / alternate tree (FW 1.2 / 2.0 style). */
export const ZTE_LEGACY = {
  status: `${ZTE_ENTERPRISE}.1012.3.28.2.1.3`,
  serial: `${ZTE_ENTERPRISE}.1012.3.28.1.1.5`,
  rxPower: `${ZTE_ENTERPRISE}.1012.3.50.12.1.1.10`,
} as const;

/**
 * XPON ONU interface octet counters (C300/C320).
 * Index = encodeXponOnuIfIndex(slot, pon, onuId).
 * Rx = octets OLT receives from ONU (customer upload).
 * Tx = octets OLT sends to ONU (customer download).
 * Verified live: 216/216 ONUs; IF-MIB ifName has no gpon-onu_* rows.
 */
export const ZTE_XPON_ONU_IF = {
  rxOctets: `${ZTE_ENTERPRISE}.1015.1010.5.5.1.2`,
  txOctets: `${ZTE_ENTERPRISE}.1015.1010.5.5.1.17`,
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
} as const;

/** ONU-ID space base (shelf assumed 1). */
export const ONU_ID_IFINDEX_BASE = 0x11010000; // 285278208

export function encodeOnuIdIfIndex(slot: number, pon: number): number {
  return ONU_ID_IFINDEX_BASE + slot * 0x100 + pon;
}

/**
 * zxAnXponOnuIfIndex for 3902.1015.1010.5.5 traffic tables.
 * layout: 0x90 | slot<<20 | (pon-1)<<16 | onuId<<8
 */
export function encodeXponOnuIfIndex(
  slot: number,
  pon: number,
  onuId: number,
): number {
  return (0x90000000 + (slot << 20) + ((pon - 1) << 16) + (onuId << 8)) >>> 0;
}

export function decodeXponOnuIfIndex(
  idx: number,
): { slot: number; pon: number; onuId: number } | null {
  const n = idx >>> 0;
  if (n >>> 24 !== 0x90) return null;
  if ((n & 0xff) !== 0) return null;
  const slot = (n >>> 20) & 0x0f;
  const pon = ((n >>> 16) & 0x0f) + 1;
  const onuId = (n >>> 8) & 0xff;
  if (slot < 1 || pon < 1 || onuId < 1) return null;
  return { slot, pon, onuId };
}

export function decodeOnuIdIfIndex(
  suffix: number,
): { shelf: number; slot: number; pon: number } | null {
  const diff = suffix - ONU_ID_IFINDEX_BASE;
  if (diff < 0 || diff > 30 * 0x100 + 16) return null;
  const slot = Math.floor(diff / 0x100);
  const pon = diff % 0x100;
  if (slot < 1 || slot > 30 || pon < 1 || pon > 16) return null;
  return { shelf: 1, slot, pon };
}

/** Parse trailing `.ponIfIndex.onuId` (or `.ponIfIndex.onuId.channel`) from a walked OID. */
export function parseWalkIndexes(
  oid: string,
  tablePrefix: string,
): { ponIfIndex: number; onuId: number } | null {
  const prefix = tablePrefix.replace(/^\./, '');
  const clean = oid.replace(/^\./, '');
  if (!clean.startsWith(prefix + '.')) return null;
  const rest = clean.slice(prefix.length + 1);
  const parts = rest.split('.').map((p) => Number(p));
  if (parts.length < 2 || parts.some((n) => !Number.isFinite(n))) return null;

  // Prefer …ponIfIndex.onuId when ponIfIndex decodes as V2.1 ONU-ID space.
  const ponA = parts[parts.length - 2];
  const onuA = parts[parts.length - 1];
  if (onuA >= 1 && decodeOnuIdIfIndex(ponA)) {
    return { ponIfIndex: ponA, onuId: onuA };
  }

  // Optical tables sometimes append a channel index: …ponIfIndex.onuId.1
  if (parts.length >= 3) {
    const ponB = parts[parts.length - 3];
    const onuB = parts[parts.length - 2];
    if (onuB >= 1 && decodeOnuIdIfIndex(ponB)) {
      return { ponIfIndex: ponB, onuId: onuB };
    }
  }

  // Legacy / unknown encoding: last two components.
  if (onuA >= 1) return { ponIfIndex: ponA, onuId: onuA };
  return null;
}

/** Last numeric component of an OID (e.g. ifIndex). */
export function lastOidIndex(oid: string): number | null {
  const parts = oid.replace(/^\./, '').split('.');
  const n = Number(parts[parts.length - 1]);
  return Number.isFinite(n) ? n : null;
}

/**
 * Convert ZTE SNMP optical raw value to dBm.
 * Common formula: raw * 0.002 - 30. Some firmwares use signed wrap > 30000.
 */
export function rawOpticalToDbm(raw: number): number | null {
  if (!Number.isFinite(raw)) return null;
  let v = raw;
  if (v > 30000) v = v - 65536;
  const dbm = v * 0.002 - 30;
  if (!Number.isFinite(dbm) || dbm < -50 || dbm > 10) return null;
  return Math.round(dbm * 100) / 100;
}

/** V2.1 status integer → phase / online. */
export function mapV21Status(code: number): {
  phaseState: string;
  online: boolean;
  status: 'online' | 'offline';
} {
  switch (code) {
    case 1:
      return { phaseState: 'Logging', online: false, status: 'offline' };
    case 2:
      return { phaseState: 'LOS', online: false, status: 'offline' };
    case 3:
      return {
        phaseState: 'Synchronization',
        online: false,
        status: 'offline',
      };
    case 4:
      return { phaseState: 'working', online: true, status: 'online' };
    case 5:
      return { phaseState: 'DyingGasp', online: false, status: 'offline' };
    case 6:
      return { phaseState: 'AuthFailed', online: false, status: 'offline' };
    case 7:
      return { phaseState: 'Offline', online: false, status: 'offline' };
    default:
      return {
        phaseState: `code_${code}`,
        online: false,
        status: 'offline',
      };
  }
}

export function buildOnuIf(
  family: 'gpon' | 'epon',
  shelf: number,
  slot: number,
  pon: number,
  onuId: number,
): string {
  return `${family}-onu_${shelf}/${slot}/${pon}:${onuId}`;
}

/** Parse `gpon-onu_1/2/14:5` → parts. */
export function parseOnuIf(onuIf: string): {
  family: 'gpon' | 'epon';
  shelf: number;
  slot: number;
  pon: number;
  onuId: number;
} | null {
  const m = onuIf.trim().match(/^(gpon|epon)-onu_(\d+)\/(\d+)\/(\d+):(\d+)$/i);
  if (!m) return null;
  return {
    family: m[1].toLowerCase() === 'epon' ? 'epon' : 'gpon',
    shelf: Number(m[2]),
    slot: Number(m[3]),
    pon: Number(m[4]),
    onuId: Number(m[5]),
  };
}
