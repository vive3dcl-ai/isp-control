/**
 * Modelo genérico unknown — último fallback del registry.
 */
import { vendorFromSn } from '../../infra/vendor-from-sn';
import { resolveGenericServiceWan } from '../../infra/resolve-service-wan';
import { applyGenericServiceSpv } from '../../infra/service-spv';
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

async function verifyHeal(ctx: OnuVerifyHealCtx): Promise<OnuModelProvisionResult> {
  const found = resolveGenericServiceWan(ctx.device, {
    mgmtIp: ctx.mgmtIp,
    expectedIp: ctx.wan.wanIp,
    expectedVlanId: ctx.wan.wanVlan,
  });
  if (!found || found.isMgmt) {
    return {
      ok: false,
      notes: ['generic-unknown: sin WAN de servicio reconocible'],
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
  });
  return {
    ok: true,
    notes: ['verify generic-unknown', msg],
    progress: {
      currentStepId: 'apply_service_spv',
      completed: ['apply_service_spv'],
      notes: [msg],
    },
  };
}

export const genericUnknownDriver: OnuDriver = {
  id: 'generic-unknown',
  brand: 'unknown',
  omciPlan: { serviceWanOmci: 'apply' },
  skipOmciServiceWan: false,
  verifyChecks: DEFAULT_VERIFY_CHECKS,
  progressPlan: GENERIC_UNKNOWN_PROGRESS_PLAN,
  supportsTr181RouteHeal: false,
  matches(ctx: OnuModelProvisionMatchCtx): boolean {
    const v = vendorFromSn(ctx.sn);
    return v === 'other' || !v;
  },
  async ensureServiceWan(
    _ctx: OnuModelProvisionCtx,
  ): Promise<OnuModelProvisionResult> {
    return {
      ok: false,
      notes: ['generic-unknown: no crea WAN de servicio'],
    };
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
    return applyGenericServiceSpv(params);
  },
};
