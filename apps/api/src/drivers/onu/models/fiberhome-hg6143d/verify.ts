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
import {
  healServiceL2IfNeeded,
  serviceWanCarrierOk,
} from '../../infra/service-carrier';
import { healServiceWanVlanToPanel } from '../../infra/service-wan-vlan';
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
    serviceCarrierOk: serviceWanCarrierOk(device, {
      expectedIp: wan.wanIp,
      expectedVlanId: wan.wanVlan,
      mgmtIp: opts?.mgmtIp,
    }),
  };
}

export async function verifyHealFiberhomeHg6143d(
  ctx: OnuVerifyHealCtx,
): Promise<OnuModelProvisionResult> {
  const notes: string[] = ['verify fiberhome-hg6143d'];

  // Paso 0: connreq nuestras (migradas llegan con RMS/SmartOLT). Sin esto el
  // ACS recibe 401 y el SPV de WAN queda en cola hasta el Inform.
  const root = detectDataModelRoot(ctx.device);
  const user = strVal(
    genieGet(
      ctx.device,
      `${root}.ManagementServer.ConnectionRequestUsername`,
    ),
  );
  if (shouldWriteConnReqCredentials(user)) {
    notes.push(await ctx.preloadConnReq());
  }

  // VLAN panel primero (SPV change o recreate si falla).
  const vlanHeal = await healServiceWanVlanToPanel(ctx, {
    family: 'fiberhome_hgu',
  });
  if (vlanHeal) {
    return {
      ok: vlanHeal.ok,
      notes: [...notes, ...vlanHeal.notes],
      progress: vlanHeal.progress,
    };
  }

  if (isFiberhomeServiceWanApplied(ctx.device, ctx.wan)) {
    const l2 = await healServiceL2IfNeeded(ctx);
    if (l2) {
      return {
        ok: l2.ok,
        notes: [...notes, ...l2.notes],
        progress: l2.progress,
      };
    }
  } else {
    // WAN mal o incompleta: si ya hay INTERNET sin carrier, L2 antes de SPV.
    const has = !!findFiberhomeInternetWan(
      listFiberhomeWanIpConnections(ctx.device),
    );
    if (has) {
      const l2 = await healServiceL2IfNeeded(ctx);
      if (l2) {
        return {
          ok: l2.ok,
          notes: [...notes, ...l2.notes],
          progress: l2.progress,
        };
      }
    }
  }

  const result = await ensureFiberhomeServiceWan(ctx);
  return {
    ok: result.ok,
    notes: [...notes, ...result.notes],
    progress: {
      currentStepId: 'ensure_service_wan',
      completed: result.ok ? ['ensure_service_wan'] : [],
      notes: [...notes, ...result.notes],
    },
  };
}
