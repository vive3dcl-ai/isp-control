/**
 * Verify heal HGU VEIP: un tick = ensureServiceWan (sin pasos atómicos aún).
 */
import type {
  OnuHealGaps,
  OnuModelProvisionResult,
  OnuModelProvisionWanPlan,
  OnuVerifyHealCtx,
} from '../../types';
import { ensureHuaweiServiceWan } from './provision';
import {
  findHuaweiInternetWan,
  isServiceWanApplied,
  listHuaweiWanIpConnections,
} from './wan';
import {
  connreqCredentialsTrusted,
  detectDataModelRoot,
} from '../../infra/connreq-credentials';
import { huaweiInternetCarrierOk } from '../../infra/huawei-carrier';
import { healServiceL2IfNeeded } from '../../infra/service-carrier';
import { healServiceWanVlanToPanel } from '../../infra/service-wan-vlan';
import { genieGet, strVal } from '../../../../topology/shared/genieacs-nbi.client';

export function diagnoseGapsHuaweiHgu(
  device: Record<string, unknown>,
  wan: OnuModelProvisionWanPlan,
  opts?: { mgmtIp?: string | null; reachable?: boolean },
): OnuHealGaps {
  const root = detectDataModelRoot(device);
  const user = strVal(
    genieGet(device, `${root}.ManagementServer.ConnectionRequestUsername`),
  );
  const has = !!findHuaweiInternetWan(listHuaweiWanIpConnections(device));
  return {
    connreqOurs: connreqCredentialsTrusted({
      currentUsername: user,
      reachable: opts?.reachable,
    }),
    reachable: opts?.reachable,
    hasServiceWan: has,
    serviceWanOk: isServiceWanApplied(device, wan),
    serviceCarrierOk: huaweiInternetCarrierOk(device),
  };
}

export async function verifyHealHuaweiHgu(
  ctx: OnuVerifyHealCtx,
): Promise<OnuModelProvisionResult> {
  // VLAN panel primero (change/recreate); no L2 ni SPV sobre VLAN fantasma.
  const vlanHeal = await healServiceWanVlanToPanel(ctx, {
    family: 'huawei_hgu',
  });
  if (vlanHeal) {
    return {
      ok: vlanHeal.ok,
      notes: ['verify huawei-hgu-veip', ...vlanHeal.notes],
      progress: vlanHeal.progress,
    };
  }

  if (isServiceWanApplied(ctx.device, ctx.wan)) {
    const l2 = await healServiceL2IfNeeded(ctx);
    if (l2) {
      return {
        ok: l2.ok,
        notes: ['verify huawei-hgu-veip', ...l2.notes],
        progress: l2.progress,
      };
    }
    return {
      ok: true,
      notes: [
        'verify huawei-hgu-veip',
        `WAN INTERNET ya en vlan=${ctx.wan.wanVlan} ip=${ctx.wan.wanIp}`,
      ],
      progress: {
        currentStepId: 'ensure_service_wan',
        completed: ['ensure_service_wan'],
        notes: [],
      },
    };
  }
  // WAN incompleta pero INTERNET sin carrier → L2 antes de re-SPV.
  if (findHuaweiInternetWan(listHuaweiWanIpConnections(ctx.device))) {
    const l2 = await healServiceL2IfNeeded(ctx);
    if (l2) {
      return {
        ok: l2.ok,
        notes: ['verify huawei-hgu-veip', ...l2.notes],
        progress: l2.progress,
      };
    }
  }
  const result = await ensureHuaweiServiceWan(ctx);
  return {
    ok: result.ok,
    notes: ['verify huawei-hgu-veip', ...result.notes],
    progress: {
      currentStepId: 'ensure_service_wan',
      completed: result.ok ? ['ensure_service_wan'] : [],
      notes: result.notes,
    },
  };
}
