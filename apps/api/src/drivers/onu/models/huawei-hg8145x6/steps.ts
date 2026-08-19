/**
 * Pasos ACS atómicos para HG/EG8145X6.
 *
 * Regla: como máximo una mutación ACS por paso (SPV / AddObject / refresh /
 * preload-sin-CR). Sin refreshObject(ManagementServer) en bootstrap: en campo
 * tumba la sesión (session_terminated) antes de aplicar credenciales.
 */
import {
  buildConnReqParameterValues,
  detectDataModelRoot,
  shouldWriteConnReqCredentials,
} from '../../infra/connreq-credentials';
import {
  genieChildIndices,
  genieGet,
  genieNodeExists,
  strVal,
} from '../../../../topology/shared/genieacs-nbi.client';
import type {
  OnuModelProvisionCtx,
  OnuModelProvisionResult,
} from '../../types';
import {
  buildHuaweiServiceWanParams,
  findHuaweiInternetWan,
  findReusableBlankHuaweiWan,
  isServiceWanApplied,
  listHuaweiWanIpConnections,
  needsNewWanConnectionDevice,
} from './wan';

export const HG8145X6_INFORM_INTERVAL_S = 120;
/** Si `_lastInform` es más viejo, el agente TR-069 se considera muerto. */
export const HG8145X6_INFORM_STALE_SEC = HG8145X6_INFORM_INTERVAL_S * 3;

const WAN_DEV = 'InternetGatewayDevice.WANDevice';

export type Hg8145StepResult = OnuModelProvisionResult & {
  /** true → el pipeline de provision debe parar (reboot / espera Inform). */
  halt?: boolean;
};

/** Edad de `_lastInform` en segundos; null si no hay timestamp. */
export function hg8145LastInformAgeSec(
  device: Record<string, unknown>,
): number | null {
  const raw = device._lastInform;
  let ms: number | null = null;
  if (raw instanceof Date) ms = raw.getTime();
  else if (typeof raw === 'string') {
    const t = Date.parse(raw);
    ms = Number.isFinite(t) ? t : null;
  } else if (raw && typeof raw === 'object' && '$date' in (raw as object)) {
    const t = Date.parse(String((raw as { $date: unknown }).$date));
    ms = Number.isFinite(t) ? t : null;
  }
  if (ms == null) return null;
  return Math.max(0, Math.round((Date.now() - ms) / 1000));
}

/** true si el CPE Informó hace poco (cola ACS puede drenar). */
export function hg8145InformAlive(
  device: Record<string, unknown>,
  maxAgeSec = HG8145X6_INFORM_STALE_SEC,
): boolean {
  const age = hg8145LastInformAgeSec(device);
  return age != null && age <= maxAgeSec;
}

function msBase(device: Record<string, unknown>): string {
  return `${detectDataModelRoot(device)}.ManagementServer`;
}

export function hg8145ConnreqOurs(device: Record<string, unknown>): boolean {
  const user = strVal(
    genieGet(device, `${msBase(device)}.ConnectionRequestUsername`),
  );
  return !shouldWriteConnReqCredentials(user);
}

export function hg8145InformOk(device: Record<string, unknown>): boolean {
  const path = `${msBase(device)}.PeriodicInformInterval`;
  if (!genieNodeExists(device, path)) return false;
  const raw = Number(strVal(genieGet(device, path)));
  return Number.isFinite(raw) && raw > 0 && raw <= HG8145X6_INFORM_INTERVAL_S;
}

export function hg8145MgmtReady(
  device: Record<string, unknown>,
  mgmtIp?: string | null,
): boolean {
  const conns = listHuaweiWanIpConnections(device);
  const mgmt = conns.find((c) => /TR069|VOIP|MGMT/i.test(c.serviceList ?? ''));
  if (mgmt) {
    if (!/Connected/i.test(mgmt.status ?? '')) return false;
    const ip = (mgmt.externalIp ?? '').trim();
    if (!ip || ip === '0.0.0.0') return false;
    if (mgmtIp?.trim() && ip !== mgmtIp.trim()) return false;
    return true;
  }
  // Migradas / árbol incompleto: sin X_HW_SERVICELIST pero con la IP de gestión.
  const want = mgmtIp?.trim();
  if (!want) return false;
  const byIp = conns.find((c) => (c.externalIp ?? '').trim() === want);
  return !!byIp;
}

