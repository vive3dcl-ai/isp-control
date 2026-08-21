/**
 * Genérico Tenda (SN TDTC) cuando el modelo no es HG9.
 * ACS crea/cura WAN; OMCI no pisa VLAN de servicio.
 */
import { isTendaSn, matchesTendaHg9 } from '../tenda-hg9/match';
import { resolveGenericServiceWan } from '../../infra/resolve-service-wan';
import { applyGenericServiceSpv } from '../../infra/service-spv';
import { ensureGenericServiceWan } from '../../infra/ensure-generic-service-wan';
import { ACS_HGU_PARAM_OWNERS } from '../../param-owners';
import { serviceWanCarrierOk } from '../../infra/service-carrier';
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
import { GENERIC_TENDA_PROGRESS_PLAN } from '../_progress-plans';
import type { WanConnectionRef } from '../../infra/wan-datamodel';

async function verifyHeal(
  ctx: OnuVerifyHealCtx,
): Promise<OnuModelProvisionResult> {
  return ensureGenericServiceWan(ctx, 'tenda');
}

export const genericTendaDriver: OnuDriver = {
  id: 'generic-tenda',
  brand: 'unknown',
  omciPlan: { serviceWanOmci: 'skip' },
  skipOmciServiceWan: true,
  paramOwners: ACS_HGU_PARAM_OWNERS,
  verifyChecks: TR098_VERIFY_CHECKS,
  progressPlan: GENERIC_TENDA_PROGRESS_PLAN,
  supportsTr181RouteHeal: false,
  matches(ctx: OnuModelProvisionMatchCtx): boolean {
    return isTendaSn(ctx.sn) && !matchesTendaHg9(ctx);
  },
  ensureServiceWan(ctx: OnuModelProvisionCtx): Promise<OnuModelProvisionResult> {
    return ensureGenericServiceWan(ctx, 'tenda');
  },
  diagnoseGaps(
    device: Record<string, unknown>,
    _wan: OnuModelProvisionWanPlan,
    opts?: { reachable?: boolean },
  ): OnuHealGaps {
    return {
      reachable: opts?.reachable,
      serviceCarrierOk: serviceWanCarrierOk(device),
    };
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
      owners: params.owners ?? ACS_HGU_PARAM_OWNERS,
    });
  },
};
