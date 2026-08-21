/**
 * Carrier L2 de la WAN de servicio (TR-098 / Huawei INTERNET).
 * ERROR_NO_CARRIER o Connecting/Disconnected → falta service-port/flow en OLT.
 *
 * La VLAN del service-port es siempre la del panel/pool.
 * Si el CPE etiqueta otra VLAN, curar primero con healServiceWanVlanToPanel
 * (change SPV o delete+recreate) antes de llamar a este helper.
 */
import {
  genieGet,
  strVal,
} from '../../../topology/shared/genieacs-nbi.client';
import type {
  OnuModelProvisionCtx,
  OnuModelProvisionResult,
} from '../types';
import { huaweiInternetCarrierOk } from './huawei-carrier';
import { findServiceWanConnection } from './wan-datamodel';

function carrierFromStatus(
  status: string | null,
  lastError: string | null,
): boolean | undefined {
  const noCarrier = /ERROR_NO_CARRIER/i.test(lastError ?? '');
  if (status === 'Connected' && !noCarrier) return true;
  if (noCarrier) return false;
  if (
    status === 'Connecting' ||
    status === 'Disconnected' ||
    status === 'Unconfigured' ||
    !status
  ) {
    return false;
  }
  return undefined;
}

/**
 * true = Connected; false = sin carrier L2; undefined = sin WAN de servicio
 * reconocible en el árbol.
 */
export function serviceWanCarrierOk(
  device: Record<string, unknown>,
  opts?: {
    expectedIp?: string | null;
    expectedVlanId?: number | null;
    mgmtIp?: string | null;
  },
): boolean | undefined {
  const hw = huaweiInternetCarrierOk(device);
  if (hw !== undefined) return hw;

  const found = findServiceWanConnection(device, {
    mgmtIp: opts?.mgmtIp,
    expectedIp: opts?.expectedIp,
    expectedVlanId: opts?.expectedVlanId,
  });
  if (!found || found.isMgmt) return undefined;
  const status = strVal(genieGet(device, `${found.conn}.ConnectionStatus`));
  const lastError = strVal(
    genieGet(device, `${found.conn}.LastConnectionError`),
  );
  return carrierFromStatus(status, lastError);
}

/**
 * Si el CPE reporta sin carrier y hay callback OLT, reaplica service-port/flow.
 * Devuelve null cuando no aplica (carrier ok / sin WAN / sin callback).
 */
export async function healServiceL2IfNeeded(
  ctx: OnuModelProvisionCtx,
  opts?: { force?: boolean },
): Promise<OnuModelProvisionResult | null> {
  const carrier =
    opts?.force === true
      ? false
      : serviceWanCarrierOk(ctx.device, {
          expectedIp: ctx.wan.wanIp,
          expectedVlanId: ctx.wan.wanVlan,
          mgmtIp: ctx.mgmtIp,
        });
  if (carrier !== false) return null;
  if (!ctx.ensureServiceL2) {
    return {
      ok: false,
      notes: [
        'ensure_service_l2: sin carrier (ERROR_NO_CARRIER/Connecting) y callback OLT no cableado',
      ],
    };
  }
  const r = await ctx.ensureServiceL2();
  return {
    ok: r.ok,
    notes: ['ensure_service_l2', ...r.notes],
    progress: {
      currentStepId: 'ensure_service_l2',
      completed: r.ok ? ['ensure_service_l2'] : [],
      notes: r.notes,
    },
  };
}
