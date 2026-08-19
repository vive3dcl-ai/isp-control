/**
 * Verify heal HGU VEIP: un tick = ensureServiceWan (sin pasos atómicos aún).
 */
import type {
  OnuHealGaps,
  OnuModelProvisionResult,
  OnuModelProvisionWanPlan,
  OnuVerifyHealCtx,
} from '../../types';
import { ensureHuaweiServiceWan } from './provision';
import {
  findHuaweiInternetWan,
  isServiceWanApplied,
  listHuaweiWanIpConnections,
} from './wan';
import {
  connreqCredentialsTrusted,
  detectDataModelRoot,
} from '../../infra/connreq-credentials';
import { genieGet, strVal } from '../../../../topology/shared/genieacs-nbi.client';

export function diagnoseGapsHuaweiHgu(
  device: Record<string, unknown>,
  wan: OnuModelProvisionWanPlan,
  opts?: { mgmtIp?: string | null; reachable?: boolean },
): OnuHealGaps {
  const root = detectDataModelRoot(device);
  const user = strVal(
    genieGet(device, `${root}.ManagementServer.ConnectionRequestUsername`),
  );
  const has = !!findHuaweiInternetWan(listHuaweiWanIpConnections(device));
  return {
    connreqOurs: connreqCredentialsTrusted({
      currentUsername: user,
      reachable: opts?.reachable,
    }),
    reachable: opts?.reachable,
    hasServiceWan: has,
    serviceWanOk: isServiceWanApplied(device, wan),
  };
}

export async function verifyHealHuaweiHgu(
  ctx: OnuVerifyHealCtx,
): Promise<OnuModelProvisionResult> {
  const result = await ensureHuaweiServiceWan(ctx);
  return {
    ok: result.ok,
    notes: ['verify huawei-hgu-veip', ...result.notes],
    progress: {
      currentStepId: 'ensure_service_wan',
      completed: result.ok ? ['ensure_service_wan'] : [],
      notes: result.notes,
    },
  };
}
