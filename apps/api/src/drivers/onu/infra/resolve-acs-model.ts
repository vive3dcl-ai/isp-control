/**
 * ModelName / ProductClass del árbol ACS (o del _deviceId GenieACS).
 *
 * FiberHome HG6143D a menudo no publica DeviceInfo.ModelName; el ProductClass
 * vive en `device._deviceId._ProductClass` (p. ej. `HG6143D`).
 */
import { genieGet, strVal } from '../../../topology/shared/genieacs-nbi.client';

/**
 * ProductClass embebido en `_id` GenieACS: `OUI-ProductClass-Serial`.
 * ProductClass puede llevar guiones (p. ej. EG8145X6-10).
 */
export function resolveAcsModelFromGenieId(
  deviceId: string | null | undefined,
): string | null {
  const id = (deviceId ?? '').trim();
  if (!id) return null;
  const parts = id.split('-');
  if (parts.length < 3) return null;
  const mid = parts.slice(1, -1).join('-').trim();
  return mid || null;
}

export function resolveAcsModelFromDevice(
  device: Record<string, unknown> | null | undefined,
): string | null {
  if (!device) return null;
  const fromTree =
    strVal(genieGet(device, 'InternetGatewayDevice.DeviceInfo.ModelName')) ??
    strVal(genieGet(device, 'InternetGatewayDevice.DeviceInfo.ProductClass')) ??
    strVal(genieGet(device, 'Device.DeviceInfo.ModelName')) ??
    strVal(genieGet(device, 'Device.DeviceInfo.ProductClass'));
  if (fromTree?.trim()) return fromTree.trim();

  const id = device._deviceId;
  if (id && typeof id === 'object') {
    const pc = (id as Record<string, unknown>)._ProductClass;
    if (typeof pc === 'string' && pc.trim()) return pc.trim();
  }

  const rawId =
    typeof device._id === 'string' || typeof device._id === 'number'
      ? String(device._id)
      : null;
  return resolveAcsModelFromGenieId(rawId);
}
