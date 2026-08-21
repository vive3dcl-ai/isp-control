/**
 * Alinear WAN de servicio a la VLAN del panel.
 *
 * Política (todos los modelos HGU ACS):
 * - Si el CPE ya tiene INTERNET/servicio en otra VLAN → cambiar (SPV) o
 *   borrar+recrear el WCD de servicio (nunca TR069/mgmt), lo que sea más
 *   rápido y fiable para ese vendor.
 * - Huawei sin carrier / Tenda (9007 al reescribir VLAN) → recreate.
 * - FiberHome / genéricos con hoja VLAN writable → preferir change (SPV).
 */
import type {
  OnuModelProvisionCtx,
  OnuModelProvisionResult,
} from '../types';
import {
  findServiceWanConnection,
  listWanCandidates,
  readWanConnectionState,
} from './wan-datamodel';
import { isManagementConnection } from './wan-connection';
import { inspectWanVlanLeaves } from './wan-vlan-leaf';
import {
  genieGet,
  strVal,
} from '../../../topology/shared/genieacs-nbi.client';
import { huaweiInternetCarrierOk } from './huawei-carrier';
import {
  classifyGenericFamily,
  type GenericPlaybookFamily,
} from './inspect-generic-playbook';

export type ServiceWanVlanMismatch = {
  conn: string;
  connDevice: string;
  currentVlan: number;
  expectedVlan: number;
};

export type WanVlanHealPrefer = 'change' | 'recreate' | 'auto';

function serviceListOf(device: Record<string, unknown>, conn: string): string {
  return (
    strVal(genieGet(device, `${conn}.X_HW_SERVICELIST`)) ??
    strVal(genieGet(device, `${conn}.X_TDTC_ServiceList`)) ??
    strVal(genieGet(device, `${conn}.X_FH_ServiceList`)) ??
    strVal(genieGet(device, `${conn}.X_CT-COM_ServiceList`)) ??
    strVal(genieGet(device, `${conn}.X_ZTE-COM_ServiceList`)) ??
    strVal(genieGet(device, `${conn}.Name`)) ??
    ''
  );
}

/**
 * WAN de servicio (INTERNET) cuya VLAN ≠ panel. Nunca TR069/mgmt.
 */
export function findServiceWanVlanMismatch(
  device: Record<string, unknown>,
  expectedVlan: number,
  opts?: { mgmtIp?: string | null; expectedIp?: string | null },
): ServiceWanVlanMismatch | null {
  if (!Number.isFinite(expectedVlan) || expectedVlan <= 0) return null;

  const candidates = listWanCandidates(device).filter(
    (c) => !isManagementConnection(c, opts?.mgmtIp),
  );
  for (const c of candidates) {
    const list = (c.serviceList ?? serviceListOf(device, c.conn)).trim();
    // Solo INTERNET / servicio de datos; no OTHER/IPTV/TR069.
    if (list && !/INTERNET/i.test(list)) continue;
    if (list && /TR.?069/i.test(list) && !/INTERNET/i.test(list)) continue;

    let vlan = c.vlanId ?? null;
    if (vlan == null) {
      const state = readWanConnectionState(device, {
        model: c.conn.startsWith('Device.') ? 'tr181' : 'tr098',
        conn: c.conn,
        connDevice: c.connDevice,
        isMgmt: false,
      });
      vlan = state.vlan;
    }
    if (vlan == null || !Number.isFinite(vlan) || vlan === expectedVlan) {
      continue;
    }
    // Si ya hay otra WAN en la VLAN panel, esta es basura → mismatch a curar.
    const hasPanel = candidates.some((x) => x.vlanId === expectedVlan);
    if (
      opts?.expectedIp &&
      c.externalIp === opts.expectedIp &&
      vlan === expectedVlan
    ) {
      continue;
    }
    // Preferir reportar INTERNET con VLAN mala; si no hay etiqueta, cualquier
    // servicio con VLAN distinta cuenta cuando no existe aún la del panel.
    if (/INTERNET/i.test(list) || !hasPanel) {
      return {
        conn: c.conn,
        connDevice: c.connDevice,
        currentVlan: vlan,
        expectedVlan,
      };
    }
  }
  return null;
}

/** ¿Hay ya una WAN de servicio en la VLAN del panel? */
export function hasServiceWanOnPanelVlan(
  device: Record<string, unknown>,
  expectedVlan: number,
  opts?: { mgmtIp?: string | null; expectedIp?: string | null },
): boolean {
  const found = findServiceWanConnection(device, {
    mgmtIp: opts?.mgmtIp,
    expectedIp: opts?.expectedIp,
    expectedVlanId: expectedVlan,
  });
  if (!found || found.isMgmt) return false;
  const state = readWanConnectionState(device, found);
  return state.vlan === expectedVlan;
}

export function preferWanVlanHealMode(opts: {
  family?: GenericPlaybookFamily | 'huawei_hg8145';
  carrierOk?: boolean | undefined;
  prefer?: WanVlanHealPrefer;
}): 'change' | 'recreate' {
  if (opts.prefer === 'change' || opts.prefer === 'recreate') {
    return opts.prefer;
  }
  const f = opts.family;
  // Huawei (9005 sin carrier) y Tenda (9007 al reescribir VLAN) → recreate.
  if (f === 'tenda' || f === 'huawei_hgu' || f === 'huawei_hg8145') {
    return 'recreate';
  }
  // FiberHome / ZTE HGU / unknown: SPV de VLAN suele ser más rápido.
  return 'change';
}

