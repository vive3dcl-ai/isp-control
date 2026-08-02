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
