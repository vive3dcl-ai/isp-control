import type { OnuDriver, ResolveServiceWanOpts } from '../../types';
import { TR098_VERIFY_CHECKS } from '../../types';
import { ACS_HGU_PARAM_OWNERS } from '../../param-owners';
import { HGU_VEIP_PROGRESS_PLAN } from '../_progress-plans';
import { matchesHuaweiHguVeip } from './match';
import {
  ensureHuaweiHguServiceWan,
  provisionHuaweiHguModel,
} from './provision';
import { diagnoseGapsHuaweiHgu, verifyHealHuaweiHgu } from './verify';
import { resolveHuaweiLibraryServiceWan } from './wan';

export {
  isHuaweiHguVeipModel,
  matchesHuaweiHguVeip,
} from './match';
export {
  buildHuaweiServiceWanParams,
  expectedHuaweiDns,
  findHuaweiInternetWan,
  findReusableBlankHuaweiWan,
  isServiceWanApplied,
  listHuaweiWanIpConnections,
  needsNewWanConnectionDevice,
  resolveHuaweiLibraryServiceWan,
  resolveNewWanConnection,
} from './wan';

export const huaweiHguVeipHandler: OnuDriver = {
  id: 'huawei-hgu-veip',
  brand: 'huawei',
  omciPlan: { serviceWanOmci: 'skip' },
  skipOmciServiceWan: true,
  paramOwners: ACS_HGU_PARAM_OWNERS,
  verifyChecks: TR098_VERIFY_CHECKS,
  progressPlan: HGU_VEIP_PROGRESS_PLAN,
  supportsTr181RouteHeal: false,
  matches: matchesHuaweiHguVeip,
  ownsWanSelection: matchesHuaweiHguVeip,
  provision: (ctx) => provisionHuaweiHguModel(ctx),
  provisionPipeline: (ctx) => provisionHuaweiHguModel(ctx),
  ensureServiceWan: (ctx) => ensureHuaweiHguServiceWan(ctx),
  diagnoseGaps: diagnoseGapsHuaweiHgu,
  verifyHeal: verifyHealHuaweiHgu,
  healOne: verifyHealHuaweiHgu,
  resolveServiceWan: (device, _opts: ResolveServiceWanOpts) =>
    resolveHuaweiLibraryServiceWan(device),
};
