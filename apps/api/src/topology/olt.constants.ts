/**
 * ZTE ZXA10 C-series catalog (SmartOLT-compatible set).
 *
 * Supported by SmartOLT explicitly:
 * - C300, C320, C350M, C220
 * - Firmware: v1.2.x, v2.0.x, v2.1.x
 *
 * @see https://www.smartolt.com/setup_instructions_tr069.html
 * @see https://www.smartolt.com/zte-olt-initial-setup.html
 */

export const OLT_SUBTYPES = [
  'zte_c220',
  'zte_c300',
  'zte_c320',
  'zte_c350',
  /** @deprecated legacy bucket — migrate to an explicit model */
  'zte_c3xx',
] as const;

export type OltSubtype = (typeof OLT_SUBTYPES)[number];

export const OLT_SUBTYPE_LABELS: Record<OltSubtype, string> = {
  zte_c220: 'ZTE C220',
  zte_c300: 'ZTE C300',
  zte_c320: 'ZTE C320',
  zte_c350: 'ZTE C350 / C350M',
  zte_c3xx: 'ZTE C3xx (sin modelo)',
};

/** Models operators should pick (exclude deprecated bucket). */
export const OLT_SELECTABLE_SUBTYPES = [
  'zte_c220',
  'zte_c300',
  'zte_c320',
  'zte_c350',
] as const satisfies readonly OltSubtype[];

export type OltSelectableSubtype = (typeof OLT_SELECTABLE_SUBTYPES)[number];

export const OLT_FIRMWARE_FAMILIES = ['1.2', '2.0', '2.1'] as const;
export type OltFirmwareFamily = (typeof OLT_FIRMWARE_FAMILIES)[number];

export const OLT_FIRMWARE_FAMILY_LABELS: Record<OltFirmwareFamily, string> = {
  '1.2': 'v1.2.x',
  '2.0': 'v2.0.x',
  '2.1': 'v2.1.x',
};

/** How isp-control reaches the OLT */
export const OLT_CONNECTION_MODES = ['public', 'secure'] as const;
export type OltConnectionMode = (typeof OLT_CONNECTION_MODES)[number];

export const OLT_CONNECTION_MODE_LABELS: Record<OltConnectionMode, string> = {
  public: 'Pública',
  secure: 'VPN',
};

export const OLT_CLI_PROTOCOLS = ['telnet', 'ssh'] as const;
export type OltCliProtocol = (typeof OLT_CLI_PROTOCOLS)[number];

export const DEFAULT_OLT_PORTS: Record<string, number> = {
  telnet: 23,
  ssh: 22,
  snmp: 161,
};

export interface ZteChassisProfile {
  subtype: OltSelectableSubtype;
  productNames: string[];
  rackType: string;
  shelfType: string;
  /** Typical rack/shelf numbers used at first boot */
  defaultRackNo: number;
  defaultShelfNo: number;
  /** Control / switching card type hints */
  controlCardHints: string[];
  /** Common GPON line-card types */
  gponCardHints: string[];
  /** Typical service slots that may hold GPON cards (physical) */
  typicalGponSlots: number[];
  notes: string;
}

/**
 * Chassis / rack-shelf profiles used at commissioning
 * (SmartOLT / ZTE CLI manuals).
 */
export const ZTE_CHASSIS_PROFILES: Record<
  OltSelectableSubtype,
  ZteChassisProfile
> = {
  zte_c320: {
    subtype: 'zte_c320',
    productNames: ['C320'],
    rackType: 'C320Rack',
    shelfType: 'C320_SHELF',
    defaultRackNo: 1,
    defaultShelfNo: 1,
    controlCardHints: ['SMXA'],
    gponCardHints: ['GTGO', 'GTGH', 'GTGHG', 'GTGL'],
    typicalGponSlots: [1, 2],
    notes: 'Compact 2U. Line cards usually slots 1–2.',
  },
  zte_c300: {
    subtype: 'zte_c300',
    productNames: ['C300'],
    rackType: 'IEC19',
    shelfType: 'IEC_SHELF',
    defaultRackNo: 1,
    defaultShelfNo: 1,
    controlCardHints: ['SCXN', 'SCXNT', 'SCXM', 'SCTMB', 'SCXL'],
    gponCardHints: ['GTGO', 'GTGH', 'GTGHG', 'GTGL', 'GTGQ'],
    typicalGponSlots: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    notes: 'Large chassis. GPON slots vary; detect from show card / ifName.',
  },
  zte_c350: {
    subtype: 'zte_c350',
    productNames: ['C350', 'C350M'],
    rackType: 'IEC19',
    shelfType: 'IEC_SHELF',
    defaultRackNo: 1,
    defaultShelfNo: 1,
    controlCardHints: ['SCXN', 'SCXM', 'SCTMB'],
    gponCardHints: ['GTGO', 'GTGH', 'GTGHG', 'GTGL'],
    typicalGponSlots: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    notes: 'Same C3xx family as C300 for most CLI/SNMP; SmartOLT lists C350M.',
  },
  zte_c220: {
    subtype: 'zte_c220',
    productNames: ['C220'],
    rackType: 'ZXPON',
    shelfType: 'ZXA10C220-A',
    defaultRackNo: 0,
    defaultShelfNo: 0,
    controlCardHints: [],
    gponCardHints: ['GTGO', 'GTGQ'],
    typicalGponSlots: [1, 2, 3, 4, 5, 6, 7, 8],
    notes:
      'Older generation. Rack/shelf often 0. Alternate shelf ZXA10C220-B.',
  },
};

