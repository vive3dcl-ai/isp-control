/**
 * Modelo genérico Huawei — fallback cuando no hay library específica.
 * Solo SPV sobre WAN existente; no crea WAN.
 */
import { vendorFromSn } from '../../infra/vendor-from-sn';
import { resolveGenericServiceWan } from '../../infra/resolve-service-wan';
import { applyGenericServiceSpv } from '../../infra/service-spv';
import { ensureGenericServiceWan } from '../../infra/ensure-generic-service-wan';
import { ACS_HGU_PARAM_OWNERS } from '../../param-owners';
import {
  detectDataModelRoot,
  connreqCredentialsTrusted,
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
import { GENERIC_HUAWEI_PROGRESS_PLAN } from '../_progress-plans';
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
    connreqOurs: connreqCredentialsTrusted({
      currentUsername: user,
      reachable: opts?.reachable,
    }),
    reachable: opts?.reachable,
  };
}

async function verifyHeal(
  ctx: OnuVerifyHealCtx,
): Promise<OnuModelProvisionResult> {
  return ensureGenericServiceWan(ctx, 'huawei_hgu');
}

export const genericHuaweiDriver: OnuDriver = {
  id: 'generic-huawei',
  brand: 'huawei',
  omciPlan: { serviceWanOmci: 'skip' },
  skipOmciServiceWan: true,
  paramOwners: ACS_HGU_PARAM_OWNERS,
  verifyChecks: TR098_VERIFY_CHECKS,
  progressPlan: GENERIC_HUAWEI_PROGRESS_PLAN,
  supportsTr181RouteHeal: false,
  matches(ctx: OnuModelProvisionMatchCtx): boolean {
    return vendorFromSn(ctx.sn) === 'huawei';
  },
  async ensureServiceWan(
    ctx: OnuModelProvisionCtx,
  ): Promise<OnuModelProvisionResult> {
    return ensureGenericServiceWan(ctx, 'huawei_hgu');
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

export { applyGenericServiceSpv } from '../../infra/service-spv';
export { ensureWanLeaf } from '../../infra/ensure-wan-leaf';
