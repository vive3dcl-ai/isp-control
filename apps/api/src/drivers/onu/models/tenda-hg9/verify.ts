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
import { ACS_ENSURE_SERVICE_STEP, OLT_SERVICE_L2_STEP } from '../_progress-plans';
import {
  healServiceL2IfNeeded,
  serviceWanCarrierOk,
} from '../../infra/service-carrier';
import { healServiceWanVlanToPanel } from '../../infra/service-wan-vlan';
import {
  TR098_VERIFY_CHECKS,
  netStepsFromVerifyChecks,
  type OnuProgressStepDef,
} from '../../types';

export const TENDA_HG9_PROGRESS_PLAN: OnuProgressStepDef[] = [
  ACS_ENSURE_SERVICE_STEP,
  OLT_SERVICE_L2_STEP,
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
    serviceCarrierOk: serviceWanCarrierOk(device, {
      expectedIp: wan.wanIp,
      expectedVlanId: wan.wanVlan,
      mgmtIp: opts?.mgmtIp,
    }),
  };
}

export type TendaHg9VerifyAction = 'noop' | 'omci' | 'spv' | 'l2';

/**
 * Heal HG9: Inform vivo + WAN mal → solo SPV (OMCI extra pisa la IP ACS).
 * Sin carrier L2 → service-port OLT antes de SPV.
 */
export function pickTendaHg9VerifyAction(
  gaps: OnuHealGaps,
): TendaHg9VerifyAction {
  if (gaps.serviceWanOk && gaps.serviceCarrierOk !== false) return 'noop';
  if (gaps.serviceCarrierOk === false) return 'l2';
  if (gaps.informAlive) return 'spv';
  if (gaps.reachable === false && gaps.informAlive === false) return 'omci';
  return 'spv';
}

export async function verifyHealTendaHg9(
  ctx: OnuVerifyHealCtx,
): Promise<OnuModelProvisionResult> {
  // VLAN panel primero (recreate; Tenda no reescribe X_TDTC_VLAN).
  const vlanHeal = await healServiceWanVlanToPanel(ctx, {
    family: 'tenda',
    prefer: 'recreate',
  });
  if (vlanHeal) {
    return {
      ok: vlanHeal.ok,
      notes: ['verify tenda-hg9', ...vlanHeal.notes],
      progress: vlanHeal.progress,
    };
  }

  const gaps = {
    ...ctx.gaps,
    serviceCarrierOk:
      ctx.gaps.serviceCarrierOk ??
      serviceWanCarrierOk(ctx.device ?? {}, {
        expectedIp: ctx.wan?.wanIp,
        expectedVlanId: ctx.wan?.wanVlan,
        mgmtIp: ctx.mgmtIp,
      }),
  };
  const action = pickTendaHg9VerifyAction(gaps);

  if (action === 'noop') {
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

  if (action === 'l2') {
    const l2 = await healServiceL2IfNeeded(ctx, { force: true });
    return {
      ok: l2?.ok ?? false,
      notes: ['verify tenda-hg9', ...(l2?.notes ?? ['ensure_service_l2'])],
      progress: l2?.progress ?? {
        currentStepId: 'ensure_service_l2',
        completed: [],
        notes: [],
      },
    };
  }

  // Agente TR-069 muerto: OMCI + reboot (tope del poller: force false).
  if (action === 'omci' && ctx.ensureOmciTr069) {
    const omci = await ctx.ensureOmciTr069();
    const notes = ['verify tenda-hg9 → ensure_omci_tr069', ...omci.notes];
    if (omci.ok) {
      const rb = await ctx.reboot({ force: false });
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
