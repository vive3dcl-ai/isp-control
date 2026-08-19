/**
 * Selección de WAN de servicio para verify/heal — delega al driver ONU.
 */
import { resolveOnuDriver } from '../registry';
import type { WanConnectionRef } from './wan-datamodel';
import { resolveGenericServiceWan } from './resolve-service-wan';

export function resolveServiceWanForVerify(
  device: Record<string, unknown>,
  opts: {
    sn: string;
    onuType?: string | null;
    acsModel?: string | null;
    mgmtIp?: string | null;
    expectedIp?: string | null;
    expectedVlanId?: number | null;
  },
): WanConnectionRef | null {
  const driver = resolveOnuDriver({
    sn: opts.sn,
    onuType: opts.onuType,
    acsModel: opts.acsModel,
  });
  const wanOpts = {
    mgmtIp: opts.mgmtIp,
    expectedIp: opts.expectedIp,
    expectedVlanId: opts.expectedVlanId,
  };
  if (driver?.resolveServiceWan) {
    return driver.resolveServiceWan(device, wanOpts);
  }
  return resolveGenericServiceWan(device, wanOpts);
}

/** Curación de ruta SmartOLT: driver.supportsTr181RouteHeal + WAN TR-181. */
export function shouldHealServiceRoute(
  found: WanConnectionRef | null,
  opts?: { supportsTr181RouteHeal?: boolean },
): boolean {
  if (!found || found.isMgmt || found.model !== 'tr181') return false;
  if (opts?.supportsTr181RouteHeal === false) return false;
  return opts?.supportsTr181RouteHeal === true || opts?.supportsTr181RouteHeal == null;
}
