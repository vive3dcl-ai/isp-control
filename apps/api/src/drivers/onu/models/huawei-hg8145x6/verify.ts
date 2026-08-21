/**
 * Heal HG8145X6: un solo paso por tick según gaps del verify.
 * Nunca re-corre el provision completo ni encola WCD+SPV juntos.
 */
import type {
  OnuHealGaps,
  OnuVerifyHealCtx,
  OnuModelProvisionResult,
  OnuProgressStepDef,
} from '../../types';
import { netStepsFromVerifyChecks, TR098_VERIFY_CHECKS } from '../../types';
import {
  ensureConnReq,
  ensureInform,
  ensureMgmtReady,
  ensureOmciTr069,
  ensureReachable,
  ensureServiceL2,
  ensureServiceSpv,
  ensureServiceWanIp,
  ensureServiceWanReset,
  ensureServiceWcd,
  findEmptyWanConnectionDevice,
  hg8145HasServiceWan,
  hg8145InformAlive,
} from './steps';
import {
  findHuaweiInternetWan,
  findReusableBlankHuaweiWan,
  listHuaweiWanIpConnections,
  needsNewWanConnectionDevice,
} from './wan';
import { huaweiInternetCarrierOk } from '../../infra/huawei-carrier';
import { findServiceWanVlanMismatch } from '../../infra/service-wan-vlan';

export type Hg8145HealStepId =
  | 'ensure_omci_tr069'
  | 'ensure_connreq'
  | 'ensure_inform'
  | 'ensure_reachable'
  | 'ensure_mgmt_ready'
  | 'ensure_service_wcd'
  | 'ensure_service_wanip'
  | 'ensure_service_wan_reset'
  | 'ensure_service_spv'
  | 'ensure_service_l2'
  | 'noop';

const ACS_STEPS: OnuProgressStepDef[] = [
  {
    id: 'ensure_omci_tr069',
    label: 'OMCI gestión + ACS (ip-host)',
    phase: 'acs',
  },
  {
    id: 'ensure_connreq',
    label: 'Credenciales de administración',
    phase: 'acs',
  },
  {
    id: 'ensure_inform',
    label: 'Inform periódico (120 s)',
    phase: 'acs',
  },
  {
    id: 'ensure_reachable',
    label: 'Despertar ONU (connection request)',
    phase: 'acs',
  },
  {
    id: 'ensure_mgmt_ready',
    label: 'WAN de gestión Connected',
    phase: 'acs',
  },
  {
    id: 'ensure_service_wan_reset',
    label: 'Recrear WAN (VLAN del panel)',
    phase: 'acs',
  },
  {
    id: 'ensure_service_wcd',
    label: 'Crear WANConnectionDevice de servicio',
    phase: 'acs',
  },
  {
    id: 'ensure_service_wanip',
    label: 'Crear WANIPConnection de servicio',
    phase: 'acs',
  },
  {
    id: 'ensure_service_spv',
    label: 'Árbol de servicio',
    phase: 'acs',
  },
  {
    id: 'ensure_service_l2',
    label: 'OLT service-port / flow (carrier)',
    phase: 'olt',
  },
];

export const HG8145X6_PROGRESS_PLAN: OnuProgressStepDef[] = [
  ...ACS_STEPS,
  ...netStepsFromVerifyChecks({
    ...TR098_VERIFY_CHECKS,
    // connreq ACS ya cubierto arriba; el net_connreq es el probe del poller
    connreq: 'required',
  }),
];

/** Pasos ACS ya cumplidos según gaps. */
export function hg8145CompletedFromGaps(gaps: OnuHealGaps): string[] {
  const done: string[] = [];
  if (gaps.informAlive === true) done.push('ensure_omci_tr069');
  if (gaps.connreqOurs === true) done.push('ensure_connreq');
  if (gaps.informOk === true) done.push('ensure_inform');
  if (gaps.reachable === true) done.push('ensure_reachable');
  if (gaps.mgmtReady === true) done.push('ensure_mgmt_ready');
  if (gaps.hasServiceWan === true) {
    done.push('ensure_service_wcd', 'ensure_service_wanip');
  }
  if (gaps.serviceWanOk === true) done.push('ensure_service_spv');
  if (gaps.serviceCarrierOk === true) done.push('ensure_service_l2');
  return done;
}

/**
 * Elige el siguiente paso a partir de gaps. Exportado para tests unitarios.
 */
