/**
 * Tope anti-bucle del reinicio que dispara el aprovisionamiento por modelo.
 *
 * El verificador automático (poller) reinicia como máximo MODEL_PREP_MAX_REBOOTS
 * veces y respeta MODEL_PREP_MIN_GAP_MS entre reinicios. Las acciones explícitas
 * (autorizar / configurar / reparar) pueden forzar, con una guarda corta
 * (MODEL_PREP_FORCE_GAP_MS) para no reiniciar dos veces por un doble clic.
 *
 * La decisión es pura para poder probarla sin OLT ni base de datos; el estado
 * vive en `onus.verify_detail.modelPrep`.
 */
export const MODEL_PREP_MAX_REBOOTS = 2;
export const MODEL_PREP_MIN_GAP_MS = 20 * 60_000;
export const MODEL_PREP_FORCE_GAP_MS = 2 * 60_000;

export type ModelPrepState = {
  reboots?: number;
  lastRebootAt?: string;
  preloadedAt?: string;
};

export type RebootDecision =
  | { allow: true }
  | { allow: false; note: string };

export function decideModelPrepReboot(
  prep: ModelPrepState,
  opts: { force: boolean; now?: number },
): RebootDecision {
  const now = opts.now ?? Date.now();
  const reboots = Number(prep.reboots ?? 0) || 0;
  const lastAt = prep.lastRebootAt ? Date.parse(prep.lastRebootAt) : 0;
  const sinceLast = lastAt ? now - lastAt : Number.POSITIVE_INFINITY;

  if (opts.force) {
    if (sinceLast < MODEL_PREP_FORCE_GAP_MS) {
      return {
        allow: false,
        note: `reinicio omitido: hace ${Math.round(sinceLast / 1000)}s del último`,
      };
    }
    return { allow: true };
  }

  if (reboots >= MODEL_PREP_MAX_REBOOTS) {
    return {
      allow: false,
      note: `reinicio omitido: tope ${reboots}/${MODEL_PREP_MAX_REBOOTS}`,
    };
  }
  if (sinceLast < MODEL_PREP_MIN_GAP_MS) {
    return {
      allow: false,
      note: `reinicio omitido: espera ${Math.ceil(
        (MODEL_PREP_MIN_GAP_MS - sinceLast) / 60_000,
      )}min`,
    };
  }
  return { allow: true };
}
