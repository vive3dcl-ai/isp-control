/**
 * Modelo genérico FiberHome — fallback. Solo SPV sobre WAN existente.
 */
import { vendorFromSn } from '../../infra/vendor-from-sn';
import { resolveGenericServiceWan } from '../../infra/resolve-service-wan';
import { applyGenericServiceSpv } from '../../infra/service-spv';
import { ensureGenericServiceWan } from '../../infra/ensure-generic-service-wan';
import { ACS_HGU_PARAM_OWNERS } from '../../param-owners';
import {
  detectDataModelRoot,
  shouldWriteConnReqCredentials,
} from '../../infra/connreq-credentials';
import { serviceWanCarrierOk } from '../../infra/service-carrier';
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
    serviceCarrierOk: serviceWanCarrierOk(device),
  };
}

async function verifyHeal(
  ctx: OnuVerifyHealCtx,
): Promise<OnuModelProvisionResult> {
  const notes: string[] = [];
  // Con verifyHeal el poller omite ensureCredentialsFirst central: hay que
  // tomar connreq aquí (ONUs migradas con RMS).
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
  const r = await ensureGenericServiceWan(ctx, 'fiberhome_hgu');
  return { ok: r.ok, notes: [...notes, ...r.notes], progress: r.progress };
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
  // Sin esto el checker no llama verifyHeal si connreq es ajeno (RMS).
  ownsWanSelection(ctx: OnuModelProvisionMatchCtx): boolean {
    return vendorFromSn(ctx.sn) === 'fiberhome';
  },
  async ensureServiceWan(
    ctx: OnuModelProvisionCtx,
  ): Promise<OnuModelProvisionResult> {
    return ensureGenericServiceWan(ctx, 'fiberhome_hgu');
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
