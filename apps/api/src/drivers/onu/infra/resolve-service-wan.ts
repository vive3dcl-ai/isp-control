/**
 * Resolver de WAN de servicio genérico (TR-098 / TR-181).
 * El resolver Huawei vive en `library/huawei-hgu-veip` (sin ciclo de imports).
 */
import {
  findServiceWanConnection,
  type WanConnectionRef,
} from './wan-datamodel';
import type { ResolveServiceWanOpts } from '../types';

export function resolveGenericServiceWan(
  device: Record<string, unknown>,
  opts: ResolveServiceWanOpts,
): WanConnectionRef | null {
  return findServiceWanConnection(device, {
    mgmtIp: opts.mgmtIp,
    expectedIp: opts.expectedIp,
    expectedVlanId: opts.expectedVlanId,
  });
}
