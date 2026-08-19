/**
 * Drivers ONU: un modelo = `models/<id>/` (genéricos incluidos).
 * @see docs/onu-model-provision.md
 */
export type {
  ApplyServiceSpvParams,
  OnuBrand,
  OnuDriver,
  OnuHealGaps,
  OnuHealOneCtx,
  OnuModelProvisionCtx,
  OnuModelProvisionHandler,
  OnuModelProvisionMatchCtx,
  OnuModelProvisionResult,
  OnuModelProvisionWanPlan,
  OnuModelRebootResult,
  OnuOmciPlan,
  OnuOmciTr069Result,
  OnuProgressState,
  OnuProgressStepDef,
  OnuProgressStepPhase,
  OnuVerifyCheckId,
  OnuVerifyCheckMode,
  OnuVerifyChecksPlan,
  OnuVerifyHealCtx,
  ResolveServiceWanOpts,
} from './types';
export {
  DEFAULT_VERIFY_CHECKS,
  TR098_VERIFY_CHECKS,
  driverSkipsOmciServiceWan,
  emptyProgressState,
  mergeProgressState,
  netStepsFromVerifyChecks,
  resolveOmciPlan,
  resolveProgressPlan,
  resolveVerifyChecks,
  verifyCheckMode,
} from './types';
export {
  ONU_BRAND_GENERICS,
  ONU_GENERIC_DRIVERS,
  ONU_LIBRARY_DRIVERS,
  ONU_MODEL_DRIVERS,
  ONU_MODEL_PROVISION_HANDLERS,
  libraryOwnsWanSelection,
  resolveOnuDriver,
  resolveOnuDriverForModel,
  resolveOnuModelHandler,
  syntheticSnForVendor,
} from './registry';
export type { OnuDriverPreview } from './registry';
export {
  decideModelPrepReboot,
  MODEL_PREP_FORCE_GAP_MS,
  MODEL_PREP_MAX_REBOOTS,
  MODEL_PREP_MIN_GAP_MS,
} from './infra/reboot-cap.util';
export type { ModelPrepState, RebootDecision } from './infra/reboot-cap.util';
export { applyGenericServiceSpv } from './infra/service-spv';
export { ensureWanLeaf } from './infra/ensure-wan-leaf';
export {
  resolveServiceWanForVerify,
  shouldHealServiceRoute,
} from './infra/resolve-service-wan-for-verify';
export { genericFiberhomeDriver } from './models/generic-fiberhome';
export { genericHuaweiDriver } from './models/generic-huawei';
export { genericUnknownDriver } from './models/generic-unknown';
export { genericZteDriver } from './models/generic-zte';
export { assessServiceRoute } from './models/generic-zte';
export {
  HG8145X6_INFORM_INTERVAL_S,
  hg8145ConnreqOurs,
  hg8145HasServiceWan,
  hg8145InformOk,
  hg8145MgmtReady,
  huaweiHg8145x6Handler,
  isHuaweiHg8145x6Model,
  matchesHuaweiHg8145x6,
  pickHg8145HealStep,
  pickHg8145VerifyStep,
} from './models/huawei-hg8145x6';
export {
  buildHuaweiServiceWanParams,
  expectedHuaweiDns,
  findHuaweiInternetWan,
  findReusableBlankHuaweiWan,
  huaweiHguVeipHandler,
  isServiceWanApplied,
  listHuaweiWanIpConnections,
  matchesHuaweiHguVeip,
  needsNewWanConnectionDevice,
  resolveHuaweiLibraryServiceWan,
  resolveNewWanConnection,
} from './models/huawei-hgu-veip';
export {
  buildFiberhomeServiceWanParams,
  expectedFiberhomeDns,
  FH_HG6143D_DEFAULT_LAN_BIND,
  fiberhomeHg6143dHandler,
  findFiberhomeInternetWan,
  isFiberhomeHg6143dModel,
  isFiberhomeServiceWanApplied,
  listFiberhomeWanIpConnections,
  matchesFiberhomeHg6143d,
  needsNewFiberhomeWanConnectionDevice,
  resolveFiberhomeLibraryServiceWan,
  resolveNewFiberhomeWanConnection,
} from './models/fiberhome-hg6143d';
export {
  TENDA_HG9_DEFAULT_LAN_BIND,
  buildTendaServiceWanParams,
  findTendaServiceWan,
  isTendaHg9Model,
  isTendaServiceWanApplied,
  isTendaSn,
  listTendaWanIpConnections,
  matchesTendaHg9,
  resolveTendaLibraryServiceWan,
  tendaHg9Handler,
} from './models/tenda-hg9';
export { resolveAcsModelFromDevice } from './infra/resolve-acs-model';
export { vendorFromSn } from './infra/vendor-from-sn';
export {
  buildConnReqParameterValues,
  CONN_REQ_INFORM_INTERVAL_S,
  CONN_REQ_USERNAME,
  connReqCredentials,
  connReqPassword,
  detectDataModelRoot,
  shouldShortenInformInterval,
  shouldWriteConnReqCredentials,
  connreqCredentialsTrusted,
} from './infra/connreq-credentials';
export {
  factoryConnReqCandidates,
  requestCpeConnection,
} from './infra/connreq-kick';
export type { ConnectionRequestResult } from './infra/connreq-kick';