export function hg8145HasServiceWan(device: Record<string, unknown>): boolean {
  return !!findHuaweiInternetWan(listHuaweiWanIpConnections(device));
}

/** WCD sin WANIPConnection numerada (hueco para AddObject WANIP). */
export function findEmptyWanConnectionDevice(
  device: Record<string, unknown>,
): string | null {
  const wcdBase = `${WAN_DEV}.1.WANConnectionDevice`;
  for (const cd of genieChildIndices(device, wcdBase)) {
    const connDevice = `${wcdBase}.${cd}`;
    const ips = genieChildIndices(device, `${connDevice}.WANIPConnection`);
    if (!ips.length) return connDevice;
  }
  return null;
}

/** Preload SPV-only (creds + inform 120) sin refreshObject ni CR. */
export async function preloadConnReqSpvOnly(
  ctx: OnuModelProvisionCtx,
): Promise<string> {
  const root = detectDataModelRoot(ctx.device);
  const base = `${root}.ManagementServer`;
  const params: Array<[string, string | number | boolean, string]> = [
    ...buildConnReqParameterValues(ctx.sn, root),
    [`${base}.PeriodicInformEnable`, true, 'xsd:boolean'],
    [
      `${base}.PeriodicInformInterval`,
      HG8145X6_INFORM_INTERVAL_S,
      'xsd:unsignedInt',
    ],
  ];
  const r = await ctx.client.enqueueTask(
    ctx.deviceId,
    {
      name: 'setParameterValues',
      parameterValues: params.map(([p, v, t]) => [p, v, t]),
    },
    { connectionRequest: false, timeoutMs: 60_000 },
  );
  return r.status === 200 || r.status === 202
    ? `preload connreq+inform ${HG8145X6_INFORM_INTERVAL_S}s (status ${r.status})`
    : `preload connreq status ${r.status}`;
}

export async function ensureConnReq(
  ctx: OnuModelProvisionCtx,
): Promise<Hg8145StepResult> {
  const notes: string[] = [];
  // Username `acs` también es el de fábrica Huawei: solo omitimos rewrite
  // si el probe de CR ya autentica con nuestra password.
  if (hg8145ConnreqOurs(ctx.device)) {
    const reachable = await ctx.isReachable();
    if (reachable) {
      return { ok: true, notes: ['ensure_connreq: ya nuestras y CR ok'] };
    }
    notes.push(
      'ensure_connreq: username acs pero CR falló → reescribir password (fábrica/migrada)',
    );
  }

  const base = msBase(ctx.device);
  const usernamePath = `${base}.ConnectionRequestUsername`;
  const reachable = await ctx.isReachable();
  const leafExists = genieNodeExists(ctx.device, usernamePath);

  // Bootstrap sin hojas MS: no refreshObject (session_terminated). SPV-only + reboot.
  if (!leafExists && !reachable) {
    notes.push(await preloadConnReqSpvOnly(ctx));
    const rb = await ctx.reboot({ force: ctx.explicit });
    notes.push(rb.note);
    return {
      ok: rb.ok || !!rb.skipped,
      notes: ['ensure_connreq', ...notes],
      halt: true,
    };
  }

  try {
    const params = buildConnReqParameterValues(
      ctx.sn,
      detectDataModelRoot(ctx.device),
    );
    if (reachable || leafExists) {
      const r = await ctx.client.setParameterValues(ctx.deviceId, params, {
        wait: reachable,
      });
      notes.push(
        r.status === 200
          ? 'ensure_connreq: SPV ok'
          : `ensure_connreq: SPV status ${r.status}`,
      );
      if (r.status !== 200 && !reachable) {
        // acs de fábrica/migrada: encolar password y SEGUIR a WAN vía Inform.
        // Antes hacíamos halt aquí y nunca se creaba INTERNET (HWTC42DF94B8).
        if (hg8145ConnreqOurs(ctx.device)) {
          notes.push(
            'ensure_connreq: password encolada; continúa WAN vía Inform',
          );
          return { ok: true, notes, halt: false };
        }
        const rb = await ctx.reboot({ force: ctx.explicit });
        notes.push(rb.note);
        return { ok: true, notes, halt: true };
      }
      return { ok: r.status === 200 || r.status === 202, notes };
    }
    notes.push(await preloadConnReqSpvOnly(ctx));
    const rb = await ctx.reboot({ force: ctx.explicit });
    notes.push(rb.note);
    return { ok: true, notes, halt: true };
  } catch (e) {
    return {
      ok: false,
      notes: [
        'ensure_connreq',
        ...notes,
        e instanceof Error ? e.message : String(e),
      ],
    };
  }
}

