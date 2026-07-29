/**
 * Seed data for public.onu_catalog (ZTE + Huawei).
 * Model names are codes only (e.g. HG8245H, F660) — vendor is a separate field.
 * Images default to local SVGs under /onu/{imageKey}.svg until real photos are uploaded.
 *
 * Specs are typical ISP/OMCI configs (ports may vary by HW revision).
 */

export type OnuImageKey = 'zte-sfu' | 'zte-hgu' | 'huawei-sfu' | 'huawei-hgu';

export type OnuCatalogSeed = {
  vendor: 'zte' | 'huawei';
  name: string;
  ponType: 'gpon' | 'epon';
  ethernetPorts: number;
  wifiSsids: number;
  voipPorts: number;
  catv: boolean;
  capability: 'bridging' | 'bridging_routing';
  allowCustomProfiles: boolean;
  defaultProfileCode: string | null;
  imageKey: OnuImageKey;
  note?: string;
};

/** Strip vendor brand prefixes so catalog / OLT codes match (HG8245H, F660). */
export function normalizeOnuModelName(raw: string): string {
  let s = raw.trim();
  if (!s) return '';
  s = s.replace(/^(Huawei|ZTE|FiberHome|Alcatel|Nokia)\s*[-_/]\s*/i, '');
  s = s.replace(/\s+/g, '');
  return s;
}

export function inferOnuVendor(model: string): 'zte' | 'huawei' | 'other' {
  const m = normalizeOnuModelName(model);
  if (/^(HG|EG|HN|HS|MA|OptiX)/i.test(m)) return 'huawei';
  if (/^(F\d|ZXA|ZTEG|G-\d)/i.test(m)) return 'zte';
  return 'other';
}

function sfu(
  vendor: 'zte' | 'huawei',
  name: string,
  opts: Partial<OnuCatalogSeed> & { ponType?: 'gpon' | 'epon' } = {},
): OnuCatalogSeed {
  return {
    vendor,
    name,
    ponType: opts.ponType ?? 'gpon',
    ethernetPorts: opts.ethernetPorts ?? 1,
    wifiSsids: opts.wifiSsids ?? 0,
    voipPorts: opts.voipPorts ?? 0,
    catv: opts.catv ?? false,
    capability: opts.capability ?? 'bridging',
    allowCustomProfiles: opts.allowCustomProfiles ?? true,
    defaultProfileCode: opts.defaultProfileCode ?? 'generic_1',
    imageKey: opts.imageKey ?? (vendor === 'huawei' ? 'huawei-sfu' : 'zte-sfu'),
    note: opts.note,
  };
}

function hgu(
  vendor: 'zte' | 'huawei',
  name: string,
  opts: Partial<OnuCatalogSeed> & { ponType?: 'gpon' | 'epon' } = {},
): OnuCatalogSeed {
  return {
    vendor,
    name,
    ponType: opts.ponType ?? 'gpon',
    ethernetPorts: opts.ethernetPorts ?? 4,
    wifiSsids: opts.wifiSsids ?? 4,
    voipPorts: opts.voipPorts ?? 2,
    catv: opts.catv ?? false,
    capability: opts.capability ?? 'bridging_routing',
    allowCustomProfiles: opts.allowCustomProfiles ?? true,
    defaultProfileCode: opts.defaultProfileCode ?? 'generic_6',
    imageKey: opts.imageKey ?? (vendor === 'huawei' ? 'huawei-hgu' : 'zte-hgu'),
    note: opts.note,
  };
}

