/**
 * Criterio y ventanas del chequeo silencioso post-aprovisionamiento.
 *
 * Tras apply/migrate: cada 3 minutos durante 15 minutos. Si todo cuadra, ok y
 * se para. Si al cerrar la ventana fallan checks required del modelo → fail.
 */

import type {
  OnuVerifyCheckId,
  OnuVerifyCheckMode,
} from '../../drivers/onu/types';

export const VERIFY_INTERVAL_MS = 3 * 60_000;
export const VERIFY_WINDOW_MS = 15 * 60_000;
export const VERIFY_HEAL_MAX_ATTEMPTS = 3;
/** Un tenant no puede ocupar más de cinco verificadores simultáneos. */
export const VERIFY_MAX_CONCURRENCY_PER_TENANT = 5;
/** Defensa adicional cuando hay muchos tenants activos al mismo tiempo. */
export const VERIFY_MAX_GLOBAL_CONCURRENCY = 40;

/**
 * Resync forzado: intentos de despertar la ONU hasta que el ACS consiga
 * connection_request (credenciales nuestras + kick con las heredadas).
 * 10 × 15 s ≈ 2,5 min; si el Inform periódico cae en esa ventana, se aprovecha.
 */
export const RESYNC_WAKE_MAX_ATTEMPTS = 10;
export const RESYNC_WAKE_DELAY_MS = 15_000;

export type OnuVerifyStatus = 'idle' | 'test' | 'ok' | 'fail' | 'check';

export type OnuVerifyCheckResult = {
  ok: boolean;
  message: string;
  /** Datos útiles para el siguiente tick (bytes, mac, etc.). */
  meta?: Record<string, unknown>;
};

export type OnuVerifyDetail = {
  arp?: OnuVerifyCheckResult;
  connreq?: OnuVerifyCheckResult;
  wan?: OnuVerifyCheckResult;
  dns?: OnuVerifyCheckResult;
  /**
   * Ruta por defecto / WAN legacy (TR-181). Detalles antiguos sin esta clave
   * no tumban el veredicto.
   */
  route?: OnuVerifyCheckResult;
  /** VLAN WAN etiquetada en al menos un uplink de la OLT. */
  uplinkVlan?: OnuVerifyCheckResult;
  /** LAN/Wi‑Fi ligados a la WAN de internet (hoja ACS del vendor). */
  lanBind?: OnuVerifyCheckResult;
  traffic?: OnuVerifyCheckResult;
  /** DBA T-CONT internet vs plan CRM. */
  plan?: OnuVerifyCheckResult;
  /** Notas de curación aplicadas en este tick. */
  healed?: string[];
  /**
   * Estado del aprovisionamiento por modelo (tope anti-bucle de reinicio). Lo
   * escribe el handler vía el servicio TR-069 y debe sobrevivir a los ticks del
   * verificador, que reescriben el resto de `verify_detail`.
   */
  modelPrep?: {
    reboots?: number;
    lastRebootAt?: string;
    preloadedAt?: string;
  };
  /** Avance del script del modelo (modal de provision). */
  progress?: {
    currentStepId: string | null;
    completed: string[];
    notes: string[];
    history?: Array<{
      id: string;
      status: 'done' | 'error' | 'skipped';
      note?: string;
      at: string;
    }>;
    updatedAt: string;
  };
};

/** ¿Hay que volver a chequear esta ONU ahora? */
export function shouldRunVerifyTick(params: {
  status: string | null | undefined;
  checkedAt: Date | string | null | undefined;
  now?: Date;
  intervalMs?: number;
}): boolean {
  if ((params.status ?? '') !== 'test') return false;
  const now = params.now ?? new Date();
  const interval = params.intervalMs ?? VERIFY_INTERVAL_MS;
  if (!params.checkedAt) return true;
  const checked =
    params.checkedAt instanceof Date
      ? params.checkedAt
      : new Date(params.checkedAt);
  if (Number.isNaN(checked.getTime())) return true;
  return now.getTime() - checked.getTime() >= interval;
}

/** ¿Se agotó la ventana de 15 minutos? */
export function isVerifyWindowExpired(params: {
  startedAt: Date | string | null | undefined;
  now?: Date;
  windowMs?: number;
}): boolean {
  if (!params.startedAt) return true;
  const now = params.now ?? new Date();
  const window = params.windowMs ?? VERIFY_WINDOW_MS;
  const started =
    params.startedAt instanceof Date
      ? params.startedAt
      : new Date(params.startedAt);
  if (Number.isNaN(started.getTime())) return true;
  return now.getTime() - started.getTime() >= window;
}

/**
 * Una escritura de curación necesita otro tick para comprobarse. Esto evita
 * marcar fail en el mismo instante en que se aplicó el tercero y último intento.
 */