export async function ensureInform(
  ctx: OnuModelProvisionCtx,
): Promise<Hg8145StepResult> {
  if (hg8145InformOk(ctx.device)) {
    return { ok: true, notes: [`ensure_inform: ya ≤${HG8145X6_INFORM_INTERVAL_S}s`] };
  }
  const base = msBase(ctx.device);
  const path = `${base}.PeriodicInformInterval`;
  // Sin hoja aún: el preload de connreq ya manda inform; no pilear.
  // Seguimos a WAN: el mismo Inform aplicará password + intervalo + WCD.
  if (!genieNodeExists(ctx.device, path) && !hg8145ConnreqOurs(ctx.device)) {
    return {
      ok: true,
      notes: ['ensure_inform: pendiente (sin hoja MS; va con preload)'],
      halt: false,
    };
  }
  if (!genieNodeExists(ctx.device, path)) {
    // Creds nuestras pero intervalo no descubierto: un GPV ligero vía CR.
    const reachable = await ctx.isReachable();
    if (!reachable) {
      // Encolar igual (sin CR) y continuar WAN vía próximo Inform.
      try {
        const r = await ctx.client.setParameterValues(
          ctx.deviceId,
          [
            [`${base}.PeriodicInformEnable`, true, 'xsd:boolean'],
            [path, HG8145X6_INFORM_INTERVAL_S, 'xsd:unsignedInt'],
          ],
          { wait: false },
        );
        return {
          ok: r.status === 200 || r.status === 202,
          notes: [
            `ensure_inform: encolado sin hoja/CR (status ${r.status}); continúa WAN`,
          ],
          halt: false,
        };
      } catch (e) {
        return {
          ok: true,
          notes: [
            `ensure_inform: sin hoja ni CR (${e instanceof Error ? e.message : String(e)}); continúa WAN`,
          ],
          halt: false,
        };
      }
    }
    try {
      await ctx.client.getParameterValues(ctx.deviceId, [
        path,
        `${base}.PeriodicInformEnable`,
      ]);
    } catch {
      /* seguimos al SPV */
    }
  }
  try {
    const reachable = await ctx.isReachable();
    const r = await ctx.client.setParameterValues(
      ctx.deviceId,
      [
        [`${base}.PeriodicInformEnable`, true, 'xsd:boolean'],
        [path, HG8145X6_INFORM_INTERVAL_S, 'xsd:unsignedInt'],
      ],
      { wait: reachable },
    );
    // 202: encolado — no halt; WAN se encola en el mismo ciclo de Inform.
    return {
      ok: r.status === 200 || r.status === 202,
      notes: [
        r.status === 200
          ? `ensure_inform: ${HG8145X6_INFORM_INTERVAL_S}s`
          : `ensure_inform: encolado status ${r.status}; continúa WAN`,
      ],
      halt: false,
    };
  } catch (e) {
    return {
      ok: false,
      notes: [
        `ensure_inform: ${e instanceof Error ? e.message : String(e)}`,
      ],
    };
  }
}

/**
 * Si el agente TR-069 no Informa, reaplicar OMCI (ip-host + ACS) y reboot.
 * Sin esto AddObject/SPV quedan eternamente en cola.
 */
export async function ensureOmciTr069(
  ctx: OnuModelProvisionCtx,
  opts?: { force?: boolean },
): Promise<Hg8145StepResult> {
  if (!ctx.ensureOmciTr069) {
    return {
      ok: false,
      notes: ['ensure_omci_tr069: callback no cableado'],
      halt: true,
    };
  }
  const notes: string[] = [];
  try {
    const r = await ctx.ensureOmciTr069();
    notes.push(...r.notes);
    if (!r.ok) {
      return { ok: false, notes: ['ensure_omci_tr069', ...notes], halt: true };
    }
    const rb = await ctx.reboot({
      force: opts?.force ?? ctx.explicit,
    });
    notes.push(rb.note);
    return {
      ok: rb.ok || !!rb.skipped,
      notes: ['ensure_omci_tr069', ...notes],
      // Esperar próximo Inform tras reboot (OMCI + agente).
      halt: true,
    };
  } catch (e) {
    return {
      ok: false,
      notes: [
        'ensure_omci_tr069',
        e instanceof Error ? e.message : String(e),
      ],
      halt: true,
    };
  }
}