export type ZteCapability =
  | 'cli_probe_show_card'
  | 'cli_onu_state'
  | 'cli_onu_uncfg'
  | 'snmp_onu_monitor'
  | 'snmp_optical_power'
  | 'provision_onu'
  | 'mib_iftable_v2_required';

/**
 * Capability matrix: every selectable model × firmware family.
 * Phase-1 live: cli_probe_show_card. Others marked for upcoming adapters.
 */
export const ZTE_CAPABILITY_MATRIX: Record<
  OltSelectableSubtype,
  Record<OltFirmwareFamily, ZteCapability[]>
> = {
  zte_c320: {
    '1.2': [
      'cli_probe_show_card',
      'cli_onu_state',
      'cli_onu_uncfg',
      'snmp_onu_monitor',
      'snmp_optical_power',
      'provision_onu',
      'mib_iftable_v2_required',
    ],
    '2.0': [
      'cli_probe_show_card',
      'cli_onu_state',
      'cli_onu_uncfg',
      'snmp_onu_monitor',
      'snmp_optical_power',
      'provision_onu',
      'mib_iftable_v2_required',
    ],
    '2.1': [
      'cli_probe_show_card',
      'cli_onu_state',
      'cli_onu_uncfg',
      'snmp_onu_monitor',
      'snmp_optical_power',
      'provision_onu',
      'mib_iftable_v2_required',
    ],
  },
  zte_c300: {
    '1.2': [
      'cli_probe_show_card',
      'cli_onu_state',
      'cli_onu_uncfg',
      'snmp_onu_monitor',
      'snmp_optical_power',
      'provision_onu',
      'mib_iftable_v2_required',
    ],
    '2.0': [
      'cli_probe_show_card',
      'cli_onu_state',
      'cli_onu_uncfg',
      'snmp_onu_monitor',
      'snmp_optical_power',
      'provision_onu',
      'mib_iftable_v2_required',
    ],
    '2.1': [
      'cli_probe_show_card',
      'cli_onu_state',
      'cli_onu_uncfg',
      'snmp_onu_monitor',
      'snmp_optical_power',
      'provision_onu',
      'mib_iftable_v2_required',
    ],
  },
  zte_c350: {
    '1.2': [
      'cli_probe_show_card',
      'cli_onu_state',
      'cli_onu_uncfg',
      'snmp_onu_monitor',
      'snmp_optical_power',
      'provision_onu',
      'mib_iftable_v2_required',
    ],
    '2.0': [
      'cli_probe_show_card',
      'cli_onu_state',
      'cli_onu_uncfg',
      'snmp_onu_monitor',
      'snmp_optical_power',
      'provision_onu',
      'mib_iftable_v2_required',
    ],
    '2.1': [
      'cli_probe_show_card',
      'cli_onu_state',
      'cli_onu_uncfg',
      'snmp_onu_monitor',
      'snmp_optical_power',
      'provision_onu',
      'mib_iftable_v2_required',
    ],
  },
  zte_c220: {
    '1.2': [
      'cli_probe_show_card',
      'cli_onu_state',
      'cli_onu_uncfg',
      'snmp_onu_monitor',
      'snmp_optical_power',
      'provision_onu',
    ],
    '2.0': [
      'cli_probe_show_card',
      'cli_onu_state',
      'cli_onu_uncfg',
      'snmp_onu_monitor',
      'snmp_optical_power',
      'provision_onu',
    ],
    '2.1': [
      'cli_probe_show_card',
      'cli_onu_state',
      'cli_onu_uncfg',
      'snmp_onu_monitor',
      'snmp_optical_power',
      'provision_onu',
    ],
  },
};

