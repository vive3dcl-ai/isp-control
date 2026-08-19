import type {
  OnuHealGaps,
  OnuModelProvisionResult,
  OnuModelProvisionWanPlan,
  OnuVerifyHealCtx,
} from '../../types';
import {
  ensureFiberhomeServiceWan,
  isFiberhomeServiceWanApplied,
  findFiberhomeInternetWan,
  listFiberhomeWanIpConnections,
} from './core';
import {
  detectDataModelRoot,
  shouldWriteConnReqCredentials,
} from '../../infra/connreq-credentials';
import { genieGet, strVal } from '../../../../topology/shared/genieacs-nbi.client';

export function diagnoseGapsFiberhomeHg6143d(
  device: Record<string, unknown>,
  wan: OnuModelProvisionWanPlan,
  opts?: { mgmtIp?: string | null; reachable?: boolean },
): OnuHealGaps {
  const root = detectDataModelRoot(device);
  const user = strVal(
    genieGet(device, `${root}.ManagementServer.ConnectionRequestUsername`),
  );
  const has = !!findFiberhomeInternetWan(listFiberhomeWanIpConnections(device));
  return {
    connreqOurs: !shouldWriteConnReqCredentials(user),
    reachable: opts?.reachable,
    hasServiceWan: has,
    serviceWanOk: isFiberhomeServiceWanApplied(device, wan),
  };
}

export async function verifyHealFiberhomeHg6143d(
  ctx: OnuVerifyHealCtx,
): Promise<OnuModelProvisionResult> {
  const result = await ensureFiberhomeServiceWan(ctx);
  return {
    ok: result.ok,
    notes: ['verify fiberhome-hg6143d', ...result.notes],
    progress: {
      currentStepId: 'ensure_service_wan',
      completed: result.ok ? ['ensure_service_wan'] : [],
      notes: result.notes,
    },
  };
}
