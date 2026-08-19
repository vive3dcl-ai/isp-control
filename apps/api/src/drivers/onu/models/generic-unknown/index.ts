/**
 * Modelo genérico unknown — último fallback del registry.
 */
import { vendorFromSn } from '../../infra/vendor-from-sn';
import { resolveGenericServiceWan } from '../../infra/resolve-service-wan';
import { applyGenericServiceSpv } from '../../infra/service-spv';
import { ensureGenericServiceWan } from '../../infra/ensure-generic-service-wan';
import { OMCI_BRIDGE_PARAM_OWNERS } from '../../param-owners';
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
import { DEFAULT_VERIFY_CHECKS } from '../../types';
import { GENERIC_UNKNOWN_PROGRESS_PLAN } from '../_progress-plans';
import type { WanConnectionRef } from '../../infra/wan-datamodel';

async function verifyHeal(
  ctx: OnuVerifyHealCtx,
): Promise<OnuModelProvisionResult> {
  return ensureGenericServiceWan(ctx, 'unknown_hgu');
}

export const genericUnknownDriver: OnuDriver = {
  id: 'generic-unknown',
  brand: 'unknown',
  omciPlan: { serviceWanOmci: 'apply' },
  skipOmciServiceWan: false,
  paramOwners: OMCI_BRIDGE_PARAM_OWNERS,
  verifyChecks: DEFAULT_VERIFY_CHECKS,
  progressPlan: GENERIC_UNKNOWN_PROGRESS_PLAN,
  supportsTr181RouteHeal: false,
  matches(ctx: OnuModelProvisionMatchCtx): boolean {
    const v = vendorFromSn(ctx.sn);
    return v === 'other' || !v;
  },
  async ensureServiceWan(
    ctx: OnuModelProvisionCtx,
  ): Promise<OnuModelProvisionResult> {
    return ensureGenericServiceWan(ctx, 'unknown_hgu');
  },
  diagnoseGaps(
    _device: Record<string, unknown>,
    _wan: OnuModelProvisionWanPlan,
    opts?: { reachable?: boolean },
  ): OnuHealGaps {
    return { reachable: opts?.reachable };
  },
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
      owners: params.owners ?? OMCI_BRIDGE_PARAM_OWNERS,
    });
  },
};
