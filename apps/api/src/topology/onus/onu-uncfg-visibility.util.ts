/**
 * Filtro de Huérfanas (uncfg) y limpieza de denylist.
 * Puro: listUncfg / deny / purge se prueban sin Nest ni OLT.
 */

export function onuSnKey(sn: string | null | undefined): string {
  return (sn ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export type UncfgHideReason = 'denied' | 'connected';

/**
 * Un SN uncfg no debe listarse en Huérfanas si ya está denegado o en Conectadas.
 * Así un `shutdown` no lo devuelve a Huérfanas aunque adminState no haya
 * quedado `disable`.
 */
export function uncfgHideReason(
  sn: string | null | undefined,
  opts: { deniedSn: Set<string>; connectedSn: Set<string> },
): UncfgHideReason | null {
  const key = onuSnKey(sn);
  if (!key) return null;
  if (opts.deniedSn.has(key)) return 'denied';
  if (opts.connectedSn.has(key)) return 'connected';
  return null;
}

/**
 * Solo auto-bloqueos (`manual === false`) se borran si el SN ya está en
 * Conectadas. `manual === true` o `null`/`undefined` se conservan.
 */
export function shouldPurgeDeniedAlreadyConnected(
  row: { sn: string; manual?: boolean | null },
  connectedSn: Set<string>,
): boolean {
  if (row.manual !== false) return false;
  return connectedSn.has(onuSnKey(row.sn));
}
