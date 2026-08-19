import type {
  OnuHealGaps,
  OnuModelProvisionResult,
  OnuModelProvisionWanPlan,
  OnuVerifyHealCtx,
} from '../../types';
import {
  detectDataModelRoot,
  shouldWriteConnReqCredentials,
} from '../../infra/connreq-credentials';
import { genieGet, strVal } from '../../../../topology/shared/genieacs-nbi.client';
import { ensureTendaHg9ServiceWan, tendaHg9InformAlive } from './provision';
import {
  findTendaServiceWan,
  isTendaServiceWanApplied,
  listTendaWanIpConnections,
} from './wan';
import { ACS_ENSURE_SERVICE_STEP } from '../_progress-plans';
import {
  TR098_VERIFY_CHECKS,
  netStepsFromVerifyChecks,
  type OnuProgressStepDef,
} from '../../types';

export const TENDA_HG9_PROGRESS_PLAN: OnuProgressStepDef[] = [
  ACS_ENSURE_SERVICE_STEP,
  ...netStepsFromVerifyChecks(TR098_VERIFY_CHECKS),
];

export function diagnoseGapsTendaHg9(
  device: Record<string, unknown>,
  wan: OnuModelProvisionWanPlan,
  opts?: { mgmtIp?: string | null; reachable?: boolean },
): OnuHealGaps {
  const root = detectDataModelRoot(device);
  const user = strVal(
    genieGet(device, `${root}.ManagementServer.ConnectionRequestUsername`),
  );
  const has = !!findTendaServiceWan(listTendaWanIpConnections(device), {
    expectedVlan: wan.wanVlan,
    expectedIp: wan.wanIp,
  });
  return {
    connreqOurs: !shouldWriteConnReqCredentials(user),
    informAlive: tendaHg9InformAlive(device),
    reachable: opts?.reachable,
    hasServiceWan: has,
    serviceWanOk: isTendaServiceWanApplied(device, wan),
  };
}

export async function verifyHealTendaHg9(
  ctx: OnuVerifyHealCtx,
): Promise<OnuModelProvisionResult> {
  const { gaps } = ctx;

  // Si la WAN de servicio ya está bien, no tocar OMCI (pisa la IP ACS).
  if (gaps.serviceWanOk) {
    return {
      ok: true,
      notes: ['verify tenda-hg9: WAN servicio ya OK'],
      progress: {
        currentStepId: null,
        completed: ['ensure_service_wan'],
        notes: ['WAN servicio ya OK'],
      },
    };
  }

  // Agente TR-069 muerto: OMCI + reboot antes de SPV.
  if (
    gaps.reachable === false &&
    gaps.informAlive === false &&
    ctx.ensureOmciTr069
  ) {
    const omci = await ctx.ensureOmciTr069();
    const notes = ['verify tenda-hg9 → ensure_omci_tr069', ...omci.notes];
    if (omci.ok) {
      const rb = await ctx.reboot({ force: ctx.explicit });
      notes.push(rb.note);
    }
    return {
      ok: omci.ok,
      notes,
      progress: {
        currentStepId: 'ensure_omci_tr069',
        completed: omci.ok ? ['ensure_omci_tr069'] : [],
        notes,
      },
    };
  }

  const result = await ensureTendaHg9ServiceWan(ctx);
  return {
    ok: result.ok,
    notes: ['verify tenda-hg9', ...result.notes],
    progress: {
      currentStepId: 'ensure_service_wan',
      completed: result.ok ? ['ensure_service_wan'] : [],
      notes: result.notes,
    },
  };
}
