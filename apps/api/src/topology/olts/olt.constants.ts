/**
 * OLT catalog: ZTE ZXA10 C3xx + C6xx (Titan) + Huawei SmartAX.
 * Brand/family is encoded in `subtype`.
 */

export const ZTE_SELECTABLE_SUBTYPES = [
  'zte_c220',
  'zte_c300',
  'zte_c320',
  'zte_c350',
  'zte_c610',
  'zte_c620',
  'zte_c650',
  'zte_c600',
  'zte_c680',
] as const;

export const ZTE_C3XX_SUBTYPES = [
  'zte_c220',
  'zte_c300',
  'zte_c320',
  'zte_c350',
] as const;

export const ZTE_C6XX_SUBTYPES = [
  'zte_c610',
  'zte_c620',
  'zte_c650',
  'zte_c600',
  'zte_c680',
] as const;

export const HUAWEI_SELECTABLE_SUBTYPES = [
  'huawei_ma5608t',
  'huawei_ma5683t',
  'huawei_ma5680t',
  'huawei_ma5800_x2',
  'huawei_ma5800_x7',
  'huawei_ma5800_x15',
  'huawei_ma5800_x17',
] as const;

export const OLT_SUBTYPES = [
  ...ZTE_SELECTABLE_SUBTYPES,
  /** @deprecated legacy bucket — migrate to an explicit model */
  'zte_c3xx',
  ...HUAWEI_SELECTABLE_SUBTYPES,
] as const;

export type OltSubtype = (typeof OLT_SUBTYPES)[number];
export type ZteSelectableSubtype = (typeof ZTE_SELECTABLE_SUBTYPES)[number];
export type HuaweiSelectableSubtype =
  (typeof HUAWEI_SELECTABLE_SUBTYPES)[number];

/** Models operators should pick (exclude deprecated bucket). */
export const OLT_SELECTABLE_SUBTYPES = [
  ...ZTE_SELECTABLE_SUBTYPES,
  ...HUAWEI_SELECTABLE_SUBTYPES,
] as const satisfies readonly OltSubtype[];

export type OltSelectableSubtype = (typeof OLT_SELECTABLE_SUBTYPES)[number];

export const OLT_SUBTYPE_LABELS: Record<OltSubtype, string> = {
  zte_c220: 'ZTE C220',
  zte_c300: 'ZTE C300',
  zte_c320: 'ZTE C320',
  zte_c350: 'ZTE C350 / C350M',
  zte_c610: 'ZTE C610 (Titan)',
  zte_c620: 'ZTE C620 (Titan)',
  zte_c650: 'ZTE C650 (Titan)',
  zte_c600: 'ZTE C600 (Titan)',
  zte_c680: 'ZTE C680 (Titan)',
  zte_c3xx: 'ZTE C3xx (sin modelo)',
  huawei_ma5608t: 'Huawei MA5608T',
  huawei_ma5683t: 'Huawei MA5683T',
  huawei_ma5680t: 'Huawei MA5680T / MA5600T',
  huawei_ma5800_x2: 'Huawei MA5800-X2',
  huawei_ma5800_x7: 'Huawei MA5800-X7',
  huawei_ma5800_x15: 'Huawei MA5800-X15',
  huawei_ma5800_x17: 'Huawei MA5800-X17',
};

export type OltVendor = 'zte' | 'huawei';

/** C3xx SoftVer buckets + Titan for C6xx. */
export const OLT_FIRMWARE_FAMILIES = ['1.2', '2.0', '2.1', 'titan'] as const;
export type OltFirmwareFamily = (typeof OLT_FIRMWARE_FAMILIES)[number];

export const OLT_FIRMWARE_FAMILY_LABELS: Record<OltFirmwareFamily, string> = {
  '1.2': 'v1.2.x',
  '2.0': 'v2.0.x',
  '2.1': 'v2.1.x',
  titan: 'Titan (C6xx)',
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
  subtype: ZteSelectableSubtype;
  productNames: string[];
  rackType: string;
  shelfType: string;
  defaultRackNo: number;
  defaultShelfNo: number;
  controlCardHints: string[];
  gponCardHints: string[];
  typicalGponSlots: number[];
  notes: string;
}

export interface HuaweiChassisProfile {
  subtype: HuaweiSelectableSubtype;
  productNames: string[];
  /** Frame number used in CLI (almost always 0). */
  defaultFrame: number;
  controlCardHints: string[];
  gponCardHints: string[];
  typicalServiceSlots: number[];
  notes: string;
}

