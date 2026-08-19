/**
 * Contratos del driver OLT (tres silos).
 * @see docs/drivers-migration.md
 */
import type { ZteC3xxOltClient } from './zte/c3xx/cli';
import type { ZteC3xxOltSnmpClient } from './zte/c3xx/snmp';
import type { ZteTitanOltClient } from './zte/titan/cli';
import type { ZteTitanOltSnmpClient } from './zte/titan/snmp';
import type { HuaweiOltClient } from './huawei/huawei-olt.client';
import type { HuaweiOltSnmpClient } from './huawei/huawei-olt-snmp.client';

export const OLT_DRIVER_KINDS = ['zte-c3xx', 'zte-titan', 'huawei'] as const;
export type OltDriverKind = (typeof OLT_DRIVER_KINDS)[number];

/**
 * Superficie CLI para orquestación. Tipado contra C3xx (misma forma que Titan);
 * Huawei se castea solo en el registry.
 */
export type ManagedOltCliClient = ZteC3xxOltClient;

export type ManagedOltSnmpClient = ZteC3xxOltSnmpClient;

export type OltCliDeps = {
  zteC3xx: ZteC3xxOltClient;
  zteTitan: ZteTitanOltClient;
  huawei: HuaweiOltClient;
};

export type OltSnmpDeps = {
  zteC3xx: ZteC3xxOltSnmpClient;
  zteTitan: ZteTitanOltSnmpClient;
  huawei: HuaweiOltSnmpClient;
};

export type OltDriverDeviceHint = {
  type?: string | null;
  subtype?: string | null;
  productName?: string | null;
  softVer?: string | null;
};