export function pickHg8145VerifyStep(ctx: OnuVerifyHealCtx): Hg8145HealStepId {
  const g = ctx.gaps;
  const wanNeedsSpv = g.hasServiceWan === true && g.serviceWanOk === false;
  const wanMissing = g.hasServiceWan === false;
  const informAlive =
    g.informAlive ?? hg8145InformAlive(ctx.device);
  const carrierOk =
    g.serviceCarrierOk ?? huaweiInternetCarrierOk(ctx.device);

  // Agente TR-069 muerto: OMCI ip-host+ACS + reboot (cola no drena).
  if (g.reachable === false && informAlive === false) {
    return 'ensure_omci_tr069';
  }

  // Inform corto primero: sin él la cola AddObject/SPV no drena.
  if (g.informOk === false) return 'ensure_inform';

  // Sin WAN INTERNET: crear vía Inform aunque CR falle (acs fábrica).
  // ensureCredentialsFirst del poller ya reescribe la password en paralelo.
  if (wanMissing) {
    const conns = listHuaweiWanIpConnections(ctx.device);
    if (findReusableBlankHuaweiWan(conns)) return 'ensure_service_spv';
    if (findEmptyWanConnectionDevice(ctx.device)) return 'ensure_service_wanip';
    if (needsNewWanConnectionDevice(conns) || !hg8145HasServiceWan(ctx.device)) {
      return 'ensure_service_wcd';
    }
    return 'ensure_service_wanip';
  }

  // CPE etiqueta VLAN distinta a la del panel: SPV falla (9005) sin carrier.
  // Borrar WCD INTERNET y recrear con VLAN/IP del panel (nunca adoptar ACS).
  if (wanNeedsSpv || g.serviceWanOk === false) {
    if (findServiceWanVlanMismatch(ctx.device, ctx.wan.wanVlan, {
      mgmtIp: ctx.mgmtIp,
      expectedIp: ctx.wan.wanIp,
    })) {
      return 'ensure_service_wan_reset';
    }
  }

  // WAN INTERNET (VLAN panel) sin carrier L2: service-port/flow en OLT.
  // Antes que SPV (Huawei 9005 en ExternalIPAddress con ERROR_NO_CARRIER).
  if (carrierOk === false) return 'ensure_service_l2';

  // INTERNET mal: SPV vía Inform, sin quedarnos en ensure_reachable.
  if (wanNeedsSpv) return 'ensure_service_spv';

  if (g.connreqOurs === false) return 'ensure_connreq';
  if (g.reachable === false) return 'ensure_reachable';
  if (g.mgmtReady === false) return 'ensure_mgmt_ready';

  if (g.serviceWanOk === false) return 'ensure_service_spv';

  // Gaps indefinidos: inferir desde el árbol.
  if (
    g.hasServiceWan == null &&
    !findHuaweiInternetWan(listHuaweiWanIpConnections(ctx.device))
  ) {
    const conns = listHuaweiWanIpConnections(ctx.device);
    if (findEmptyWanConnectionDevice(ctx.device)) return 'ensure_service_wanip';
    if (needsNewWanConnectionDevice(conns)) return 'ensure_service_wcd';
    return 'ensure_service_spv';
  }

  return 'noop';
}

export async function verifyHealHg8145x6(
  ctx: OnuVerifyHealCtx,
): Promise<OnuModelProvisionResult> {
  const step = pickHg8145VerifyStep(ctx);
  const completed = hg8145CompletedFromGaps(ctx.gaps);
  const head = `heal huawei-hg8145x6:${step}`;
  const withProgress = (
    r: OnuModelProvisionResult,
  ): OnuModelProvisionResult => {
    const note = r.notes.filter(Boolean).join(' · ').slice(0, 240);
    const historyEntry =
      step === 'noop'
        ? []
        : [
            {
              id: step,
              status: (r.ok ? 'done' : 'error') as 'done' | 'error',
              note: note || undefined,
              at: new Date().toISOString(),
            },
          ];
    return {
      ...r,
      progress: {
        currentStepId: step === 'noop' ? null : step,
        completed: step !== 'noop' && r.ok ? [...completed, step] : completed,
        notes: r.notes,
        history: historyEntry,
      },
    };
  };

  switch (step) {
    case 'ensure_omci_tr069': {
      const r = await ensureOmciTr069(ctx, { force: false });
      return withProgress({ ok: r.ok, notes: [head, ...r.notes] });
    }
    case 'ensure_connreq': {
      const r = await ensureConnReq(ctx);
      return withProgress({ ok: r.ok, notes: [head, ...r.notes] });
    }
    case 'ensure_inform': {
      const r = await ensureInform(ctx);
      return withProgress({ ok: r.ok, notes: [head, ...r.notes] });
    }
    case 'ensure_reachable': {
      const r = await ensureReachable(ctx);
      return withProgress({ ok: r.ok, notes: [head, ...r.notes] });
    }
    case 'ensure_mgmt_ready': {
      const r = await ensureMgmtReady(ctx);
      return withProgress({ ok: r.ok, notes: [head, ...r.notes] });
    }
    case 'ensure_service_wan_reset': {
      const r = await ensureServiceWanReset(ctx);
      return withProgress({ ok: r.ok, notes: [head, ...r.notes] });
    }
    case 'ensure_service_wcd': {
      const r = await ensureServiceWcd(ctx);
      return withProgress({ ok: r.ok, notes: [head, ...r.notes] });
    }
    case 'ensure_service_wanip': {
      const r = await ensureServiceWanIp(ctx);
      return withProgress({ ok: r.ok, notes: [head, ...r.notes] });
    }
    case 'ensure_service_spv': {
      const r = await ensureServiceSpv(ctx);
      return withProgress({ ok: r.ok, notes: [head, ...r.notes] });
    }
    case 'ensure_service_l2': {
      const r = await ensureServiceL2(ctx);
      return withProgress({ ok: r.ok, notes: [head, ...r.notes] });
    }
    default:
      return withProgress({ ok: true, notes: [head, 'sin gap'] });
  }
}