export const ZTE_CHASSIS_PROFILES: Record<
  ZteSelectableSubtype,
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
    notes: 'Same C3xx family as C300 for most CLI/SNMP.',
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
    notes: 'Older generation. Rack/shelf often 0. Alternate shelf ZXA10C220-B.',
  },
  zte_c610: {
    subtype: 'zte_c610',
    productNames: ['C610'],
    rackType: 'TITAN',
    shelfType: 'C610_SHELF',
    defaultRackNo: 1,
    defaultShelfNo: 1,
    controlCardHints: ['SFUC', 'SFUL', 'SFUH', 'FCSDA'],
    gponCardHints: ['GFGH', 'GFCH', 'GFCL', 'GFBH', 'GFBN', 'GFXH', 'GFTH'],
    typicalGponSlots: [1, 2],
    notes: 'Titan compact (C6xx). ifName form gpon_olt-S/S/P.',
  },
  zte_c620: {
    subtype: 'zte_c620',
    productNames: ['C620'],
    rackType: 'TITAN',
    shelfType: 'C620_SHELF',
    defaultRackNo: 1,
    defaultShelfNo: 1,
    controlCardHints: ['SFUC', 'SFUL', 'SFUH', 'FCSDA'],
    gponCardHints: ['GFGH', 'GFCH', 'GFCL', 'GFBH', 'GFBN', 'GFXH', 'GFTH'],
    typicalGponSlots: [1, 2],
    notes: 'Titan 2U compact, ~2 service slots. ifName gpon_olt-S/S/P.',
  },
  zte_c650: {
    subtype: 'zte_c650',
    productNames: ['C650'],
    rackType: 'TITAN',
    shelfType: 'C650_SHELF',
    defaultRackNo: 1,
    defaultShelfNo: 1,
    controlCardHints: ['SFUC', 'SFUL', 'SFUH', 'FCSDA', 'SPUF'],
    gponCardHints: [
      'GFGH',
      'GFCH',
      'GFCL',
      'GFBH',
      'GFBN',
      'GFXH',
      'GFTH',
      'GFBT',
    ],
    typicalGponSlots: [1, 2, 3, 4, 5, 6, 7],
    notes: 'Titan mid chassis (~7 service slots).',
  },
  zte_c600: {
    subtype: 'zte_c600',
    productNames: ['C600'],
    rackType: 'TITAN',
    shelfType: 'C600_SHELF',
    defaultRackNo: 1,
    defaultShelfNo: 1,
    controlCardHints: ['SFUC', 'SFUL', 'SFUH', 'FCSDA', 'SPUF', 'PRSF'],
    gponCardHints: [
      'GFGH',
      'GFCH',
      'GFCL',
      'GFBH',
      'GFBN',
      'GFXH',
      'GFTH',
      'GFBT',
      'GFBL',
    ],
    typicalGponSlots: [
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17,
    ],
    notes: 'Titan large chassis (~15–17 service slots).',
  },
  zte_c680: {
    subtype: 'zte_c680',
    productNames: ['C680'],
    rackType: 'TITAN',
    shelfType: 'C680_SHELF',
    defaultRackNo: 1,
    defaultShelfNo: 1,
    controlCardHints: ['SFUC', 'SFUL', 'SFUH', 'FCSDA', 'SPUF', 'PRSF'],
    gponCardHints: [
      'GFGH',
      'GFCH',
      'GFCL',
      'GFBH',
      'GFBN',
      'GFXH',
      'GFTH',
      'GFBT',
      'GFBL',
    ],
    typicalGponSlots: [
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
    ],
    notes: 'Titan ultra-large capacity platform.',
  },
};

export const HUAWEI_CHASSIS_PROFILES: Record<
  HuaweiSelectableSubtype,
  HuaweiChassisProfile
