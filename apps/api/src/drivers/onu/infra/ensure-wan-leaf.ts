import {
  genieGet,
  strVal,
  type GenieAcsNbiClient,
} from '../../../topology/shared/genieacs-nbi.client';

/**
 * Escribe una hoja de la WAN sola, relee y reintenta si no quedó puesta.
 * Extraído del path genérico (Huawei HG8245W5 deja hojas en blanco tras 200).
 */
export async function ensureWanLeaf(
  client: GenieAcsNbiClient,
  deviceId: string,
  path: string,
  value: string,
  label: string,
): Promise<string | null> {
  try {
    const first = await client.setParameterValues(deviceId, [
      [path, value, 'xsd:string'],
    ]);
    if (first.status !== 200 && first.status !== 202) {
      return `${label} WAN status ${first.status}`;
    }
    if (first.status === 202) {
      return `${label} ${value} encolado`;
    }

    try {
      await client.refreshObject(
        deviceId,
        path.slice(0, path.lastIndexOf('.')),
      );
    } catch {
      /* si no refresca, al menos ya la escribimos */
    }
    const rows = await client.findDevices({ _id: deviceId });
    const device = rows[0];
    const got = device ? strVal(genieGet(device, path)) : null;
    if (got && got === value) {
      return `${label} ${value}`;
    }

    const retry = await client.setParameterValues(deviceId, [
      [path, value, 'xsd:string'],
    ]);
    return retry.status === 200
      ? `${label} ${value} (reintento; antes=${got || 'vacío'})`
      : `${label} reintento status ${retry.status} (antes=${got || 'vacío'})`;
  } catch (e) {
    return `${label} WAN: ${e instanceof Error ? e.message : String(e)}`;
  }
}
