/**
 * Parseo DBA / T-CONT en OLT Huawei (line-profile + bind-profile).
 */

export type HuaweiTcontBind = { tcontId: number; profile: string };

/** Extrae binds T-CONT ↔ DBA desde `display ont-lineprofile …`. */
export function parseHuaweiLineProfileTconts(
  text: string,
  dbaIdToName?: Map<number, string>,
): HuaweiTcontBind[] {
  const out: HuaweiTcontBind[] = [];
  const seen = new Set<number>();
  const push = (tcontId: number, profile: string) => {
    if (!Number.isFinite(tcontId) || !profile || seen.has(tcontId)) return;
    seen.add(tcontId);
    out.push({ tcontId, profile });
  };

  for (const m of text.matchAll(
    /T-CONT\s+(\d+)\s+DBA\s+Profile-ID\s*:\s*(\d+)/gi,
  )) {
    const id = Number(m[1]);
    const dbaId = Number(m[2]);
    push(id, dbaIdToName?.get(dbaId) ?? `id:${dbaId}`);
  }
  for (const m of text.matchAll(
    /tcont\s+(\d+)\s+dba-profile-(?:id|name)\s+(\S+)/gi,
  )) {
    const id = Number(m[1]);
    const raw = (m[2] ?? '').replace(/[",;]/g, '');
    const asNum = Number(raw);
    const profile =
      Number.isFinite(asNum) && dbaIdToName?.has(asNum)
        ? dbaIdToName.get(asNum)!
        : raw;
    push(id, profile);
  }
  return out;
}

/** Line-profile id ligado a una ONT (`display ont info`). */
export function parseHuaweiOntLineProfileId(text: string): number | null {
  const m =
    text.match(/Line\s*profile\s*ID\s*:\s*(\d+)/i) ||
    text.match(/line-profile-id\s*[:=]?\s*(\d+)/i) ||
    text.match(/Line\s*prof(?:ile)?\.?\s*ID\s*:\s*(\d+)/i);
  const n = m ? Number(m[1]) : NaN;
  return Number.isFinite(n) ? n : null;
}

/** Resultado de `tcont bind-profile` / display. */
export function parseHuaweiTcontBindProfileLines(
  text: string,
): HuaweiTcontBind[] {
  const out: HuaweiTcontBind[] = [];
  for (const m of text.matchAll(
    /(?:tcont|T-CONT)\s*[:=]?\s*(\d+)\s+.*?(?:profile(?:-name)?|dba)\s*[:=]?\s*["']?([^\s"',]+)/gi,
  )) {
    const tcontId = Number(m[1]);
    const profile = (m[2] ?? '').replace(/[",;]/g, '');
    if (!Number.isFinite(tcontId) || !profile) continue;
    out.push({ tcontId, profile });
  }
  return out;
}
