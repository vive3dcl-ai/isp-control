/**
 * Detecta SN en uncfg cuya ficha en Conectadas apunta a otro puerto PON
 * (o otra OLT). Puro: listUncfg / UI lo consumen sin Nest.
 */

export type PonLocationRef = {
  oltId: string;
  board?: string | null;
  port?: string | null;
  /** Inventario: gpon-onu_1/2/3:5 */
  onuIf?: string | null;
  /** Uncfg: gpon-olt_1/2/3 */
  oltIf?: string | null;
};

/** Clave estable OLT|board|port para comparar puertos PON. */
export function ponPortKey(loc: PonLocationRef): string | null {
  const olt = (loc.oltId || '').trim().toLowerCase();
  if (!olt) return null;

  const board = (loc.board || '').trim().toLowerCase();
  const port = (loc.port || '').trim().toLowerCase();
  if (board && port) return `${olt}|${board}|${port}`;

  const ifName = (loc.onuIf || loc.oltIf || '').trim().toLowerCase();
  const m = ifName.match(/_(\d+)\/(\d+)\/(\d+)/);
  if (m) {
    // gpon-olt_1/2/8 → board=2 port=8 (rack/slot/port ZTE)
    return `${olt}|${m[2]}|${m[3]}`;
  }
  return null;
}

/**
 * True si el SN aparece en uncfg en un puerto distinto al de Conectadas.
 * Misma OLT + mismo board/port → no es cambio de PON (ghost uncfg).
 */
export function isPonMoved(
  inventory: PonLocationRef,
  uncfg: PonLocationRef,
): boolean {
  const a = ponPortKey(inventory);
  const b = ponPortKey(uncfg);
  if (!a || !b) {
    // Sin clave comparable: si cambió de OLT, tratar como movida.
    const oltA = (inventory.oltId || '').trim().toLowerCase();
    const oltB = (uncfg.oltId || '').trim().toLowerCase();
    return !!oltA && !!oltB && oltA !== oltB;
  }
  return a !== b;
}