/**
 * Si hay mismatch VLAN, cura en un tick (SPV change o DeleteObject WCD).
 * Devuelve null si no hay mismatch (caller sigue con L2/SPV normal).
 */
export async function healServiceWanVlanToPanel(
  ctx: OnuModelProvisionCtx,
  opts?: {
    prefer?: WanVlanHealPrefer;
    family?: GenericPlaybookFamily | 'huawei_hg8145';
  },
): Promise<OnuModelProvisionResult | null> {
  const expected = ctx.wan.wanVlan;
  const mismatch = findServiceWanVlanMismatch(ctx.device, expected, {
    mgmtIp: ctx.mgmtIp,
    expectedIp: ctx.wan.wanIp,
  });
  if (!mismatch) return null;

  // Ya hay WAN en VLAN panel → no tocar la vieja aquí (junk disable lo hacen
  // drivers Tenda/generic en otro paso). Solo curamos si la única INTERNET
  // está mal, o si findServiceWanVlanMismatch la marcó.
  if (hasServiceWanOnPanelVlan(ctx.device, expected, { mgmtIp: ctx.mgmtIp })) {
    // INTERNET basura en otra VLAN: recreate/disable path for that WCD.
    // Still heal the mismatch WCD (delete) so SPV no la reutiliza.
  }

  const family =
    opts?.family ??
    classifyGenericFamily({
      sn: ctx.sn,
      onuType: ctx.onuType,
      acsModel: ctx.acsModel,
      device: ctx.device,
    });
  const carrierOk = huaweiInternetCarrierOk(ctx.device);
  const mode = preferWanVlanHealMode({
    family,
    carrierOk,
    prefer: opts?.prefer,
  });

  if (mode === 'change') {
    const vlanInsp = inspectWanVlanLeaves(
      ctx.device,
      mismatch.conn,
      mismatch.connDevice,
    );
    const vlanPath = vlanInsp.selected;
    if (!vlanPath) {
      // Sin hoja VLAN writable → recreate.
      return deleteServiceWanWcd(ctx, mismatch);
    }
    try {
      const reachable = await ctx.isReachable();
      const r = await ctx.client.setParameterValues(
        ctx.deviceId,
        [[vlanPath, expected, 'xsd:unsignedInt']],
        { wait: reachable },
      );
      const ok = r.status === 200 || r.status === 202;
      return {
        ok,
        notes: [
          `wan_vlan_change: ${mismatch.currentVlan} → ${expected} via ${vlanPath}${
            r.status === 202 ? ' (encolado)' : ''
          }`,
        ],
        progress: {
          currentStepId: 'ensure_service_wan_vlan',
          completed: ok ? ['ensure_service_wan_vlan'] : [],
          notes: [],
        },
      };
    } catch (e) {
      // SPV falló (9005/9007) → recreate.
      const del = await deleteServiceWanWcd(ctx, mismatch);
      return {
        ok: del.ok,
        notes: [
          `wan_vlan_change falló: ${e instanceof Error ? e.message : String(e)}`,
          ...del.notes,
        ],
        progress: del.progress,
      };
    }
  }

  return deleteServiceWanWcd(ctx, mismatch);
}

async function deleteServiceWanWcd(
  ctx: OnuModelProvisionCtx,
  mismatch: ServiceWanVlanMismatch,
): Promise<OnuModelProvisionResult> {
  const objectName = mismatch.connDevice;
  const pending = await ctx.client.hasPendingTask(
    ctx.deviceId,
    (t) =>
      t.name === 'deleteObject' &&
      String(t.objectName ?? '').replace(/\.$/, '') === objectName,
  );
  if (pending) {
    return {
      ok: true,
      notes: [
        `wan_vlan_recreate: DeleteObject ${objectName} ya en cola (vlan ${mismatch.currentVlan} → ${mismatch.expectedVlan})`,
      ],
      progress: {
        currentStepId: 'ensure_service_wan_vlan',
        completed: [],
        notes: [],
      },
    };
  }
  try {
    const r = await ctx.client.deleteObject(ctx.deviceId, objectName);
    const ok = r.status === 200 || r.status === 202;
    return {
      ok,
      notes: [
        ok
          ? `wan_vlan_recreate: borró WCD vlan ${mismatch.currentVlan} → recrear panel vlan ${mismatch.expectedVlan}`
          : `wan_vlan_recreate: DeleteObject status ${r.status}`,
      ],
      progress: {
        currentStepId: 'ensure_service_wan_vlan',
        completed: ok ? ['ensure_service_wan_vlan'] : [],
        notes: [],
      },
    };
  } catch (e) {
    return {
      ok: false,
      notes: [
        `wan_vlan_recreate: ${e instanceof Error ? e.message : String(e)}`,
      ],
      progress: {
        currentStepId: 'ensure_service_wan_vlan',
        completed: [],
        notes: [],
      },
    };
  }
}