export function shouldCloseVerifyWindow(params: {
  windowExpired: boolean;
  healingApplied: boolean;
}): boolean {
  return params.windowExpired && !params.healingApplied;
}

/**
 * Decide el estado final de un tick.
 *
 * - ok: checks required del modelo bien. traffic optional no bloquea (si
 *   viene ok, también cierra en ok). Con ventana agotada, essentials bastan.
 * - fail: ventana agotada y falta algo required, o error irrecuperable.
 * - test: seguir intentando.
 *
 * `checks` viene de `resolveVerifyChecks(driver)`: skip no exige, optional
 * no tumba essentials (p. ej. traffic).
 */
export function decideVerifyOutcome(params: {
  detail: OnuVerifyDetail;
  windowExpired: boolean;
  irrecoverable?: boolean;
  checks?: Record<OnuVerifyCheckId, OnuVerifyCheckMode>;
  /** false = DBA del plan no cuadra (badge check, no fail). */
  planOk?: boolean | null;
}): OnuVerifyStatus {
  if (params.irrecoverable) return 'fail';

  const checks = params.checks ?? {
    arp: 'skip',
    connreq: 'required',
    wan: 'required',
    dns: 'required',
    route: 'required',
    uplinkVlan: 'required',
    lanBind: 'required',
    traffic: 'optional',
  };

  const okIf = (id: OnuVerifyCheckId, result: OnuVerifyCheckResult | undefined): boolean => {
    const mode = checks[id] ?? 'required';
    if (mode === 'skip') return true;
    if (mode === 'optional') return true;
    // required: arp/wan/connreq exigen resultado; dns/uplink/route siguen
    // compatibles si el tick no los midió (detalle antiguo / skip parcial).
    if (!result) {
      return (
        id === 'dns' ||
        id === 'uplinkVlan' ||
        id === 'route' ||
        id === 'lanBind'
      );
    }
    return !!result.ok;
  };

  const essentials =
    okIf('arp', params.detail.arp) &&
    okIf('wan', params.detail.wan) &&
    okIf('connreq', params.detail.connreq) &&
    okIf('dns', params.detail.dns) &&
    okIf('uplinkVlan', params.detail.uplinkVlan) &&
    okIf('lanBind', params.detail.lanBind) &&
    okIf('route', params.detail.route);

  const trafficMode = checks.traffic ?? 'optional';
  const trafficOk = !!params.detail.traffic?.ok;

  // required traffic: exige ok. optional: no bloquea (acelera si ya hay evidencia).
  if (essentials && trafficMode !== 'required') {
    if (params.planOk === false) return 'check';
    return 'ok';
  }
  if (essentials && trafficOk) {
    if (params.planOk === false) return 'check';
    return 'ok';
  }
  if (essentials && params.windowExpired) {
    if (params.planOk === false) return 'check';
    return 'ok';
  }
  if (params.windowExpired) return 'fail';
  return 'test';
}

/** Resumen corto para tooltip / logs. */
export function summarizeVerifyDetail(
  detail: OnuVerifyDetail | null | undefined,
): string {
  if (!detail) return '';
  const parts: string[] = [];
  for (const key of [
    'arp',
    'connreq',
    'wan',
    'dns',
    'route',
    'uplinkVlan',
    'lanBind',
    'traffic',
    'plan',
  ] as const) {
    const c = detail[key];
    if (!c) continue;
    parts.push(`${key}: ${c.ok ? 'ok' : 'fail'} (${c.message})`);
  }
  if (detail.healed?.length) {
    parts.push(`curado: ${detail.healed.join('; ')}`);
  }
  return parts.join(' · ');
}

/**
 * ARP "incomplete" en MikroTik no prueba caída si ya hay tráfico (conexiones
 * o bytes). Evita fail opaco en Check ONU cuando internet sí funciona.
 */
export function arpSoftenedByTraffic(
  arpMessage: string | undefined,
  traffic: OnuVerifyCheckResult | undefined,
): boolean {
  if (!traffic?.ok) return false;
  const arp = (arpMessage ?? '').toLowerCase();
  const softArp =
    arp.includes('incompleta') ||
    arp.includes('incomplete') ||
    arp.includes('ausente');
  if (!softArp) return false;
  const msg = (traffic.message ?? '').toLowerCase();
  const meta = traffic.meta ?? {};
  return (
    msg.includes('conexiones') ||
    msg.includes('bytes') ||
    msg.includes('arp viva') ||
    typeof meta.connCount === 'number' ||
    meta.via === 'arp+wan' ||
    typeof meta.bytesRecv === 'number'
  );
}

