/**
 * Adapter registry for ZTE model × firmware combinations.
 * Phase 1: chassis profiles + capability lookup.
 * Later: SNMP ifIndex codecs and CLI provisioning per cell.
 */

import {
  OLT_FIRMWARE_FAMILIES,
  OLT_SELECTABLE_SUBTYPES,
  ZTE_CAPABILITY_MATRIX,
  ZTE_CHASSIS_PROFILES,
  type OltFirmwareFamily,
  type OltSelectableSubtype,
  type ZteCapability,
  type ZteChassisProfile,
} from '../../olt.constants';

export interface ZteOltAdapter {
  subtype: OltSelectableSubtype;
  firmware: OltFirmwareFamily;
  chassis: ZteChassisProfile;
  capabilities: ZteCapability[];
  /** Stable key: zte_c320@2.1 */
  key: string;
}

const adapters = new Map<string, ZteOltAdapter>();

for (const subtype of OLT_SELECTABLE_SUBTYPES) {
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
  subtype: OltSelectableSubtype,
  firmware: OltFirmwareFamily,
): string {
  return `${subtype}@${firmware}`;
}

export function getZteAdapter(
  subtype?: string | null,
  firmware?: OltFirmwareFamily | null,
): ZteOltAdapter | null {
  if (!subtype || !firmware) return null;
  if (!(OLT_SELECTABLE_SUBTYPES as readonly string[]).includes(subtype)) {
    return null;
  }
  return adapters.get(adapterKey(subtype as OltSelectableSubtype, firmware)) ?? null;
}

export function listZteAdapters(): ZteOltAdapter[] {
  return [...adapters.values()];
}
