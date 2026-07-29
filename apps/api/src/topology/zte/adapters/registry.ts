/**
 * Adapter registry for ZTE model × firmware combinations.
 * Phase 1: chassis profiles + capability lookup.
 */

import {
  OLT_FIRMWARE_FAMILIES,
  ZTE_CAPABILITY_MATRIX,
  ZTE_CHASSIS_PROFILES,
  ZTE_SELECTABLE_SUBTYPES,
  type OltFirmwareFamily,
  type ZteCapability,
  type ZteChassisProfile,
  type ZteSelectableSubtype,
} from '../../olt.constants';

export interface ZteOltAdapter {
  subtype: ZteSelectableSubtype;
  firmware: OltFirmwareFamily;
  chassis: ZteChassisProfile;
  capabilities: ZteCapability[];
  /** Stable key: zte_c320@2.1 */
  key: string;
}

const adapters = new Map<string, ZteOltAdapter>();

for (const subtype of ZTE_SELECTABLE_SUBTYPES) {
  for (const firmware of OLT_FIRMWARE_FAMILIES) {
    const key = `${subtype}@${firmware}`;
    adapters.set(key, {
      subtype,
      firmware,
      chassis: ZTE_CHASSIS_PROFILES[subtype],
      capabilities: ZTE_CAPABILITY_MATRIX[subtype][firmware],
      key,
    });
  }
}

export function adapterKey(
  subtype: ZteSelectableSubtype,
  firmware: OltFirmwareFamily,
): string {
  return `${subtype}@${firmware}`;
}

export function getZteAdapter(
  subtype?: string | null,
  firmware?: OltFirmwareFamily | null,
): ZteOltAdapter | null {
  if (!subtype || !firmware) return null;
  if (!(ZTE_SELECTABLE_SUBTYPES as readonly string[]).includes(subtype)) {
    return null;
  }
  return (
    adapters.get(adapterKey(subtype as ZteSelectableSubtype, firmware)) ?? null
  );
}

export function listZteAdapters(): ZteOltAdapter[] {
  return [...adapters.values()];
}
