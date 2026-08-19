/**
 * Dueños de parámetros por modelo (Etapa 2).
 * Default desde omciPlan.serviceWanOmci para no romper callers.
 */
import type { OnuDriver, OnuParamOwners } from './types';
import { resolveOmciPlan } from './types';

/** HGU ACS-first: WAN/VLAN/NAT/bind por TR-069; mgmt+ACS URL por OMCI. */
export const ACS_HGU_PARAM_OWNERS: OnuParamOwners = {
  serviceWan: 'acs',
  serviceVlan: 'acs',
  mgmtIp: 'omci',
  acsUrl: 'omci',
  tcont: 'olt_dba',
  nat: 'acs',
  lanBind: 'acs',
};

/** Bridge OMCI-first (ZTE clásico): VLAN/WAN OMCI; ACS no inventa VLAN. */
export const OMCI_BRIDGE_PARAM_OWNERS: OnuParamOwners = {
  serviceWan: 'omci',
  serviceVlan: 'omci',
  mgmtIp: 'omci',
  acsUrl: 'omci',
  tcont: 'olt_dba',
  nat: 'acs',
  lanBind: 'none',
};

export function defaultParamOwnersFromOmci(
  serviceWanOmci: 'skip' | 'apply',
): OnuParamOwners {
  return serviceWanOmci === 'skip'
    ? ACS_HGU_PARAM_OWNERS
    : OMCI_BRIDGE_PARAM_OWNERS;
}

export function resolveParamOwners(
  driver: OnuDriver | null | undefined,
): OnuParamOwners {
  const base = defaultParamOwnersFromOmci(
    resolveOmciPlan(driver).serviceWanOmci,
  );
  if (!driver?.paramOwners) return base;
  return { ...base, ...driver.paramOwners };
}

const RATE_LEAF_RE =
  /(?:Max)?(?:Bit)?Rate|Down(?:stream)?Max|Up(?:stream)?Max|DownRate|UpRate/i;

export function isHguRateLeaf(path: string): boolean {
  const leaf = path.split('.').pop() ?? path;
  return RATE_LEAF_RE.test(leaf);
}
