import type { OnuDriver } from '../../types';
import { TR098_VERIFY_CHECKS } from '../../types';
import { FIBERHOME_HG6143D_PROGRESS_PLAN } from '../_progress-plans';
import {
  ensureFiberhomeServiceWan,
  matchesFiberhomeHg6143d,
  provisionFiberhomeHg6143d,
  resolveFiberhomeLibraryServiceWan,
} from './core';
import {
  diagnoseGapsFiberhomeHg6143d,
  verifyHealFiberhomeHg6143d,
} from './verify';

export {
  FH_HG6143D_DEFAULT_LAN_BIND,
  buildFiberhomeServiceWanParams,
  expectedFiberhomeDns,
  findFiberhomeInternetWan,
  isFiberhomeHg6143dModel,
  isFiberhomeServiceWanApplied,
  listFiberhomeWanIpConnections,
  matchesFiberhomeHg6143d,
  needsNewFiberhomeWanConnectionDevice,
  resolveFiberhomeLibraryServiceWan,
  resolveNewFiberhomeWanConnection,
  ensureFiberhomeServiceWan,
  provisionFiberhomeHg6143d,
} from './core';
export {
  diagnoseGapsFiberhomeHg6143d,
  verifyHealFiberhomeHg6143d,
} from './verify';
export {
  addLanPort,
  boundEthPortsFromWan,
  iptvBridgeName,
  isIptvBridgeWan,
  isProtectedWan,
  joinLanInterfaceList,
  parseLanInterfaceList,
  removeLanPort,
  type FhWanConn,
} from './iptv-bridge';

export const fiberhomeHg6143dHandler: OnuDriver = {
  id: 'fiberhome-hg6143d',
  brand: 'fiberhome',
  omciPlan: { serviceWanOmci: 'skip' },
  skipOmciServiceWan: true,
  verifyChecks: TR098_VERIFY_CHECKS,
  progressPlan: FIBERHOME_HG6143D_PROGRESS_PLAN,
  supportsTr181RouteHeal: false,
  matches: matchesFiberhomeHg6143d,
  ownsWanSelection: matchesFiberhomeHg6143d,
  provision: provisionFiberhomeHg6143d,
  provisionPipeline: provisionFiberhomeHg6143d,
  ensureServiceWan: ensureFiberhomeServiceWan,
  diagnoseGaps: diagnoseGapsFiberhomeHg6143d,
  verifyHeal: verifyHealFiberhomeHg6143d,
  healOne: verifyHealFiberhomeHg6143d,
  resolveServiceWan: (device) => resolveFiberhomeLibraryServiceWan(device),
};