export async function ensureReachable(
  ctx: OnuModelProvisionCtx,
): Promise<Hg8145StepResult> {
  const ok = await ctx.isReachable();
  if (ok) return { ok: true, notes: ['ensure_reachable: CR ok'] };
  // CR no es bloqueante: WAN/SPV se aplican en el próximo Inform.
  return {
    ok: true,
    notes: [
      'ensure_reachable: CR pendiente (acs fábrica/401); WAN vía Inform',
    ],
    halt: false,
  };
}

export async function ensureMgmtReady(
  ctx: OnuModelProvisionCtx,
): Promise<Hg8145StepResult> {
  if (hg8145MgmtReady(ctx.device, ctx.mgmtIp)) {
    return { ok: true, notes: ['ensure_mgmt_ready: TR069 ok'] };
  }
  const reachable = await ctx.isReachable();
  if (!reachable) {
    // Árbol parcial (solo IP) o sin CR: no bloquear creación de INTERNET.
    return {
      ok: true,
      notes: [
        'ensure_mgmt_ready: sin CR; continúa WAN de servicio vía Inform',
      ],
      halt: false,
    };
  }
  const conns = listHuaweiWanIpConnections(ctx.device);
  const mgmt = conns.find((c) => /TR069|VOIP|MGMT/i.test(c.serviceList ?? ''));
  const target =
    mgmt?.connDevice ?? `${WAN_DEV}.1.WANConnectionDevice.1`;
  try {
    const r = await ctx.client.refreshObject(ctx.deviceId, target);
    const fresh = (await ctx.client.findBySerial(ctx.sn)) ?? ctx.device;
    const ready = hg8145MgmtReady(fresh, ctx.mgmtIp);
    return {
      ok: true,
      notes: [
        `ensure_mgmt_ready: refresh ${target} status ${r.status}`,
        ready
          ? 'TR069 Connected'
          : 'TR069 aún no lista; continúa WAN vía Inform',
      ],
      halt: false,
    };
  } catch (e) {
    return {
      ok: true,
      notes: [
        `ensure_mgmt_ready: ${e instanceof Error ? e.message : String(e)}; continúa WAN`,
      ],
      halt: false,
    };
  }
}

export async function ensureServiceWcd(
  ctx: OnuModelProvisionCtx,
): Promise<Hg8145StepResult> {
  let device = ctx.device;
  if (findHuaweiInternetWan(listHuaweiWanIpConnections(device))) {
    return { ok: true, notes: ['ensure_service_wcd: INTERNET ya existe'] };
  }
  if (findReusableBlankHuaweiWan(listHuaweiWanIpConnections(device))) {
    return { ok: true, notes: ['ensure_service_wcd: reutiliza WAN vacía'] };
  }
  if (findEmptyWanConnectionDevice(device)) {
    return { ok: true, notes: ['ensure_service_wcd: WCD vacío ya existe'] };
  }
  if (!needsNewWanConnectionDevice(listHuaweiWanIpConnections(device))) {
    return { ok: true, notes: ['ensure_service_wcd: no hace falta WCD nuevo'] };
  }

  const wcdBase = `${WAN_DEV}.1.WANConnectionDevice`;
  const pending = await ctx.client.hasPendingTask(
    ctx.deviceId,
    (t) =>
      t.name === 'addObject' &&
      String(t.objectName ?? '').replace(/\.$/, '') === wcdBase,
  );
  if (pending) {
    return {
      ok: true,
      notes: ['ensure_service_wcd: AddObject ya en cola (próximo Inform)'],
      halt: true,
    };
  }

  const reachable = await ctx.isReachable();
  try {
    const r = await ctx.client.addObject(ctx.deviceId, wcdBase, {
      connectionRequest: reachable,
    });
    device = (await ctx.client.findBySerial(ctx.sn)) ?? device;
    ctx.device = device;
    const applied = r.status === 200;
    const queued = r.status === 202;
    return {
      ok: applied || queued,
      notes: [
        applied
          ? 'ensure_service_wcd: WANConnectionDevice creado'
          : queued
            ? `ensure_service_wcd: AddObject encolado${
                reachable ? '' : ' (sin CR → próximo Inform)'
              }`
            : `ensure_service_wcd: AddObject status ${r.status}`,
      ],
      halt: !applied,
    };
  } catch (e) {
    return {
      ok: false,
      notes: [
        `ensure_service_wcd: ${e instanceof Error ? e.message : String(e)}`,
      ],
    };
  }
}

