const SECRET_KEY =
  /pass(word)?|secret|token|credential|community/i;

const MAX_STRING = 240;
const MAX_KEYS = 12;

/** Recorta detail de auditoría: sin secretos, tamaño acotado. */
export function clipAuditDetail(
  raw: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, unknown> = {};
  let n = 0;
  for (const [key, value] of Object.entries(raw)) {
    if (n >= MAX_KEYS) break;
    if (SECRET_KEY.test(key)) continue;
    n += 1;
    if (typeof value === 'string') {
      out[key] = value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      out[key] = value;
    } else if (value == null) {
      out[key] = null;
    } else {
      const s = JSON.stringify(value);
      out[key] =
        s.length > MAX_STRING ? `${s.slice(0, MAX_STRING)}…` : JSON.parse(s);
    }
  }
  return out;
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message.slice(0, MAX_STRING);
  return String(err).slice(0, MAX_STRING);
}
