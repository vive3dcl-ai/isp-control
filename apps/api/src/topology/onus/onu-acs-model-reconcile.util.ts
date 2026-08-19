import {
  isPlaceholderOnuModel,
  normalizeOnuModelName,
  usableOnuModelName,
} from './onu-model-catalog';

/**
 * ¿Debe `onu_type` de una ONU conectada actualizarse al ProductClass del ACS?
 * Sí cuando el actual está vacío/placeholder o difiere del ACS (p. ej. F600 vs HG6143D).
 */
export function shouldApplyAcsModelToOnuType(
  currentOnuType: string | null | undefined,
  acsProductClass: string | null | undefined,
): boolean {
  const acs = usableOnuModelName(acsProductClass);
  if (!acs) return false;
  const current = normalizeOnuModelName(currentOnuType ?? '');
  if (isPlaceholderOnuModel(current)) return true;
  return current.toLowerCase() !== acs.toLowerCase();
}