/** All model × firmware pairs we intend to cover (12 combinations). */
export const ZTE_MODEL_FIRMWARE_COMBOS: Array<{
  subtype: OltSelectableSubtype;
  firmware: OltFirmwareFamily;
}> = OLT_SELECTABLE_SUBTYPES.flatMap((subtype) =>
  OLT_FIRMWARE_FAMILIES.map((firmware) => ({ subtype, firmware })),
);

export const OLT_PON_TYPES = ['gpon', 'epon', 'gpon_epon'] as const;
export type OltPonType = (typeof OLT_PON_TYPES)[number];

export const OLT_PON_TYPE_LABELS: Record<OltPonType, string> = {
  gpon: 'GPON (GPON, XGPON, XGSPON)',
  epon: 'EPON (EPON, 10G-EPON)',
  gpon_epon: 'GPON+EPON',
};

/**
 * Classify a ZTE line-card CfgType/RealType into PON family.
 * Control/uplink cards return null.
 */
export function classifyZteCardPonFamily(
  cardType?: string | null,
): 'gpon' | 'epon' | null {
  if (!cardType) return null;
  const u = cardType.toUpperCase().replace(/[^A-Z0-9]/g, '');
  // EPON / 10G-EPON line cards: ETGO, ETGH, ETGOB…
  if (u.startsWith('ET')) return 'epon';
  // GPON / XGPON / XGSPON line cards: GTGO, GTGH, GTGHG, GTGL, XGT…
  if (u.startsWith('GT') || u.startsWith('XG')) return 'gpon';
  return null;
}

/** Infer SmartOLT-style PON mode from show card rows. */
export function detectPonTypeFromCards(
  cards: Array<{ cfgType?: string; realType?: string }>,
): OltPonType | null {
  let hasGpon = false;
  let hasEpon = false;
  for (const c of cards) {
    const fam =
      classifyZteCardPonFamily(c.realType) ??
      classifyZteCardPonFamily(c.cfgType);
    if (fam === 'gpon') hasGpon = true;
    if (fam === 'epon') hasEpon = true;
  }
  if (hasGpon && hasEpon) return 'gpon_epon';
  if (hasGpon) return 'gpon';
  if (hasEpon) return 'epon';
  return null;
}

export function isZteOltSubtype(subtype?: string | null): boolean {
  return (
    !!subtype &&
    (OLT_SELECTABLE_SUBTYPES as readonly string[]).includes(subtype)
  );
}

export function isZteOltDevice(type?: string | null, subtype?: string | null) {
  return type === 'olt' && (isZteOltSubtype(subtype) || subtype === 'zte_c3xx');
}

/** Parse SoftVer like V1.2.5P3 / V2.1.0 → family 1.2 | 2.0 | 2.1 */
export function detectFirmwareFamily(
  softVer?: string | null,
): OltFirmwareFamily | null {
  if (!softVer) return null;
  const m = softVer.match(/V?\s*([12])\s*\.\s*([012])/i);
  if (!m) return null;
  const major = m[1];
  const minor = m[2];
  const key = `${major}.${minor}`;
  if (key === '1.2' || key === '2.0' || key === '2.1') return key;
  return null;
}

/** Map banner / product string → subtype */
export function detectOltSubtypeFromProduct(
  product?: string | null,
): OltSelectableSubtype | null {
  if (!product) return null;
  const p = product.toUpperCase();
  if (p.includes('C350')) return 'zte_c350';
  if (p.includes('C320')) return 'zte_c320';
  if (p.includes('C300')) return 'zte_c300';
  if (p.includes('C220')) return 'zte_c220';
  return null;
}

export function getChassisProfile(
  subtype?: string | null,
): ZteChassisProfile | null {
  if (!subtype || !isZteOltSubtype(subtype)) return null;
  return ZTE_CHASSIS_PROFILES[subtype as OltSelectableSubtype];
}

export function getCapabilities(
  subtype?: string | null,
  firmware?: OltFirmwareFamily | null,
): ZteCapability[] {
  if (!subtype || !isZteOltSubtype(subtype) || !firmware) return [];
  return ZTE_CAPABILITY_MATRIX[subtype as OltSelectableSubtype][firmware] ?? [];
}
