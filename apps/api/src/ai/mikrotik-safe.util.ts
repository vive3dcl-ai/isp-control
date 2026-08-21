/** Validación de comandos MikroTik RouterOS API para tools del asistente. */

const DESTRUCTIVE_PATTERNS = [
  'reset-configuration',
  '/system/reboot',
  '/system/shutdown',
  '/file/remove',
  '/user/remove',
  '/system/reset',
  'format',
  'remove-configuration',
];

export function isMikrotikReadPath(path: string): boolean {
  const p = path.trim();
  if (!p.startsWith('/')) return false;
  const lower = p.toLowerCase();
  if (lower.includes('/print') || lower.endsWith('/print')) return true;
  if (lower.includes('/monitor') || lower.endsWith('/monitor')) return true;
  if (lower.includes('/ping')) return true;
  if (
    lower.endsWith('/resource') ||
    lower.endsWith('/identity') ||
    lower.endsWith('/health')
  ) {
    return true;
  }
  return false;
}

export function isMikrotikReadWords(words: string[]): boolean {
  if (!words.length) return false;
  const joined = words.join(' ').toLowerCase();
  if (DESTRUCTIVE_PATTERNS.some((d) => joined.includes(d))) return false;
  if (/\b(set|add|remove|delete|enable|disable)\b/.test(joined)) return false;
  return words.some((w) => {
    const lw = w.toLowerCase();
    return (
      lw.includes('/print') ||
      lw.includes('/monitor') ||
      lw.startsWith('/ping') ||
      lw.endsWith('/resource') ||
      lw.endsWith('/identity') ||
      lw.endsWith('/health')
    );
  });
}

export function isMikrotikWriteWordsAllowed(words: string[]): boolean {
  if (!words.length) return false;
  const joined = words.join(' ').toLowerCase();
  if (DESTRUCTIVE_PATTERNS.some((d) => joined.includes(d))) return false;
  if (isMikrotikReadWords(words)) return false;
  return /\b(set|add|enable|disable|move|comment)\b/.test(joined);
}

export function compactMikrotikRows(
  rows: Record<string, string>[],
  limit = 50,
): { rows: Record<string, string>[]; truncated: boolean; total: number } {
  const total = rows.length;
  if (total <= limit) return { rows, truncated: false, total };
  return { rows: rows.slice(0, limit), truncated: true, total };
}