/** Bytes ACS por debajo de esto suelen ser solo Inform TR-069, no navegación. */
export const INTERNET_MIN_BYTES = 80_000;
export const INTERNET_MIN_BYTE_GROWTH = 20_000;
export const INTERNET_MIN_PUBLIC_DSTS = 2;
export const INTERNET_MIN_CONNS_WITH_PUBLIC = 8;

export function extractIpv4(raw: string | null | undefined): string | null {
  const m = String(raw ?? '').match(/(\d{1,3}(?:\.\d{1,3}){3})/);
  return m ? m[1] : null;
}

/** Destino en internet pública (no RFC1918 / CGNAT / link-local / multicast). */
export function isPublicIpv4(ip: string | null | undefined): boolean {
  const parts = (ip ?? '').split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n) || n < 0 || n > 255)) {
    return false;
  }
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 169 && b === 254) return false;
  if (a === 192 && b === 168) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  return true;
}

export function countPublicDsts(dsts: string[]): number {
  const seen = new Set<string>();
  for (const raw of dsts) {
    const ip = extractIpv4(raw);
    if (ip && isPublicIpv4(ip)) seen.add(ip);
  }
  return seen.size;
}

/**
 * Navegación real: volumen WAN o destinos públicos. Un puñado de conexiones
 * al gateway / DNS local no cuenta.
 */
export function assessInternetEvidence(opts: {
  bytesRecv?: number | null;
  prevBytesRecv?: number | null;
  publicDstCount?: number | null;
  connCount?: number | null;
}): { ok: boolean; message: string; meta: Record<string, unknown> } {
  const bytes = opts.bytesRecv ?? 0;
  const prev = opts.prevBytesRecv ?? 0;
  const publicDsts = opts.publicDstCount ?? 0;
  const conns = opts.connCount ?? 0;
  const growth = bytes > 0 && prev > 0 ? bytes - prev : 0;
  const meta = { bytesRecv: bytes, publicDstCount: publicDsts, connCount: conns };

  if (publicDsts >= INTERNET_MIN_PUBLIC_DSTS) {
    return {
      ok: true,
      message: `${publicDsts} destinos en internet`,
      meta,
    };
  }
  if (publicDsts >= 1 && conns >= INTERNET_MIN_CONNS_WITH_PUBLIC) {
    return {
      ok: true,
      message: `${conns} conexiones · ${publicDsts} destino(s) público(s)`,
      meta,
    };
  }
  if (bytes >= INTERNET_MIN_BYTES) {
    return {
      ok: true,
      message: `${Math.round(bytes / 1024)} KB en la WAN`,
      meta,
    };
  }
  if (growth >= INTERNET_MIN_BYTE_GROWTH) {
    return {
      ok: true,
      message: `WAN +${Math.round(growth / 1024)} KB`,
      meta,
    };
  }

  const bits: string[] = [];
  if (conns > 0) bits.push(`${conns} conexiones`);
  if (publicDsts > 0) bits.push(`${publicDsts} destino público`);
  if (bytes > 0) bits.push(`${Math.round(bytes / 1024)} KB WAN`);
  return {
    ok: false,
    message: bits.length
      ? `sin navegación clara (${bits.join(', ')})`
      : 'sin tráfico hacia internet',
    meta,
  };
}

/** Solo checks que fallaron (para el banner de la modal). */
export function summarizeVerifyFailures(
  detail: OnuVerifyDetail | null | undefined,
  opts?: { checks?: Record<OnuVerifyCheckId, OnuVerifyCheckMode> },
): string {
  if (!detail) return '';
  const checks = opts?.checks;
  const parts: string[] = [];
  for (const key of [
    'arp',
    'connreq',
    'wan',
    'dns',
    'route',
    'uplinkVlan',
    'lanBind',
    'traffic',
    'plan',
  ] as const) {
    const c = detail[key];
    if (!c || c.ok) continue;
    if (key !== 'plan' && checks) {
      const mode = checks[key as OnuVerifyCheckId];
      if (mode === 'skip' || mode === 'optional') continue;
    }
    parts.push(`${key}: ${c.message}`);
  }
  return parts.join(' · ');
}

/**
 * Corre `worker` sobre `items` con como mucho `limit` en paralelo.
 * El resto queda en cola: al liberarse un hueco entra el siguiente.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const concurrency = Math.max(1, Math.floor(limit) || 1);
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;

  async function runOne(): Promise<void> {
    while (next < items.length) {
      const index = next;
      next += 1;
      try {
        const value = await worker(items[index], index);
        results[index] = { status: 'fulfilled', value };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
      }
    }
  }

  const runners = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => runOne(),
  );
  await Promise.all(runners);
  return results;
}
