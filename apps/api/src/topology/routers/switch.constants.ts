export const SWITCH_SUBTYPES = [
  'generic',
  'mikrotik_routeros',
  'mikrotik_swos',
] as const;

export type SwitchSubtype = (typeof SWITCH_SUBTYPES)[number];

export const SWITCH_SUBTYPE_LABELS: Record<SwitchSubtype, string> = {
  generic: 'Genérico',
  mikrotik_routeros: 'MikroTik RouterOS',
  mikrotik_swos: 'MikroTik SwitchOS',
};

/** UI manufacturer choices for switches (maps to subtype + OS). */
export const SWITCH_VENDORS = ['generic', 'mikrotik'] as const;
export type SwitchVendor = (typeof SWITCH_VENDORS)[number];

export const SWITCH_VENDOR_LABELS: Record<SwitchVendor, string> = {
  generic: 'Genérico',
  mikrotik: 'MikroTik',
};

export const SWITCH_MIKROTIK_OS = ['routeros', 'swos'] as const;
export type SwitchMikrotikOs = (typeof SWITCH_MIKROTIK_OS)[number];

export const SWITCH_MIKROTIK_OS_LABELS: Record<SwitchMikrotikOs, string> = {
  routeros: 'RouterOS',
  swos: 'SwitchOS',
};

export function switchSubtypeFromUi(
  vendor: SwitchVendor,
  os?: SwitchMikrotikOs | null,
): SwitchSubtype {
  if (vendor === 'generic') return 'generic';
  return os === 'swos' ? 'mikrotik_swos' : 'mikrotik_routeros';
}

export function switchVendorFromSubtype(
  subtype?: string | null,
): SwitchVendor {
  if (subtype === 'mikrotik_routeros' || subtype === 'mikrotik_swos') {
    return 'mikrotik';
  }
  return 'generic';
}

export function switchOsFromSubtype(
  subtype?: string | null,
): SwitchMikrotikOs | null {
  if (subtype === 'mikrotik_swos') return 'swos';
  if (subtype === 'mikrotik_routeros') return 'routeros';
  return null;
}

export function isSwitchSubtype(value?: string | null): value is SwitchSubtype {
  return !!value && (SWITCH_SUBTYPES as readonly string[]).includes(value);
}

/** Router MikroTik or switch running RouterOS — same binary/REST API. */
export function isMikrotikRouterOsDevice(
  type?: string | null,
  subtype?: string | null,
): boolean {
  if (type === 'router' && subtype === 'mikrotik') return true;
  if (type === 'switch' && subtype === 'mikrotik_routeros') return true;
  return false;
}

export function isMikrotikSwosDevice(
  type?: string | null,
  subtype?: string | null,
): boolean {
  return type === 'switch' && subtype === 'mikrotik_swos';
}

export function isManagedSwitch(
  type?: string | null,
  subtype?: string | null,
): boolean {
  return (
    type === 'switch' &&
    (subtype === 'mikrotik_routeros' || subtype === 'mikrotik_swos')
  );
}

export const DEFAULT_SWOS_MGMT_PORT = 80;
