/**
 * Registry OLT — elige silo real (c3xx / titan / huawei).
 */
import {
  isHuaweiOltDevice,
  isManagedOltDevice,
} from '../../topology/olts/olt.constants';
import { detectZteFwFamily } from './zte/shared/ifname';
import type {
  ManagedOltCliClient,
  ManagedOltSnmpClient,
  OltCliDeps,
  OltDriverDeviceHint,
  OltDriverKind,
  OltSnmpDeps,
} from './types';

export function resolveOltDriverKind(
  device: OltDriverDeviceHint,
): OltDriverKind | null {
  if (!isManagedOltDevice(device.type, device.subtype)) return null;
  if (isHuaweiOltDevice(device.type, device.subtype)) return 'huawei';
  const family = detectZteFwFamily({
    subtype: device.subtype,
    product: device.productName,
    softVer: device.softVer,
  });
  if (family === 'c6xx') return 'zte-titan';
  return 'zte-c3xx';
}

export function resolveOltCli(
  device: OltDriverDeviceHint,
  deps: OltCliDeps,
): ManagedOltCliClient {
  const kind = resolveOltDriverKind(device);
  if (kind === 'huawei') {
    return deps.huawei as unknown as ManagedOltCliClient;
  }
  if (kind === 'zte-titan') {
    return deps.zteTitan as unknown as ManagedOltCliClient;
  }
  return deps.zteC3xx;
}

export function resolveOltSnmp(
  device: OltDriverDeviceHint,
  deps: OltSnmpDeps,
): ManagedOltSnmpClient {
  const kind = resolveOltDriverKind(device);
  if (kind === 'huawei') {
    return deps.huawei as unknown as ManagedOltSnmpClient;
  }
  if (kind === 'zte-titan') {
    return deps.zteTitan as unknown as ManagedOltSnmpClient;
  }
  return deps.zteC3xx;
}

export type { OltDriverKind, ManagedOltCliClient, ManagedOltSnmpClient };