export async function ensureServiceWanIp(
  ctx: OnuModelProvisionCtx,
): Promise<Hg8145StepResult> {
  let device = ctx.device;
  const conns = listHuaweiWanIpConnections(device);
  if (findHuaweiInternetWan(conns)) {
    return { ok: true, notes: ['ensure_service_wanip: INTERNET ya existe'] };
  }
  if (findReusableBlankHuaweiWan(conns)) {
    return {
      ok: true,
      notes: ['ensure_service_wanip: WANIP vacía reutilizable'],
    };
  }
  const emptyWcd = findEmptyWanConnectionDevice(device);
  if (!emptyWcd) {
    return {
      ok: false,
      notes: ['ensure_service_wanip: no hay WCD vacío para WANIP'],
      halt: true,
    };
  }

  const wanIpPath = `${emptyWcd}.WANIPConnection`;
  const pending = await ctx.client.hasPendingTask(
    ctx.deviceId,
    (t) =>
      t.name === 'addObject' &&
      String(t.objectName ?? '').replace(/\.$/, '') === wanIpPath,
  );
  if (pending) {
    return {
      ok: true,
      notes: ['ensure_service_wanip: AddObject ya en cola (próximo Inform)'],
      halt: true,
    };
  }

  const reachable = await ctx.isReachable();
  try {
    const r = await ctx.client.addObject(ctx.deviceId, wanIpPath, {
      connectionRequest: reachable,
    });
    device = (await ctx.client.findBySerial(ctx.sn)) ?? device;
    ctx.device = device;
    const applied = r.status === 200;
    const queued = r.status === 202;
    return {
      ok: applied || queued,
      notes: [
        applied
          ? `ensure_service_wanip: creada bajo ${emptyWcd}`
          : queued
            ? `ensure_service_wanip: encolada bajo ${emptyWcd}${
                reachable ? '' : ' (sin CR → próximo Inform)'
              }`
            : `ensure_service_wanip: status ${r.status}`,
      ],
      halt: !applied,
    };
  } catch (e) {
    return {
      ok: false,
      notes: [
        `ensure_service_wanip: ${e instanceof Error ? e.message : String(e)}`,
      ],
    };
  }
}

export async function ensureServiceSpv(
  ctx: OnuModelProvisionCtx,
): Promise<Hg8145StepResult> {
  let device = ctx.device;
  if (isServiceWanApplied(device, ctx.wan)) {
    return { ok: true, notes: ['ensure_service_spv: ya aplicada'] };
  }
  const conns = listHuaweiWanIpConnections(device);
  const target =
    findHuaweiInternetWan(conns) ?? findReusableBlankHuaweiWan(conns);
  if (!target) {
    return {
      ok: false,
      notes: ['ensure_service_spv: sin WAN target (falta WCD/WANIP)'],
      halt: true,
    };
  }
  // Sin CR: encolar SPV para el próximo Inform (nuevas/migradas con acs fábrica).
  const reachable = await ctx.isReachable();
  try {
    const params = buildHuaweiServiceWanParams(target.conn, ctx.wan);
    const r = await ctx.client.setParameterValues(ctx.deviceId, params, {
      wait: reachable,
    });
    device = (await ctx.client.findBySerial(ctx.sn)) ?? device;
    ctx.device = device;
    const applied = r.status === 200;
    const queued = r.status === 202;
    return {
      ok: applied || queued,
      notes: [
        applied
          ? `ensure_service_spv: INTERNET ${ctx.wan.wanIp} vlan=${ctx.wan.wanVlan}`
          : queued
            ? `ensure_service_spv: encolado ${ctx.wan.wanIp} vlan=${ctx.wan.wanVlan}${
                reachable ? '' : ' (sin CR → próximo Inform)'
              }`
            : `ensure_service_spv: status ${r.status}`,
      ],
      halt: !applied && !queued,
    };
  } catch (e) {
    return {
      ok: false,
      notes: [
        `ensure_service_spv: ${e instanceof Error ? e.message : String(e)}`,
      ],
    };
  }
}
