import { toSystemOltProfileName } from './zte-olt-speed.util';

export const FALLBACK_INTERNET_TCONT_UP = 'SMARTOLT-1000MB-UP';

/** `{TLG-plan}-UP` — mismo base que sync de perfiles a la OLT. */
export function expectedInternetTcontUp(
  speedProfileName: string | null | undefined,
): string | null {
  const base = speedProfileName
    ? toSystemOltProfileName(speedProfileName)
    : null;
  return base ? `${base}-UP` : null;
}

export function expectedInternetTrafficDown(
  speedProfileName: string | null | undefined,
): string | null {
  const base = speedProfileName
    ? toSystemOltProfileName(speedProfileName)
    : null;
  return base ? `${base}-DOWN` : null;
}

export type OnuTcontBind = { tcontId: number; profile: string };

/**
 * Parsea `show gpon remote-onu tcont <if>` / `show pon onu tcont`.
 */
export function parseOnuTcontBinds(cli: string): OnuTcontBind[] {
  const out: OnuTcontBind[] = [];
  const re =
    /tcont\s+(\d+)\s+(?:profile|name)\s+(\S+)/gi;
  for (const m of cli.matchAll(re)) {
    const tcontId = Number(m[1]);
    const profile = (m[2] ?? '').replace(/[,;]$/, '');
    if (!Number.isFinite(tcontId) || !profile) continue;
    out.push({ tcontId, profile });
  }
  const re2 = /(\d+)\s+\S+\s+(\S+-UP)\b/gi;
  if (!out.length) {
    for (const m of cli.matchAll(re2)) {
      const tcontId = Number(m[1]);
      const profile = m[2];
      if (Number.isFinite(tcontId) && profile) {
        out.push({ tcontId, profile });
      }
    }
  }
  return out;
}

export function internetTcontProfileOf(
  binds: OnuTcontBind[],
  internetTcontId = 1,
): string | null {
  return binds.find((b) => b.tcontId === internetTcontId)?.profile ?? null;
}

export function tcontProfileMatches(
  actual: string | null | undefined,
  expected: string | null | undefined,
): boolean {
  if (!expected) return false;
  if (!actual) return false;
  return actual.trim().toUpperCase() === expected.trim().toUpperCase();
}

export type OnuHealthBadge = 'ok' | 'check' | 'fail' | 'idle' | 'test';

/** CHECK = solo plan/DBA. FAIL = WAN/provision. OK = todo bien. */
export function decideOnuHealthBadge(params: {
  planOk: boolean | null;
  wanOk: boolean;
  provisionOk: boolean;
}): 'ok' | 'check' | 'fail' {
  if (!params.provisionOk || !params.wanOk) return 'fail';
  if (params.planOk === false) return 'check';
  return 'ok';
}

export function shouldSkipHealthPass(
  verifyStatus: string | null | undefined,
  force: boolean,
): boolean {
  if (force) return false;
  return ['ok', 'check', 'fail'].includes(verifyStatus ?? '');
}

/** Recheck all: migrada y sin pass cerrado posterior a la migración. */
export function needsMigratedHealthBackfill(onu: {
  migratedAt?: Date | string | null;
  verifyStatus?: string | null;
  verifyCheckedAt?: Date | string | null;
}): boolean {
  if (!onu.migratedAt) return false;
  const migrated =
    onu.migratedAt instanceof Date
      ? onu.migratedAt.getTime()
      : new Date(onu.migratedAt).getTime();
  if (!Number.isFinite(migrated)) return false;
  const closed = ['ok', 'check', 'fail'].includes(onu.verifyStatus ?? '');
  if (!closed) return true;
  if (!onu.verifyCheckedAt) return true;
  const checked =
    onu.verifyCheckedAt instanceof Date
      ? onu.verifyCheckedAt.getTime()
      : new Date(onu.verifyCheckedAt).getTime();
  return !Number.isFinite(checked) || checked < migrated;
}

/** Perfil de velocidad: CHECK, mismatch, o aún sin leer T-CONT. */
export function needsDbaProfileCheck(opts: {
  verifyStatus?: string | null;
  planOk?: boolean | null;
  hasSpeedPlan: boolean;
}): boolean {
  if (opts.verifyStatus === 'check') return true;
  if (opts.planOk === false) return true;
  if (opts.hasSpeedPlan && opts.planOk !== true) return true;
  return false;
}