export const ONU_CATALOG_SEEDS: OnuCatalogSeed[] = [
  // ─── ZTE SFU / bridge ───────────────────────────────────────────
  sfu('zte', 'F601', { note: 'SFU 1xGE bridge' }),
  sfu('zte', 'F601V6.0'),
  sfu('zte', 'F601V7.0'),
  sfu('zte', 'F601V9.0'),
  sfu('zte', 'F600'),
  sfu('zte', 'F600V9'),
  sfu('zte', 'F612', { ethernetPorts: 2, note: '2xFE bridge' }),
  sfu('zte', 'F400', { ponType: 'epon', note: 'EPON SFU' }),
  sfu('zte', 'F401', { ponType: 'epon', note: 'EPON SFU' }),
  sfu('zte', 'F460', { ponType: 'epon', ethernetPorts: 4 }),
  sfu('zte', 'F6005', {
    ethernetPorts: 1,
    note: 'XG-PON / stick form-factor (revisar HW)',
  }),
  sfu('zte', 'F6005V3', { note: 'XG-PON ONT stick' }),

  // ─── ZTE HGU / WiFi gateway ─────────────────────────────────────
  hgu('zte', 'F660', { note: '4GE + 2POTS + WiFi' }),
  hgu('zte', 'F660V5.0'),
  hgu('zte', 'F660V6.0'),
  hgu('zte', 'F660V7.0'),
  hgu('zte', 'F660V7.1'),
  hgu('zte', 'F660V8.0'),
  hgu('zte', 'F660V9.0'),
  hgu('zte', 'F660V9.1'),
  hgu('zte', 'F660V9.2', {
    ethernetPorts: 4,
    wifiSsids: 4,
    voipPorts: 1,
    note: '1GE+3FE típico en V9.2',
  }),
  hgu('zte', 'ZXA10-F660'),
  hgu('zte', 'F663N', { voipPorts: 1 }),
  hgu('zte', 'F663NV3A', { voipPorts: 1 }),
  hgu('zte', 'F663NV9', { voipPorts: 1 }),
  hgu('zte', 'F609'),
  hgu('zte', 'F609V5'),
  hgu('zte', 'F609V9'),
  hgu('zte', 'F623'),
  hgu('zte', 'F623V9'),
  hgu('zte', 'F670', { voipPorts: 1, note: 'Dual-band WiFi' }),
  hgu('zte', 'F670L', { voipPorts: 1 }),
  hgu('zte', 'F670V1.0', { voipPorts: 1 }),
  hgu('zte', 'F670V2.0', { voipPorts: 1 }),
  hgu('zte', 'F670V9', { voipPorts: 1 }),
  hgu('zte', 'F680', { note: 'High-end WiFi ONT' }),
  hgu('zte', 'F680V5', { note: 'WiFi 6 / AX' }),
  hgu('zte', 'F680V6'),
  hgu('zte', 'F680V9'),
  hgu('zte', 'F6600', { note: 'WiFi 6 next-gen' }),
  hgu('zte', 'F6600P', { note: 'WiFi 6' }),
  hgu('zte', 'F6600R'),
  hgu('zte', 'F673A', { voipPorts: 1 }),
  hgu('zte', 'F673AV9', { voipPorts: 1 }),
  hgu('zte', 'F698A', { voipPorts: 1 }),
  hgu('zte', 'F6986Q', { voipPorts: 1, note: 'WiFi 6' }),
  hgu('zte', 'F8648P', {
    ethernetPorts: 8,
    wifiSsids: 0,
    voipPorts: 0,
    note: 'Business / multi-ETH',
  }),
  hgu('zte', 'F625', {
    wifiSsids: 0,
    catv: true,
    note: 'CATV sin WiFi típico',
  }),
  hgu('zte', 'F625G', { wifiSsids: 0, catv: true, note: 'Con CATV' }),
  hgu('zte', 'F660W', { catv: false }),
  hgu('zte', 'F650', { ethernetPorts: 1, voipPorts: 0, wifiSsids: 0 }),
  hgu('zte', 'F620', {
    ethernetPorts: 4,
    wifiSsids: 0,
    voipPorts: 2,
    note: 'Sin WiFi',
  }),
  hgu('zte', 'F620V5', {
    ethernetPorts: 4,
    wifiSsids: 0,
    voipPorts: 2,
  }),
  hgu('zte', 'F640', {
    ethernetPorts: 4,
    wifiSsids: 0,
    voipPorts: 0,
  }),
  sfu('zte', 'G-98', { note: 'Stick / SFP ONT' }),
  sfu('zte', 'ZTEG-9806H'),

  // ─── Huawei SFU / bridge ────────────────────────────────────────
  sfu('huawei', 'HG8010H', { note: 'SFU 1xGE' }),
  sfu('huawei', 'HG8010'),
  sfu('huawei', 'HG8010C'),
  sfu('huawei', 'HG8310M', { note: 'SFU 1xGE' }),
  sfu('huawei', 'HG8310'),
  sfu('huawei', 'EG8010H'),
  sfu('huawei', 'EG8010N'),
  sfu('huawei', 'HG8110H', {
    voipPorts: 1,
    note: '1GE + 1POTS',
  }),
  sfu('huawei', 'HG8110'),
  sfu('huawei', 'HG8110F', { voipPorts: 1 }),
  sfu('huawei', 'EG8110H', { voipPorts: 1 }),
  sfu('huawei', 'HG8120H', {
    ethernetPorts: 2,
    voipPorts: 1,
    note: '1GE+1FE+POTS',
  }),
  sfu('huawei', 'HG8120C', { ethernetPorts: 2, voipPorts: 1 }),
  sfu('huawei', 'HG8120F', { ethernetPorts: 2, voipPorts: 1 }),
  sfu('huawei', 'EG8120L', {
    ethernetPorts: 2,
    voipPorts: 1,
  }),
  sfu('huawei', 'HG8040', {
    ethernetPorts: 4,
    note: '4FE bridge',
  }),
  sfu('huawei', 'HG8340M', { ethernetPorts: 4 }),
  sfu('huawei', 'HG8540', { ethernetPorts: 4 }),

  // ─── Huawei HGU / WiFi gateway ──────────────────────────────────
  hgu('huawei', 'HG8240H', {
    wifiSsids: 0,
    note: '4GE + 2POTS sin WiFi',
  }),
  hgu('huawei', 'HG8240', { wifiSsids: 0 }),
  hgu('huawei', 'HG8240F', {
    ethernetPorts: 4,
    wifiSsids: 0,
    voipPorts: 2,
  }),
  hgu('huawei', 'HG8240S', { wifiSsids: 0 }),
  hgu('huawei', 'HG8242H', {
    wifiSsids: 0,
    catv: true,
    note: '4GE + 2POTS + CATV',
  }),
  hgu('huawei', 'HG8245', { note: '4GE + 2POTS + WiFi' }),
  hgu('huawei', 'HG8245A'),
  hgu('huawei', 'HG8245C'),
  hgu('huawei', 'HG8245D', { note: 'Dual-band WiFi' }),
  hgu('huawei', 'HG8245H', { note: '4GE + 2POTS + WiFi' }),
  hgu('huawei', 'HG8245H5'),
  hgu('huawei', 'HG8245Q', { note: 'Dual-band + 2USB' }),
  hgu('huawei', 'HG8245U', { note: 'Dual-band' }),
  hgu('huawei', 'HG8245W5'),
  hgu('huawei', 'HG8247', { catv: true, note: 'Con CATV' }),
  hgu('huawei', 'HG8247H', { catv: true, note: 'Con CATV' }),
  hgu('huawei', 'HG8247U', { catv: true, note: 'Dual-band + CATV' }),
  hgu('huawei', 'HG8342', { wifiSsids: 0 }),
  hgu('huawei', 'HG8342R', { wifiSsids: 0 }),
  hgu('huawei', 'HG8345R', { note: '4FE + WiFi' }),
  hgu('huawei', 'HG8346M'),
  hgu('huawei', 'HG8346R'),
  hgu('huawei', 'HG8546M', {
    voipPorts: 1,
    note: '1GE+3FE + WiFi + VoIP',
  }),
  hgu('huawei', 'EG8145V5', {
    voipPorts: 1,
    note: 'WiFi dual-band popular',
  }),
  hgu('huawei', 'EG8145X6', {
    voipPorts: 1,
    note: 'WiFi 6',
  }),
  hgu('huawei', 'EG8245H5'),
  hgu('huawei', 'EG8247H5', { catv: true }),
  hgu('huawei', 'EG8240H', { wifiSsids: 0 }),
  hgu('huawei', 'EG8147X6', {
    voipPorts: 1,
    catv: true,
    note: 'WiFi 6 + CATV',
  }),
  hgu('huawei', 'HN8245Q', {
    note: 'XG-PON routing ONT',
  }),
  hgu('huawei', 'HN8255Ws', {
    ethernetPorts: 5,
    note: 'XGS-PON + 10GE',
  }),
  hgu('huawei', 'HS8145V5', { voipPorts: 1 }),
  hgu('huawei', 'HS8546V5', { voipPorts: 1 }),
  sfu('huawei', 'MA5671A', {
    note: 'SFP stick ONT',
  }),
  sfu('huawei', 'MA5620', {
    ethernetPorts: 8,
    note: 'MDU / multi-port',
  }),
  sfu('huawei', 'MA5626', {
    ethernetPorts: 8,
    note: 'MDU',
  }),
];

export function resolveOnuImageUrl(imageKey: string): string {
  const key = imageKey.replace(/\.svg$/i, '');
  return `/onu/${key}.svg`;
}

export function imageKeyForVendorCapability(
  vendor: string,
  capability: string,
): OnuImageKey {
  const isHuawei = vendor === 'huawei';
  const isBridge = capability === 'bridging';
  if (isHuawei) return isBridge ? 'huawei-sfu' : 'huawei-hgu';
  return isBridge ? 'zte-sfu' : 'zte-hgu';
}
