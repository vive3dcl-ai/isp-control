/**
 * Tenda HG9 (SN TDTC… / OUI C83A35 / chip Realtek).
 *
 * Validado en TDTC353E9A98. ACS multi-WAN con VLAN propietaria en WCD.
 * OMCI `wan-ip` de servicio no aplica → skipOmci + script propio.
 */
import type { OnuDriver, ResolveServiceWanOpts } from '../../types';
import { TR098_VERIFY_CHECKS } from '../../types';
import { matchesTendaHg9 } from './match';
import {
  ensureTendaHg9ServiceWan,
  provisionTendaHg9,
} from './provision';
import {
  diagnoseGapsTendaHg9,
  TENDA_HG9_PROGRESS_PLAN,
  verifyHealTendaHg9,
} from './verify';
import { resolveTendaLibraryServiceWan } from './wan';

export {
  isTendaHg9Model,
  isTendaSn,
  matchesTendaHg9,
} from './match';
export {
  TENDA_HG9_INFORM_STALE_SEC,
  ensureTendaHg9ServiceWan,
  provisionTendaHg9,
  tendaHg9InformAlive,
} from './provision';
export {
  TENDA_HG9_PROGRESS_PLAN,
  diagnoseGapsTendaHg9,
  pickTendaHg9VerifyAction,
  verifyHealTendaHg9,
} from './verify';
export {
  TENDA_HG9_DEFAULT_LAN_BIND,
  buildTendaDisableJunkParams,
  buildTendaServiceWanParams,
  expectedTendaDns,
  findTendaJunkInternetWans,
  findTendaServiceWan,
  isTendaInternetLabel,
  isTendaServiceWanApplied,
  isTendaTr069Wan,
  listTendaWanIpConnections,
  resolveTendaLibraryServiceWan,
} from './wan';

export const tendaHg9Handler: OnuDriver = {
  id: 'tenda-hg9',
  brand: 'unknown',
  omciPlan: { serviceWanOmci: 'skip' },
  skipOmciServiceWan: true,
  verifyChecks: TR098_VERIFY_CHECKS,
  progressPlan: TENDA_HG9_PROGRESS_PLAN,
  supportsTr181RouteHeal: false,
  matches: matchesTendaHg9,
  ownsWanSelection: matchesTendaHg9,
  provision: (ctx) => provisionTendaHg9(ctx),
  provisionPipeline: (ctx) => provisionTendaHg9(ctx),
  ensureServiceWan: (ctx) => ensureTendaHg9ServiceWan(ctx),
  diagnoseGaps: (device, wan, opts) =>
    diagnoseGapsTendaHg9(device, wan, opts),
  verifyHeal: (ctx) => verifyHealTendaHg9(ctx),
  healOne: (ctx) => verifyHealTendaHg9(ctx),
  resolveServiceWan: (device, opts: ResolveServiceWanOpts = {}) =>
    resolveTendaLibraryServiceWan(device, {
      expectedIp: opts.expectedIp,
      expectedVlanId: opts.expectedVlanId,
    }),
};
