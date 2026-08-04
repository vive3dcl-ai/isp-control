/**
 * Criterio y ventanas del chequeo silencioso post-aprovisionamiento.
 *
 * Tras apply/migrate: cada 3 minutos durante 15 minutos. Si todo cuadra, ok y
 * se para. Si al cerrar la ventana fallan ARP/WAN/DNS/uplink/credenciales → fail.
 */

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

export type OnuVerifyStatus = 'idle' | 'test' | 'ok' | 'fail';

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
  /** VLAN WAN etiquetada en al menos un uplink de la OLT. */
  uplinkVlan?: OnuVerifyCheckResult;
  traffic?: OnuVerifyCheckResult;
  /** Notas de curación aplicadas en este tick. */
  healed?: string[];
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
 * - ok: ARP + WAN + connreq bien, y (tráfico O se agotó la ventana con lo
 *   esencial bien — el cliente puede no tener hosts encendidos).
 * - fail: ventana agotada y falta algo esencial, o error irrecuperable.
 * - test: seguir intentando.
 */
export function decideVerifyOutcome(params: {
  detail: OnuVerifyDetail;
  windowExpired: boolean;
  irrecoverable?: boolean;
}): OnuVerifyStatus {
  if (params.irrecoverable) return 'fail';

  const arpOk = !!params.detail.arp?.ok;
  const wanOk = !!params.detail.wan?.ok;
  const credOk = !!params.detail.connreq?.ok;
  // Los detalles antiguos no tenían una entrada DNS separada. Se consideran
  // compatibles; todas las comprobaciones nuevas sí la incluyen.
  const dnsOk = params.detail.dns ? params.detail.dns.ok : true;
  // Igual con uplink: si el tick no lo midió (inventario vacío / ONU vieja)
  // no tumba el veredicto.
  const uplinkOk = params.detail.uplinkVlan
    ? params.detail.uplinkVlan.ok
    : true;
  const trafficOk = !!params.detail.traffic?.ok;
  const essentials = arpOk && wanOk && credOk && dnsOk && uplinkOk;

  if (essentials && trafficOk) return 'ok';
  if (essentials && params.windowExpired) return 'ok';
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
    'uplinkVlan',
    'traffic',
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
