export type {
  ManagedOltCliClient,
  ManagedOltSnmpClient,
  OltCliDeps,
  OltDriverDeviceHint,
  OltDriverKind,
  OltSnmpDeps,
} from './types';
export { OLT_DRIVER_KINDS } from './types';
export {
  resolveOltCli,
  resolveOltDriverKind,
  resolveOltSnmp,
} from './registry';
export type * from './dto';
