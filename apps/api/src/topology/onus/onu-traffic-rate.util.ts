/**
 * Ritmo de tráfico de una ONU a partir de contadores SNMP de octetos.
 *
 * Las muestras `rx_bps`/`tx_bps` se guardan en BYTES por segundo en todo el
 * sistema: es lo que devuelven los parsers de CLI (ZTE `Input/Output rate ...
 * Bps` y el de Huawei, que divide los bits entre 8) y lo que asume el frontend
 * al pintar (`bpsToMbps` vuelve a multiplicar por 8).
 *
 * Los contadores SNMP son octetos, así que aquí NO se multiplica por 8. Hacerlo
 * mezclaba en la misma gráfica muestras de CLI correctas con muestras SNMP
 * infladas 8x, y el resultado saltaba según qué fuente hubiera escrito la
 * última: unas veces bien y otras por las nubes.
 *
 * Además, en muchas OLT el contador XPON/IF-MIB no avanza en cada GET: un poll
 * de 3 s ve delta=0 → tasa 0 → sierra artificial. Solo emitimos tasa cuando el
 * contador se mueve (o tras un idle largo, un 0 real).
 */

/** Delta de un contador que puede haber dado la vuelta. */
export function counterDelta(prev: number, next: number): number {
  if (next >= prev) return next - prev;
  // Vuelta de 32 bits
  if (prev <= 0xffffffff && next <= 0xffffffff) {
    return next + (0xffffffff - prev) + 1;
  }
  // Vuelta de 64 bits (aproximado)
  return next;
}

/**
 * Bytes por segundo entre dos lecturas de un contador de octetos.
 * Devuelve null si la ventana no sirve o el resultado no es un número usable.
 */
export function octetsRateBytesPerSec(params: {
  prevOctets: number;
  nextOctets: number;
  seconds: number;
}): number | null {
  const { prevOctets, nextOctets, seconds } = params;
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  if (!Number.isFinite(prevOctets) || !Number.isFinite(nextOctets)) return null;
  const rate = counterDelta(prevOctets, nextOctets) / seconds;
  return Number.isFinite(rate) && rate >= 0 ? rate : null;
}

export type SnmpTrafficPrev = {
  inOctets: number;
  outOctets: number;
  atMs: number;
};

/** Tras este idle con contadores congelados, emitimos 0 (tráfico realmente parado). */
export const SNMP_TRAFFIC_IDLE_EMIT_SEC = 45;

/**
 * Decide si hay una tasa nueva a persistir a partir de dos lecturas de octetos.
 *
 * - Contadores iguales y ventana corta → no emitir (evita sierra 0/velocidad).
 * - Contadores iguales y ventana ≥ idle → emitir 0 y avanzar baseline.
 * - Contadores que avanzan → tasa = delta / dt y avanzar baseline.
 * - dt < minDtSec → no emitir ni avanzar (polls solapados).
 */
export function resolveSnmpOctetRates(params: {
  prev: SnmpTrafficPrev | undefined;
  inOctets: number;
  outOctets: number;
  atMs: number;
  minDtSec: number;
  idleEmitSec?: number;
}): {
  nextPrev: SnmpTrafficPrev;
  uploadBps: number | null;
  downloadBps: number | null;
  emit: boolean;
} {
  const idleEmitSec = params.idleEmitSec ?? SNMP_TRAFFIC_IDLE_EMIT_SEC;
  const snapshot: SnmpTrafficPrev = {
    inOctets: params.inOctets,
    outOctets: params.outOctets,
    atMs: params.atMs,
  };
  if (!params.prev) {
    return {
      nextPrev: snapshot,
      uploadBps: null,
      downloadBps: null,
      emit: false,
    };
  }
  if (!(params.atMs > params.prev.atMs)) {
    return {
      nextPrev: params.prev,
      uploadBps: null,
      downloadBps: null,
      emit: false,
    };
  }
  const dt = (params.atMs - params.prev.atMs) / 1000;
  if (dt < params.minDtSec) {
    return {
      nextPrev: params.prev,
      uploadBps: null,
      downloadBps: null,
      emit: false,
    };
  }
  const inDelta = counterDelta(params.prev.inOctets, params.inOctets);
  const outDelta = counterDelta(params.prev.outOctets, params.outOctets);
  if (inDelta === 0 && outDelta === 0) {
    if (dt < idleEmitSec) {
      // Contador SNMP stale entre polls: no pintar 0 ni resetear la ventana.
      return {
        nextPrev: params.prev,
        uploadBps: null,
        downloadBps: null,
        emit: false,
      };
    }
    return {
      nextPrev: snapshot,
      uploadBps: 0,
      downloadBps: 0,
      emit: true,
    };
  }
  const uploadBps = inDelta / dt;
  const downloadBps = outDelta / dt;
  return {
    nextPrev: snapshot,
    uploadBps: Number.isFinite(uploadBps) ? uploadBps : null,
    downloadBps: Number.isFinite(downloadBps) ? downloadBps : null,
    emit: true,
  };
}
