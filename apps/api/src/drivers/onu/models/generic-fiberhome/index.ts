/**
 * Modelo genérico FiberHome — fallback. Solo SPV sobre WAN existente.
 */
import { vendorFromSn } from '../../infra/vendor-from-sn';
import { resolveGenericServiceWan } from '../../infra/resolve-service-wan';
import { applyGenericServiceSpv } from '../../infra/service-spv';
import { ACS_HGU_PARAM_OWNERS } from '../../param-owners';
import {
  detectDataModelRoot,
  shouldWriteConnReqCredentials,
} from '../../infra/connreq-credentials';
import { genieGet, strVal } from '../../../../topology/shared/genieacs-nbi.client';
import type {
  ApplyServiceSpvParams,
  OnuDriver,
  OnuHealGaps,
  OnuModelProvisionCtx,
  OnuModelProvisionMatchCtx,
  OnuModelProvisionResult,
  OnuModelProvisionWanPlan,
  OnuVerifyHealCtx,
  ResolveServiceWanOpts,
} from '../../types';
import { TR098_VERIFY_CHECKS } from '../../types';
import { GENERIC_FIBERHOME_PROGRESS_PLAN } from '../_progress-plans';
import type { WanConnectionRef } from '../../infra/wan-datamodel';

function diagnoseGaps(
  device: Record<string, unknown>,
  _wan: OnuModelProvisionWanPlan,
  opts?: { reachable?: boolean },
): OnuHealGaps {
  const root = detectDataModelRoot(device);
  const user = strVal(
    genieGet(device, `${root}.ManagementServer.ConnectionRequestUsername`),
  );
  return {
    connreqOurs: !shouldWriteConnReqCredentials(user),
    reachable: opts?.reachable,
  };
}

async function verifyHeal(ctx: OnuVerifyHealCtx): Promise<OnuModelProvisionResult> {
  const found = resolveGenericServiceWan(ctx.device, {
    mgmtIp: ctx.mgmtIp,
    expectedIp: ctx.wan.wanIp,
    expectedVlanId: ctx.wan.wanVlan,
  });
  if (!found || found.isMgmt) {
    return {
      ok: false,
      notes: [
        'generic-fiberhome: sin WAN de servicio — hace falta modelo library o WAN ya existente',
      ],
      progress: { currentStepId: 'apply_service_spv', completed: [], notes: [] },
    };
  }
  const msg = await applyGenericServiceSpv({
    client: ctx.client,
    deviceId: ctx.deviceId,
    device: ctx.device,
    sn: ctx.sn,
    wan: ctx.wan,
    found,
    owners: ACS_HGU_PARAM_OWNERS,
  });
  return {
    ok: true,
    notes: ['verify generic-fiberhome', msg],
    progress: {
      currentStepId: 'apply_service_spv',
      completed: ['apply_service_spv'],
      notes: [msg],
    },
  };
}

export const genericFiberhomeDriver: OnuDriver = {
  id: 'generic-fiberhome',
  brand: 'fiberhome',
  omciPlan: { serviceWanOmci: 'skip' },
  skipOmciServiceWan: true,
  paramOwners: ACS_HGU_PARAM_OWNERS,
  verifyChecks: TR098_VERIFY_CHECKS,
  progressPlan: GENERIC_FIBERHOME_PROGRESS_PLAN,
  supportsTr181RouteHeal: false,
  matches(ctx: OnuModelProvisionMatchCtx): boolean {
    return vendorFromSn(ctx.sn) === 'fiberhome';
  },
  async ensureServiceWan(
    _ctx: OnuModelProvisionCtx,
  ): Promise<OnuModelProvisionResult> {
    return {
      ok: false,
      notes: [
        'generic-fiberhome: no crea WAN de servicio — hace falta modelo library o WAN ya existente',
      ],
    };
  },
  diagnoseGaps,
  verifyHeal,
  healOne: verifyHeal,
  resolveServiceWan(
    device: Record<string, unknown>,
    wanOpts: ResolveServiceWanOpts,
  ): WanConnectionRef | null {
    return resolveGenericServiceWan(device, wanOpts);
  },
  applyServiceSpv(params: ApplyServiceSpvParams): Promise<string> {
    return applyGenericServiceSpv({
      ...params,
      owners: params.owners ?? ACS_HGU_PARAM_OWNERS,
    });
  },
};