> = {
  huawei_ma5608t: {
    subtype: 'huawei_ma5608t',
    productNames: ['MA5608T'],
    defaultFrame: 0,
    controlCardHints: ['MCUD', 'MCUD1'],
    gponCardHints: ['GPBD', 'GPBH', 'GPFD', 'XGBD'],
    typicalServiceSlots: [1, 2],
    notes: 'Compact 2U, 2 service slots (MA5600T family).',
  },
  huawei_ma5683t: {
    subtype: 'huawei_ma5683t',
    productNames: ['MA5683T'],
    defaultFrame: 0,
    controlCardHints: ['SCUN', 'SCUK', 'SCUL'],
    gponCardHints: ['GPBD', 'GPBH', 'GPFD', 'XGBD'],
    typicalServiceSlots: [1, 2, 3, 4, 5, 6],
    notes: 'Mid chassis, 6 service slots.',
  },
  huawei_ma5680t: {
    subtype: 'huawei_ma5680t',
    productNames: ['MA5680T', 'MA5600T'],
    defaultFrame: 0,
    controlCardHints: ['SCUN', 'SCUK', 'SCUL'],
    gponCardHints: ['GPBD', 'GPBH', 'GPFD', 'XGBD', 'XGBC'],
    typicalServiceSlots: [
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
    ],
    notes: 'Large MA5600T chassis (~14–16 service slots).',
  },
  huawei_ma5800_x2: {
    subtype: 'huawei_ma5800_x2',
    productNames: ['MA5800-X2', 'MA5800X2'],
    defaultFrame: 0,
    controlCardHints: ['MPSA', 'MPSC', 'MPSD'],
    gponCardHints: ['GPHF', 'GPUF', 'GPLF', 'GPSF', 'XGHD', 'CGHF'],
    typicalServiceSlots: [1, 2],
    notes: 'Next-gen compact, 2 service slots.',
  },
  huawei_ma5800_x7: {
    subtype: 'huawei_ma5800_x7',
    productNames: ['MA5800-X7', 'MA5800X7'],
    defaultFrame: 0,
    controlCardHints: ['MPLA', 'MPLB', 'MPLG'],
    gponCardHints: ['GPHF', 'GPUF', 'GPLF', 'GPSF', 'XGHD', 'CGHF', 'XGSF'],
    typicalServiceSlots: [1, 2, 3, 4, 5, 6, 7],
    notes: 'Next-gen mid chassis, 7 service slots.',
  },
  huawei_ma5800_x15: {
    subtype: 'huawei_ma5800_x15',
    productNames: ['MA5800-X15', 'MA5800X15'],
    defaultFrame: 0,
    controlCardHints: ['MPLA', 'MPLB', 'MPLG', 'MPLH'],
    gponCardHints: ['GPHF', 'GPUF', 'GPLF', 'GPSF', 'XGHD', 'CGHF', 'XGSF'],
    typicalServiceSlots: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    notes: 'Next-gen large chassis, 15 service slots.',
  },
  huawei_ma5800_x17: {
    subtype: 'huawei_ma5800_x17',
    productNames: ['MA5800-X17', 'MA5800X17'],
    defaultFrame: 0,
    controlCardHints: ['MPLA', 'MPLB', 'MPLG', 'MPLH'],
    gponCardHints: ['GPHF', 'GPUF', 'GPLF', 'GPSF', 'XGHD', 'CGHF', 'XGSF'],
    typicalServiceSlots: [
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17,
    ],
    notes: 'Next-gen flagship, 17 service slots.',
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

export type HuaweiCapability =
  | 'cli_probe_display_board'
  | 'cli_ont_info'
  | 'cli_ont_autofind'
  | 'snmp_ont_monitor'
  | 'snmp_optical_power'
  | 'provision_ont'
  | 'vlan_service_port'
  | 'dba_line_srv_profiles';

const ZTE_CAPS_FULL: ZteCapability[] = [
  'cli_probe_show_card',
  'cli_onu_state',
  'cli_onu_uncfg',
  'snmp_onu_monitor',
  'snmp_optical_power',
  'provision_onu',
  'mib_iftable_v2_required',
];

const ZTE_CAPS_C220: ZteCapability[] = [
  'cli_probe_show_card',
  'cli_onu_state',
  'cli_onu_uncfg',
  'snmp_onu_monitor',
  'snmp_optical_power',
  'provision_onu',
];

const ZTE_FW_ALL: Record<OltFirmwareFamily, ZteCapability[]> = {
  '1.2': ZTE_CAPS_FULL,
  '2.0': ZTE_CAPS_FULL,
  '2.1': ZTE_CAPS_FULL,
  titan: ZTE_CAPS_FULL,
};

const ZTE_FW_C220: Record<OltFirmwareFamily, ZteCapability[]> = {
  '1.2': ZTE_CAPS_C220,
  '2.0': ZTE_CAPS_C220,
  '2.1': ZTE_CAPS_C220,
  titan: ZTE_CAPS_C220,
};

export const ZTE_CAPABILITY_MATRIX: Record<
  ZteSelectableSubtype,
  Record<OltFirmwareFamily, ZteCapability[]>
> = {
  zte_c320: ZTE_FW_ALL,
  zte_c300: ZTE_FW_ALL,
  zte_c350: ZTE_FW_ALL,
  zte_c220: ZTE_FW_C220,
  zte_c610: ZTE_FW_ALL,
  zte_c620: ZTE_FW_ALL,
  zte_c650: ZTE_FW_ALL,
  zte_c600: ZTE_FW_ALL,
  zte_c680: ZTE_FW_ALL,
};

export const HUAWEI_CAPABILITIES: HuaweiCapability[] = [
  'cli_probe_display_board',
  'cli_ont_info',
  'cli_ont_autofind',
  'snmp_ont_monitor',
  'snmp_optical_power',
  'provision_ont',
  'vlan_service_port',
  'dba_line_srv_profiles',
];

export type HuaweiCapabilityPhase2 =
  | HuaweiCapability
  | 'rogue_ont'
  | 'mass_reboot'
  | 'tr069_omci'
  | 'onu_type_sync';

export const HUAWEI_CAPABILITIES_PHASE2: HuaweiCapabilityPhase2[] = [
  ...HUAWEI_CAPABILITIES,
  'rogue_ont',
  'mass_reboot',
  'tr069_omci',
  'onu_type_sync',
];

/** All ZTE model × firmware pairs. */
export const ZTE_MODEL_FIRMWARE_COMBOS: Array<{
  subtype: ZteSelectableSubtype;
  firmware: OltFirmwareFamily;
}> = ZTE_SELECTABLE_SUBTYPES.flatMap((subtype) =>
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
  if (u.startsWith('ET') || u.startsWith('EF')) return 'epon';
  // C3xx GT*/XG* and C6xx Titan GF* (GPON/XG/XGS/Combo)
  if (
    u.startsWith('GT') ||
    u.startsWith('XG') ||
    u.startsWith('GF') ||
    u.startsWith('CG')
  ) {
    return 'gpon';
  }
  return null;
}

/** Classify Huawei board type into PON family. */
export function classifyHuaweiCardPonFamily(
  cardType?: string | null,
): 'gpon' | 'epon' | null {
  if (!cardType) return null;
  const u = cardType.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (u.startsWith('EP') || u.includes('EPON')) return 'epon';
  if (
    u.startsWith('GP') ||
    u.startsWith('XG') ||
    u.startsWith('CG') ||
    u.startsWith('TW') ||
    u.startsWith('FL') ||
    u.includes('GPON')
  ) {
    return 'gpon';
  }
  return null;
}

/** Infer PON mode from card rows (ZTE or Huawei). */
export function detectPonTypeFromCards(
  cards: Array<{ cfgType?: string; realType?: string }>,
): OltPonType | null {
  let hasGpon = false;
  let hasEpon = false;
  for (const c of cards) {
    const fam =
      classifyZteCardPonFamily(c.realType) ??
      classifyZteCardPonFamily(c.cfgType) ??
      classifyHuaweiCardPonFamily(c.realType) ??
      classifyHuaweiCardPonFamily(c.cfgType);
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
    ((ZTE_SELECTABLE_SUBTYPES as readonly string[]).includes(subtype) ||
      subtype === 'zte_c3xx')
  );
}

export function isHuaweiOltSubtype(subtype?: string | null): boolean {
  return (
    !!subtype &&
    (HUAWEI_SELECTABLE_SUBTYPES as readonly string[]).includes(subtype)
  );
}

export function isZteOltDevice(type?: string | null, subtype?: string | null) {
  return type === 'olt' && isZteOltSubtype(subtype);
}

export function isHuaweiOltDevice(
  type?: string | null,
  subtype?: string | null,
) {
  return type === 'olt' && isHuaweiOltSubtype(subtype);
}

export function isManagedOltDevice(
  type?: string | null,
  subtype?: string | null,
) {
  return isZteOltDevice(type, subtype) || isHuaweiOltDevice(type, subtype);
}

export function oltVendor(
  type?: string | null,
  subtype?: string | null,
): OltVendor | null {
  if (isHuaweiOltDevice(type, subtype)) return 'huawei';
  if (isZteOltDevice(type, subtype)) return 'zte';
  return null;
}

/** Parse SoftVer like V1.2.5P3 / V2.1.0 → family 1.2 | 2.0 | 2.1 (C3xx). */
export function detectFirmwareFamily(
  softVer?: string | null,
  subtype?: string | null,
): OltFirmwareFamily | null {
  if (subtype && (ZTE_C6XX_SUBTYPES as readonly string[]).includes(subtype)) {
    return 'titan';
  }
  if (!softVer) return null;
  if (/\b(C6\d{2}|TITAN)\b/i.test(softVer)) return 'titan';
  const m = softVer.match(/V?\s*([12])\s*\.\s*([012])/i);
  if (!m) return null;
  const key = `${m[1]}.${m[2]}`;
  if (key === '1.2' || key === '2.0' || key === '2.1') return key;
  return null;
}

/** Map ZTE banner / product string → subtype (C6xx before C300). */
export function detectOltSubtypeFromProduct(
  product?: string | null,
): ZteSelectableSubtype | null {
  if (!product) return null;
  const p = product.toUpperCase().replace(/\s+/g, '');
  // Titan C6xx first — C600 must not match as C300
  if (p.includes('C680')) return 'zte_c680';
  if (p.includes('C650')) return 'zte_c650';
  if (p.includes('C620')) return 'zte_c620';
  if (p.includes('C610')) return 'zte_c610';
  if (p.includes('C600')) return 'zte_c600';
  if (p.includes('C350')) return 'zte_c350';
  if (p.includes('C320')) return 'zte_c320';
  if (p.includes('C300')) return 'zte_c300';
  if (p.includes('C220')) return 'zte_c220';
  return null;
}

export function isZteC6xxSubtype(subtype?: string | null): boolean {
  return (
    !!subtype && (ZTE_C6XX_SUBTYPES as readonly string[]).includes(subtype)
  );
}

export function isZteC3xxSubtype(subtype?: string | null): boolean {
  return (
    !!subtype &&
    ((ZTE_C3XX_SUBTYPES as readonly string[]).includes(subtype) ||
      subtype === 'zte_c3xx')
  );
}

/** Map Huawei product / version string → subtype */
export function detectHuaweiSubtypeFromProduct(
  product?: string | null,
): HuaweiSelectableSubtype | null {
  if (!product) return null;
  const p = product.toUpperCase().replace(/\s+/g, '');
  if (p.includes('MA5800-X17') || p.includes('MA5800X17')) {
    return 'huawei_ma5800_x17';
  }
  if (p.includes('MA5800-X15') || p.includes('MA5800X15')) {
    return 'huawei_ma5800_x15';
  }
  if (p.includes('MA5800-X7') || p.includes('MA5800X7')) {
    return 'huawei_ma5800_x7';
  }
  if (p.includes('MA5800-X2') || p.includes('MA5800X2')) {
    return 'huawei_ma5800_x2';
  }
  // Bare MA5800 / EA5800 without -Xn → keep closest catalog entry
  if (p.includes('MA5800') || p.includes('EA5800') || p.includes('MA5801')) {
    return 'huawei_ma5800_x17';
  }
  if (p.includes('MA5608T') || p.includes('MA5603T')) return 'huawei_ma5608t';
  if (p.includes('MA5683T')) return 'huawei_ma5683t';
  if (p.includes('MA5680T') || p.includes('MA5600T')) return 'huawei_ma5680t';
  return null;
}

export function getChassisProfile(
  subtype?: string | null,
): ZteChassisProfile | null {
  if (!subtype || !isZteOltSubtype(subtype) || subtype === 'zte_c3xx') {
    return null;
  }
  return ZTE_CHASSIS_PROFILES[subtype as ZteSelectableSubtype];
}

export function getHuaweiChassisProfile(
  subtype?: string | null,
): HuaweiChassisProfile | null {
  if (!subtype || !isHuaweiOltSubtype(subtype)) return null;
  return HUAWEI_CHASSIS_PROFILES[subtype as HuaweiSelectableSubtype];
}

export function getCapabilities(
  subtype?: string | null,
  firmware?: OltFirmwareFamily | null,
): ZteCapability[] {
  if (
    !subtype ||
    !isZteOltSubtype(subtype) ||
    subtype === 'zte_c3xx' ||
    !firmware
  ) {
    return [];
  }
  return ZTE_CAPABILITY_MATRIX[subtype as ZteSelectableSubtype][firmware] ?? [];
}

export function getHuaweiCapabilities(
  subtype?: string | null,
): HuaweiCapabilityPhase2[] {
  if (!isHuaweiOltSubtype(subtype)) return [];
  return [...HUAWEI_CAPABILITIES_PHASE2];
}
