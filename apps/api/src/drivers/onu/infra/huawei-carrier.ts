/**
 * Carrier L2 de la WAN INTERNET Huawei (TR-098).
 * ERROR_NO_CARRIER = OLT sin service-port/flow hacia el VEIP.
 */
import {
  genieChildIndices,
  genieGet,
  strVal,
} from '../../../topology/shared/genieacs-nbi.client';

const WAN_DEV = 'InternetGatewayDevice.WANDevice';

export type HuaweiInternetCarrier = {
  conn: string;
  status: string | null;
  lastError: string | null;
  /** false = falta camino L2 OLT; true = Connected; undefined = sin WAN INTERNET */
  ok: boolean | undefined;
};

export function inspectHuaweiInternetCarrier(
  device: Record<string, unknown>,
): HuaweiInternetCarrier | null {
  for (const wd of genieChildIndices(device, WAN_DEV)) {
    const cdBase = `${WAN_DEV}.${wd}.WANConnectionDevice`;
    for (const cd of genieChildIndices(device, cdBase)) {
      const ipBase = `${cdBase}.${cd}.WANIPConnection`;
      for (const ip of genieChildIndices(device, ipBase)) {
        const conn = `${ipBase}.${ip}`;
        const svc = strVal(genieGet(device, `${conn}.X_HW_SERVICELIST`));
        if (!/INTERNET/i.test(svc ?? '')) continue;
        const status = strVal(genieGet(device, `${conn}.ConnectionStatus`));
        const lastError = strVal(
          genieGet(device, `${conn}.LastConnectionError`),
        );
        const noCarrier = /ERROR_NO_CARRIER/i.test(lastError ?? '');
        let ok: boolean | undefined;
        if (status === 'Connected' && !noCarrier) ok = true;
        else if (noCarrier) ok = false;
        else if (
          status === 'Connecting' ||
          status === 'Disconnected' ||
          status === 'Unconfigured' ||
          !status
        ) {
          // Sin ConnectionStatus tras SPV / árbol parcial → no asumir carrier OK
          // (si no, el heal hace noop y el modal queda en “Omitido”).
          ok = false;
        }
        return { conn, status, lastError, ok };
      }
    }
  }
  return null;
}

export function huaweiInternetCarrierOk(
  device: Record<string, unknown>,
): boolean | undefined {
  return inspectHuaweiInternetCarrier(device)?.ok;
}
