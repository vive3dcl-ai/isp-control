import { normalizeOnuModelName } from './onu-model-catalog';

/** True if the connected ONU type matches the firmware image model. */
export function firmwareModelMatches(
  imageModelKey: string,
  onuType: string | null | undefined,
): boolean {
  const image = normalizeOnuModelName(imageModelKey);
  const type = normalizeOnuModelName(onuType ?? '');
  if (!image || !type) return false;
  return image.toLowerCase() === type.toLowerCase();
}

export type FirmwareUpgradeSkipReason = 'sin_sn' | 'sin_acs' | 'sin_archivo_acs';

/**
 * Manual ACS upgrade needs a serial, a GenieACS device, and a registered file.
 * Returns the skip reason, or null if the download task can be queued.
 */
export function firmwareUpgradeSkipReason(opts: {
  sn?: string | null;
  acsDeviceId?: string | null;
  genieFileId?: string | null;
}): FirmwareUpgradeSkipReason | null {
  if (!opts.sn?.trim()) return 'sin_sn';
  if (!opts.acsDeviceId?.trim()) return 'sin_acs';
  if (!opts.genieFileId?.trim()) return 'sin_archivo_acs';
  return null;
}

export function firmwareUpgradeSkipLabel(
  reason: FirmwareUpgradeSkipReason,
): string {
  switch (reason) {
    case 'sin_sn':
      return 'Sin número de serie';
    case 'sin_acs':
      return 'Sin dispositivo ACS';
    case 'sin_archivo_acs':
      return 'Imagen no registrada en ACS';
  }
}
