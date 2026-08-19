import { normalizeOnuModelName } from '../../../../topology/onus/onu-model-catalog';
import type { OnuModelProvisionMatchCtx } from '../../types';

/** ProductClass / Equipment ID ACS+OLT (p. ej. HG9, HG9-1). */
const MODEL_RE = /^HG9/i;

/** Vendor ID GPON Tenda (OUI C83A35 → SN TDTC…). */
export function isTendaSn(sn: string | null | undefined): boolean {
  const p = (sn ?? '').trim().toUpperCase();
  return p.startsWith('TDTC');
}

export function isTendaHg9Model(
  onuType?: string | null,
  acsModel?: string | null,
): boolean {
  return [onuType, acsModel]
    .map((raw) => (raw?.trim() ? normalizeOnuModelName(raw) : ''))
    .filter(Boolean)
    .some((m) => MODEL_RE.test(m));
}

/**
 * Tenda HG9: SN TDTC… y modelo HG9 (ACS ProductClass / OLT Equipment ID).
 * Si el modelo aún no llegó, el prefijo TDTC basta (equipo Realtek/Tenda).
 */
export function matchesTendaHg9(ctx: OnuModelProvisionMatchCtx): boolean {
  if (!isTendaSn(ctx.sn)) return false;
  const hasModelHint = !!(ctx.onuType?.trim() || ctx.acsModel?.trim());
  if (!hasModelHint) return true;
  return isTendaHg9Model(ctx.onuType, ctx.acsModel);
}
