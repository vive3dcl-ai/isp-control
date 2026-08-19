/**
 * SwOS / SwOS Lite wire-format helpers (HTTP digest `.b` endpoints).
 * Field names differ by platform; prefer descriptive keys then iXX fallbacks.
 */

export function parseSwosJsObject(text: string): unknown {
  let t = text.trim();
  if (!t) return null;
  // Convert 0xN hex literals to decimal JSON numbers
  t = t.replace(/0x([0-9a-fA-F]+)/g, (_, h) => String(parseInt(h, 16)));
  t = t.replace(/'/g, '"');
  // Quote bare keys
  t = t.replace(/([a-zA-Z_][a-zA-Z0-9_]*):/g, '"$1":');
  return JSON.parse(t);
}

export function decodeSwosHexString(hex: unknown): string {
  if (typeof hex !== 'string' || !hex) return '';
  if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length % 2 !== 0) return hex;
  try {
    const bytes = Buffer.from(hex, 'hex');
    return bytes.toString('ascii').replace(/\0+$/g, '');
  } catch {
    return hex;
  }
}

export function decodeSwosIpv4Le(ipInt: unknown): string | null {
  const n = typeof ipInt === 'number' ? ipInt : Number(ipInt);
  if (!Number.isFinite(n) || n <= 0) return null;
  return `${n & 0xff}.${(n >> 8) & 0xff}.${(n >> 16) & 0xff}.${(n >> 24) & 0xff}`;
}

/** Bit 0 = port 1. Returns 1-based port numbers. */
export function decodeSwosPortMask(mask: unknown, numPorts: number): number[] {
  const m = typeof mask === 'number' ? mask : Number(mask);
  if (!Number.isFinite(m) || numPorts < 1) return [];
  const ports: number[] = [];
  for (let i = 0; i < numPorts; i++) {
    if (m & (1 << i)) ports.push(i + 1);
  }
  return ports;
}

export function encodeSwosPortMask(ports: number[]): number {
  let mask = 0;
  for (const p of ports) {
    if (p >= 1) mask |= 1 << (p - 1);
  }
  return mask;
}

function pick(obj: Record<string, unknown>, ...keys: string[]): unknown {
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null) return obj[k];
  }
  return undefined;
}

export type SwosSystemInfo = {
  identity: string | null;
  version: string | null;
  model: string | null;
  serial: string | null;
  macAddress: string | null;
  ip: string | null;
};

export function parseSwosSystem(raw: unknown): SwosSystemInfo {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<
    string,
    unknown
  >;
  const identity = decodeSwosHexString(
    pick(obj, 'id', 'i01', 'identity') as string,
  );
  const version = decodeSwosHexString(
    pick(obj, 'ver', 'i02', 'version') as string,
  );
  const model = decodeSwosHexString(
    pick(obj, 'brd', 'board', 'i03', 'model') as string,
  );
  const serial = decodeSwosHexString(
    pick(obj, 'sn', 'serial', 'i04') as string,
  );
  const macRaw = pick(obj, 'mac', 'i05');
  let macAddress: string | null = null;
  if (typeof macRaw === 'string' && macRaw.length >= 12) {
    const h = macRaw.replace(/[^0-9a-fA-F]/g, '').toLowerCase();
    if (h.length >= 12) {
      macAddress = h
        .slice(0, 12)
        .match(/.{2}/g)!
        .join(':');
    }
  }
  const ip = decodeSwosIpv4Le(pick(obj, 'ip', 'cip', 'i06', 'i07'));
  return {
    identity: identity || null,
    version: version || null,
    model: model || null,
    serial: serial || null,
    macAddress,
    ip,
  };
}

export type SwosPortRow = {
  portNumber: number;
  name: string;
  enabled: boolean;
  linkUp: boolean;
};

export function parseSwosLinks(raw: unknown): SwosPortRow[] {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<
    string,
    unknown
  >;
  const namesRaw = pick(obj, 'nm', 'names', 'i0a', 'i0A');
  const names = Array.isArray(namesRaw)
    ? namesRaw.map((n) => decodeSwosHexString(n) || '')
    : [];
  const numPorts = Math.max(names.length, 1);
  const enabledMask = Number(pick(obj, 'en', 'enabled', 'i01') ?? 0) || 0;
  const linkMask =
    Number(pick(obj, 'lnk', 'link', 'an', 'i03', 'i04') ?? 0) || 0;
  // If no name array, invent Port N up to 28 (common CRS)
  const count = names.length > 0 ? names.length : 0;
  if (!count) return [];
  const rows: SwosPortRow[] = [];
  for (let i = 0; i < count; i++) {
    const bit = 1 << i;
    rows.push({
      portNumber: i + 1,
      name: names[i]?.trim() || `Port ${i + 1}`,
      enabled: !!(enabledMask & bit),
      linkUp: !!(linkMask & bit),
    });
  }
  return rows;
}

export type SwosVlanRow = {
  vlanId: number;
  name: string | null;
  memberPorts: number[];
};

export function parseSwosVlanTable(
  raw: unknown,
  numPorts: number,
): SwosVlanRow[] {
  if (!Array.isArray(raw)) return [];
  const rows: SwosVlanRow[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    const vlanId = Number(pick(obj, 'vid', 'vlan', 'i01', 'id') ?? 0);
    if (!Number.isFinite(vlanId) || vlanId < 1) continue;
    const mask = pick(obj, 'mbr', 'members', 'i02', 'prt');
    const memberPorts = decodeSwosPortMask(mask, numPorts);
    const nameRaw = pick(obj, 'nm', 'name', 'i03');
    const name =
      typeof nameRaw === 'string' ? decodeSwosHexString(nameRaw) || null : null;
    rows.push({ vlanId, name, memberPorts });
  }
  return rows;
}

/** Build per-port vlan list from VLAN membership table (all tagged; PVID unknown). */
export function swosVlansByPort(
  vlans: SwosVlanRow[],
  portNumber: number,
): Array<{ vlanId: number; mode: 'tagged' | 'untagged' }> {
  const out: Array<{ vlanId: number; mode: 'tagged' | 'untagged' }> = [];
  for (const v of vlans) {
    if (v.memberPorts.includes(portNumber)) {
      out.push({ vlanId: v.vlanId, mode: 'tagged' });
    }
  }
  return out.sort((a, b) => a.vlanId - b.vlanId);
}
