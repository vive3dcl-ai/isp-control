/**
 * Provision Tenda HG9: apagar INTERNET fábrica (VLAN mala) + SPV en WCD
 * con X_TDTC_VLAN = servicio.
 *
 * OMCI ip-host puede pisar la IP de la WCD de servicio tras reboot →
 * siempre re-SPV IP tras despertar Inform.
 */
import type {
  OnuModelProvisionCtx,
  OnuModelProvisionResult,
} from '../../types';
import {
  buildTendaDisableJunkParams,
  buildTendaServiceWanParams,
  findTendaJunkInternetWans,
  findTendaServiceWan,
  isTendaServiceWanApplied,
  listTendaWanIpConnections,
} from './wan';

const WAN_DEV = 'InternetGatewayDevice.WANDevice';

/** Inform “vivo” para drenar cola (3× intervalo 120s). */
export const TENDA_HG9_INFORM_STALE_SEC = 360;

export function tendaHg9InformAlive(
  device: Record<string, unknown>,
): boolean {
  const raw = (device as { _lastInform?: unknown })._lastInform;
  if (!raw) return false;
  const t =
    raw instanceof Date
      ? raw.getTime()
      : typeof raw === 'string' || typeof raw === 'number'
        ? new Date(raw).getTime()
        : NaN;
  if (!Number.isFinite(t)) return false;
  return Date.now() - t <= TENDA_HG9_INFORM_STALE_SEC * 1000;
}

async function refreshWanTree(
  ctx: OnuModelProvisionCtx,
): Promise<Record<string, unknown>> {
  try {
    await ctx.client.refreshObject(ctx.deviceId, WAN_DEV);
  } catch {
    /* keep */
  }
  const fresh = await ctx.client.findBySerial(ctx.sn);
  return fresh ?? ctx.device;
}

export async function ensureTendaHg9ServiceWan(
  ctx: OnuModelProvisionCtx,
): Promise<OnuModelProvisionResult> {
  const notes: string[] = [];
  const { client, deviceId, wan } = ctx;
  let device = await refreshWanTree(ctx);

  let conns = listTendaWanIpConnections(device);
  const junk = findTendaJunkInternetWans(conns, wan.wanVlan);
  for (const j of junk) {
    const params = buildTendaDisableJunkParams(j);
    try {
      const spv = await client.setParameterValues(deviceId, params);
      notes.push(
        spv.status === 200
          ? `WCD.${j.cd} INTERNET vlan=${j.vlan} apagado`
          : `WCD.${j.cd} INTERNET vlan=${j.vlan} apagado (encolado ${spv.status})`,
      );
    } catch (e) {
      notes.push(
        `apagar WCD.${j.cd} falló: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  device = await refreshWanTree({ ...ctx, device });
  conns = listTendaWanIpConnections(device);
  const target = findTendaServiceWan(conns, {
    expectedVlan: wan.wanVlan,
    expectedIp: wan.wanIp,
  });

  if (!target) {
    return {
      ok: false,
      notes: [
        ...notes,
        `sin WCD con X_TDTC_VLAN=${wan.wanVlan} (ni candidata segura); ` +
          'no reescribir VLAN del INTERNET de fábrica (9007)',
      ],
    };
  }

  if (target.vlan != null && target.vlan !== wan.wanVlan) {
    return {
      ok: false,
      notes: [
        ...notes,
        `WCD.${target.cd} tiene X_TDTC_VLAN=${target.vlan}; ` +
          `cambiar a ${wan.wanVlan} falla en este CPE (9007). ` +
          'Hace falta una WCD ya en la VLAN de servicio.',
      ],
    };
  }

  notes.push(
    `WAN servicio WCD.${target.cd} (${target.conn.split('.').slice(-3).join('.')})`,
  );

  const params = buildTendaServiceWanParams(target, wan);
  try {
    const spv = await client.setParameterValues(deviceId, params);
    notes.push(
      spv.status === 200
        ? `SPV ${wan.wanIp} vlan=${wan.wanVlan} (X_TDTC_+NAT+bind)`
        : `SPV ${wan.wanIp} vlan=${wan.wanVlan} encolada (status ${spv.status})`,
    );
  } catch (e) {
    return {
      ok: false,
      notes: [
        ...notes,
        `SPV falló: ${e instanceof Error ? e.message : String(e)}`,
      ],
    };
  }

  return { ok: true, notes };
}

export async function provisionTendaHg9(
  ctx: OnuModelProvisionCtx,
): Promise<OnuModelProvisionResult> {
  const notes: string[] = [];

  if (isTendaServiceWanApplied(ctx.device, ctx.wan)) {
    return {
      ok: true,
      notes: [
        `WAN servicio ya en vlan=${ctx.wan.wanVlan} ip=${ctx.wan.wanIp}`,
      ],
    };
  }

  const reachable = await ctx.isReachable();
  const informAlive = tendaHg9InformAlive(ctx.device);

  // Agente muerto: OMCI TR069 + reboot (cola no drena).
  if (!reachable && !informAlive && ctx.ensureOmciTr069) {
    notes.push('Inform muerto → OMCI TR069 + reboot');
    const omci = await ctx.ensureOmciTr069();
    notes.push(...omci.notes);
    if (!omci.ok) {
      return { ok: false, notes };
    }
    const rb = await ctx.reboot({ force: ctx.explicit });
    notes.push(rb.note);
    return {
      ok: true,
      notes: [
        ...notes,
        'esperando Inform post-OMCI para aplicar SPV Tenda',
      ],
    };
  }

  if (!reachable) {
    notes.push(await ctx.preloadConnReq());
    const rb = await ctx.reboot({ force: ctx.explicit });
    notes.push(rb.note);
  }

  const tmpl = await ensureTendaHg9ServiceWan(ctx);
  return { ok: tmpl.ok, notes: [...notes, ...tmpl.notes] };
}
