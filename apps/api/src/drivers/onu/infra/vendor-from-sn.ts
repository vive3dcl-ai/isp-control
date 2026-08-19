/**
 * Vendor from GPON serial prefix (first 4 ASCII chars).
 * Pure helper — shared by ONU registry/library and OLT onu-type sync.
 */

export type OnuVendorKind = 'huawei' | 'zte' | 'fiberhome' | 'other';

export function vendorFromSn(sn: string | null | undefined): OnuVendorKind {
  const p = (sn ?? '').trim().toUpperCase().slice(0, 4);
  if (p === 'HWTC' || p === 'HWHT') return 'huawei';
  if (p === 'ZTEG' || p === 'ZTEg' || p.startsWith('ZTE')) return 'zte';
  if (p === 'FHTT' || p === 'FHTC') return 'fiberhome';
  return 'other';
}

/** Preferred vendor try-order when SN is unknown / other. */
export const VENDOR_PROBE_ORDER: OnuVendorKind[] = [
  'huawei',
  'zte',
  'fiberhome',
  'other',
];
