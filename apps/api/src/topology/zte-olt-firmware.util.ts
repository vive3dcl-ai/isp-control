/**
 * ZTE CLI dialect: C3xx (legacy) vs C6xx Titan.
 *
 * Canonical DB/UI form (always):
 *   gpon-olt_1/2/1   gpon-onu_1/2/1:5
 *
 * C6xx Titan CLI form:
 *   gpon_olt-1/2/1   gpon_onu-1/2/1:5
 */

export const ZTE_FW_FAMILIES = ['c3xx', 'c6xx', 'unknown'] as const;
export type ZteFwFamily = (typeof ZTE_FW_FAMILIES)[number];

export const ZTE_FW_FAMILY_LABELS: Record<ZteFwFamily, string> = {
  c3xx: 'C3xx',
  c6xx: 'C6xx Titan',
  unknown: 'ZTE (auto)',
};

export function detectZteFwFamily(input: {
  subtype?: string | null;
  product?: string | null;
  softVer?: string | null;
  versionText?: string | null;
  cardTypes?: Array<string | null | undefined>;
}): ZteFwFamily {
  const subtype = (input.subtype || '').toLowerCase();
  if (
    subtype.startsWith('zte_c6') ||
    subtype === 'zte_c600' ||
    subtype === 'zte_c610' ||
    subtype === 'zte_c620' ||
    subtype === 'zte_c650' ||
    subtype === 'zte_c680'
  ) {
    return 'c6xx';
  }
  if (
    subtype.startsWith('zte_c2') ||
    subtype.startsWith('zte_c3') ||
    subtype === 'zte_c3xx'
  ) {
    return 'c3xx';
  }

  const blob = [input.product, input.softVer, input.versionText]
    .filter(Boolean)
    .join(' ')
    .toUpperCase();

  if (/\bC6(?:00|10|20|50|80)\b/.test(blob) || /\bTITAN\b/.test(blob)) {
    return 'c6xx';
  }
  if (/\bC3(?:00|20|50)\b/.test(blob) || /\bC220\b/.test(blob)) {
    return 'c3xx';
  }

  for (const raw of input.cardTypes || []) {
    const u = (raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!u) continue;
    if (
      u.startsWith('GF') ||
      u.startsWith('SFU') ||
      u === 'FCSDA' ||
      u.startsWith('SPUF') ||
      u === 'PRSF'
    ) {
      return 'c6xx';
    }
    if (
      u.startsWith('GT') ||
      u.startsWith('SMX') ||
      u.startsWith('SCX') ||
      u.startsWith('SCTM')
    ) {
      return 'c3xx';
    }
  }

  return 'unknown';
}

/** Parse shelf/slot/port from either C3xx or C6xx PON OLT ifName. */
export function parseZteOltIfParts(ifName: string): {
  family: 'gpon' | 'epon';
  shelf: string;
  slot: string;
  port: string;
} | null {
  const m =
    ifName.match(/^(gpon|epon)-olt_(\d+)\/(\d+)\/(\d+)$/i) ||
    ifName.match(/^(gpon|epon)_olt-(\d+)\/(\d+)\/(\d+)$/i) ||
    ifName.match(/^(gpon|epon)_(\d+)\/(\d+)\/(\d+)$/i);
  if (!m) return null;
  return {
    family: m[1].toLowerCase() === 'epon' ? 'epon' : 'gpon',
    shelf: m[2],
    slot: m[3],
    port: m[4],
  };
}

/** Parse ONU ifName (canonical or Titan). */
export function parseZteOnuIfParts(ifName: string): {
  family: 'gpon' | 'epon';
  shelf: string;
  slot: string;
  port: string;
  onuId: string;
} | null {
  const m =
    ifName.match(/^(gpon|epon)-onu_(\d+)\/(\d+)\/(\d+):(\d+)$/i) ||
    ifName.match(/^(gpon|epon)_onu-(\d+)\/(\d+)\/(\d+):(\d+)$/i);
  if (!m) return null;
  return {
    family: m[1].toLowerCase() === 'epon' ? 'epon' : 'gpon',
    shelf: m[2],
    slot: m[3],
    port: m[4],
    onuId: m[5],
  };
}

/** Always store/compare as gpon-olt_S/S/P */
export function toZteCanonicalOltIf(ifName: string): string {
  const p = parseZteOltIfParts(ifName);
  if (!p) return ifName;
  return `${p.family}-olt_${p.shelf}/${p.slot}/${p.port}`;
}

/** Always store/compare as gpon-onu_S/S/P:id */
export function toZteCanonicalOnuIf(ifName: string): string {
  const p = parseZteOnuIfParts(ifName);
  if (!p) return ifName;
  return `${p.family}-onu_${p.shelf}/${p.slot}/${p.port}:${p.onuId}`;
}

/** Emit CLI ifName for the OLT dialect. */
export function toZteCliOltIf(
  canonicalOrAny: string,
  family: ZteFwFamily,
): string {
  const p = parseZteOltIfParts(canonicalOrAny);
  if (!p) return canonicalOrAny;
  if (family === 'c6xx') {
    return `${p.family}_olt-${p.shelf}/${p.slot}/${p.port}`;
  }
  return `${p.family}-olt_${p.shelf}/${p.slot}/${p.port}`;
}

export function toZteCliOnuIf(
  canonicalOrAny: string,
  family: ZteFwFamily,
): string {
  const p = parseZteOnuIfParts(canonicalOrAny);
  if (!p) return canonicalOrAny;
  if (family === 'c6xx') {
    return `${p.family}_onu-${p.shelf}/${p.slot}/${p.port}:${p.onuId}`;
  }
  return `${p.family}-onu_${p.shelf}/${p.slot}/${p.port}:${p.onuId}`;
}

/** Titan vport interface: vport-{shelf}/{slot}/{port}.{vport}:{onuId} */
export function buildZteC6xxVportIf(
  onuIf: string,
  vport: number,
): string | null {
  const p = parseZteOnuIfParts(onuIf);
  if (!p) return null;
  return `vport-${p.shelf}/${p.slot}/${p.port}.${vport}:${p.onuId}`;
}

/**
 * Cómo se crea el service-port IPTV (índice 3) según dialecto.
 * C3xx nunca usa vport-…; C6xx Titan sí (con fallback clásico en el cliente).
 */
export function zteIptvServicePortStrategy(
  family: ZteFwFamily,
): 'c6xx-vport' | 'c3xx-classic' {
  return family === 'c6xx' ? 'c6xx-vport' : 'c3xx-classic';
}
