/**
 * Huawei HG8145X6 / EG8145X6 — driver de modelo autocontenido.
 *
 * Provision (serie) y verifyHeal (1 paso/tick) viven en esta carpeta.
 * No importa otros modelos.
 */
import type {
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
import { ACS_HGU_PARAM_OWNERS } from '../../param-owners';
import {
  connreqCredentialsTrusted,
  detectDataModelRoot,
} from '../../infra/connreq-credentials';
import { genieGet, strVal } from '../../../../topology/shared/genieacs-nbi.client';
import {
  hg8145ConnreqOurs,
  hg8145HasServiceWan,
  hg8145InformAlive,
  hg8145InformOk,
  hg8145MgmtReady,
} from './steps';
import { matchesHuaweiHg8145x6 } from './match';
import {
  ensureHg8145x6ServiceWan,
  provisionHg8145x6,
} from './provision';
import { verifyHealHg8145x6, HG8145X6_PROGRESS_PLAN } from './verify';
import {
  isServiceWanApplied,
  resolveHuaweiLibraryServiceWan,
} from './wan';
import { huaweiInternetCarrierOk } from '../../infra/huawei-carrier';

export { HG8145X6_INFORM_INTERVAL_S, HG8145X6_INFORM_STALE_SEC } from './steps';
export {
  hg8145ConnreqOurs,
  hg8145HasServiceWan,
  hg8145InformAlive,
  hg8145InformOk,
  hg8145MgmtReady,
} from './steps';
export { isHuaweiHg8145x6Model, matchesHuaweiHg8145x6 } from './match';
export { pickHg8145VerifyStep, HG8145X6_PROGRESS_PLAN } from './verify';
/** @deprecated Use pickHg8145VerifyStep */
export { pickHg8145VerifyStep as pickHg8145HealStep } from './verify';

export function diagnoseGapsHg8145x6(
  device: Record<string, unknown>,
  wan: OnuModelProvisionWanPlan,
  opts?: { mgmtIp?: string | null; reachable?: boolean },
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
    informOk: hg8145InformOk(device),
    informAlive: hg8145InformAlive(device),
    reachable: opts?.reachable,
    mgmtReady: hg8145MgmtReady(device, opts?.mgmtIp),
    hasServiceWan: hg8145HasServiceWan(device),
    serviceWanOk: isServiceWanApplied(device, wan),
    serviceCarrierOk: huaweiInternetCarrierOk(device),
  };
}

export const huaweiHg8145x6Handler: OnuDriver = {
  id: 'huawei-hg8145x6',
  brand: 'huawei',
  omciPlan: { serviceWanOmci: 'skip' },
  skipOmciServiceWan: true,
  paramOwners: ACS_HGU_PARAM_OWNERS,
  verifyChecks: TR098_VERIFY_CHECKS,
  progressPlan: HG8145X6_PROGRESS_PLAN,
  supportsTr181RouteHeal: false,
  matches: matchesHuaweiHg8145x6,
  ownsWanSelection: matchesHuaweiHg8145x6,
  provision: (ctx) => provisionHg8145x6(ctx),
  provisionPipeline: (ctx) => provisionHg8145x6(ctx),
  ensureServiceWan: (ctx) => ensureHg8145x6ServiceWan(ctx),
  diagnoseGaps: (device, wan, opts) =>
    diagnoseGapsHg8145x6(device, wan, opts),
  verifyHeal: (ctx) => verifyHealHg8145x6(ctx),
  /** @deprecated */
  healOne: (ctx) => verifyHealHg8145x6(ctx),
  resolveServiceWan: (device, _opts: ResolveServiceWanOpts) =>
    resolveHuaweiLibraryServiceWan(device),
};
