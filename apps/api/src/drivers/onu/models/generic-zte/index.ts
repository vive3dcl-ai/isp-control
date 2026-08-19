/**
 * Modelo genérico ZTE — fallback. SPV sobre WAN existente + route heal TR-181.
 */
import { vendorFromSn } from '../../infra/vendor-from-sn';
import { resolveGenericServiceWan } from '../../infra/resolve-service-wan';
import { applyGenericServiceSpv } from '../../infra/service-spv';
import { ensureGenericServiceWan } from '../../infra/ensure-generic-service-wan';
import { OMCI_BRIDGE_PARAM_OWNERS } from '../../param-owners';
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
import { DEFAULT_VERIFY_CHECKS } from '../../types';
import { GENERIC_ZTE_PROGRESS_PLAN } from '../_progress-plans';
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
  return ensureGenericServiceWan(ctx, 'zte_hgu');
}

export const genericZteDriver: OnuDriver = {
  id: 'generic-zte',
  brand: 'zte',
  omciPlan: { serviceWanOmci: 'apply' },
  skipOmciServiceWan: false,
  paramOwners: OMCI_BRIDGE_PARAM_OWNERS,
  verifyChecks: DEFAULT_VERIFY_CHECKS,
  progressPlan: GENERIC_ZTE_PROGRESS_PLAN,
  supportsTr181RouteHeal: true,
  matches(ctx: OnuModelProvisionMatchCtx): boolean {
    return vendorFromSn(ctx.sn) === 'zte';
  },
  async ensureServiceWan(
    ctx: OnuModelProvisionCtx,
  ): Promise<OnuModelProvisionResult> {
    return ensureGenericServiceWan(ctx, 'zte_hgu');
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
      owners: params.owners ?? OMCI_BRIDGE_PARAM_OWNERS,
    });
  },
};

export {
  assessServiceRoute,
  findLegacySmartOltInternetIfaces,
  listTr181DefaultRoutes,
  type ServiceRouteAssessment,
  type Tr181DefaultRoute,
  type Tr181IpIface,
} from './route';
