/** Convert marketing Mbps → ZTE kbps (matches SmartOLT-style profiles ≈ Mbps×1024). */
export function mbpsToKbps(mbps: number): number {
  return Math.max(64, Math.round(mbps * 1024));
}

export function kbpsToMbps(kbps: number): number {
  return Math.max(1, Math.round(kbps / 1024));
}

/** Prefix that identifies profiles managed by the system on the OLT. */
export const SYSTEM_PROFILE_PREFIX = 'TLG-';

/**
 * OLT-side base name for a system profile: `TLG-<name>` (without -UP/-DOWN).
 * Capped so `<base>-DOWN` fits within ZTE's ~32-char profile-name limit.
 */
export function toSystemOltProfileName(raw: string): string | null {
  const clean = sanitizeSpeedProfileName(raw);
  if (!clean) return null;
  const base = clean.replace(/^TLG-/i, '');
  return `${SYSTEM_PROFILE_PREFIX}${base}`
    .slice(0, 26)
    .replace(/-+$/, '');
}

export function isSystemOltProfileName(name: string): boolean {
  return /^TLG-/i.test(name.trim());
}

export function sanitizeSpeedProfileName(raw: string): string | null {
  const s = raw
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^A-Za-z0-9_-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  if (!s || /^default$/i.test(s)) return null;
  // Strip accidental -UP/-DOWN so we don't double-suffix
  return s.replace(/-(UP|DOWN)$/i, '');
}

export type RawTcontProfile = {
  name: string;
  maximumKbps: number | null;
};

export type RawTrafficProfile = {
  name: string;
  sirKbps: number | null;
  pirKbps: number | null;
};

/**
 * Parse `show gpon profile tcont` blocks:
 *   Profile name :FOO
 *    Type  FBW  ABW  MBW ...
 *    5     64   64   1005056
 */
export function parseTcontProfiles(text: string): RawTcontProfile[] {
  const out: RawTcontProfile[] = [];
  const blocks = text.split(/Profile\s+name\s*:/i).slice(1);
  for (const block of blocks) {
    const name = block.match(/^\s*(\S+)/)?.[1]?.trim();
    if (!name || /^default$/i.test(name)) continue;
    // Prefer MBW from data row (last big number on type line)
    const row = block.match(
      /^\s*[1-5]\s+(\d+)\s+(\d+)\s+(\d+)/m,
    );
    const maximumKbps = row ? Number(row[3]) : null;
    out.push({
      name,
      maximumKbps:
        maximumKbps != null && Number.isFinite(maximumKbps)
          ? maximumKbps
          : null,
    });
  }
  return out;
}

/**
 * Parse `show gpon profile traffic` blocks:
 *   Profile name  :FOO
 *     SIR(kbps)  PIR(kbps) ...
 *     1005056    1005056
 */
export function parseTrafficProfiles(text: string): RawTrafficProfile[] {
  const out: RawTrafficProfile[] = [];
  const blocks = text.split(/Profile\s+name\s*:/i).slice(1);
  for (const block of blocks) {
    const name = block.match(/^\s*(\S+)/)?.[1]?.trim();
    if (!name || /^default$/i.test(name)) continue;
    const nums = [...block.matchAll(/\b(\d{3,})\b/g)].map((m) => Number(m[1]));
    const sirKbps = nums[0] ?? null;
    const pirKbps = nums[1] ?? sirKbps;
    out.push({
      name,
      sirKbps: sirKbps != null && Number.isFinite(sirKbps) ? sirKbps : null,
      pirKbps: pirKbps != null && Number.isFinite(pirKbps) ? pirKbps : null,
    });
  }
  return out;
}

export type PairedSpeedProfile = {
  name: string;
  uploadProfile: string | null;
  downloadProfile: string | null;
  uploadMbps: number | null;
  downloadMbps: number | null;
  uploadKbps: number | null;
  downloadKbps: number | null;
};

function stripDirection(name: string): {
  base: string;
  dir: 'up' | 'down' | null;
} {
  if (/-UP$/i.test(name)) return { base: name.replace(/-UP$/i, ''), dir: 'up' };
  if (/-DOWN$/i.test(name))
    return { base: name.replace(/-DOWN$/i, ''), dir: 'down' };
  return { base: name, dir: null };
}

/** Pair tcont (-UP) + traffic (-DOWN) into logical speed profiles. */
export function pairOltSpeedProfiles(
  tconts: RawTcontProfile[],
  traffics: RawTrafficProfile[],
): PairedSpeedProfile[] {
  const map = new Map<string, PairedSpeedProfile>();

  const ensure = (base: string) => {
    let row = map.get(base);
    if (!row) {
      row = {
        name: base,
        uploadProfile: null,
        downloadProfile: null,
        uploadMbps: null,
        downloadMbps: null,
        uploadKbps: null,
        downloadKbps: null,
      };
      map.set(base, row);
    }
    return row;
  };

  for (const t of tconts) {
    const { base, dir } = stripDirection(t.name);
    const row = ensure(dir === 'up' || dir === null ? base : t.name);
    if (dir === 'down') continue; // tcont named -DOWN is unusual; keep under full name
    row.uploadProfile = t.name;
    row.uploadKbps = t.maximumKbps;
    row.uploadMbps =
      t.maximumKbps != null ? kbpsToMbps(t.maximumKbps) : null;
  }

  for (const tr of traffics) {
    const { base, dir } = stripDirection(tr.name);
    const key = dir === 'down' || dir === null ? base : tr.name;
    const row = ensure(key);
    row.downloadProfile = tr.name;
    const kbps = tr.sirKbps ?? tr.pirKbps;
    row.downloadKbps = kbps;
    row.downloadMbps = kbps != null ? kbpsToMbps(kbps) : null;
  }

  return [...map.values()].sort((a, b) => {
    const da = a.downloadMbps ?? 0;
    const db = b.downloadMbps ?? 0;
    if (da !== db) return da - db;
    return a.name.localeCompare(b.name);
  });
}
