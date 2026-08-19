import * as path from 'node:path';
import { looksCompleteRunningConfig } from '../../drivers/olt/zte/shared/zte-olt-pon.util';

export const OLT_BACKUP_KEEP = 14;

export function oltBackupRoot(): string {
  const env = process.env.OLT_BACKUP_DIR?.trim();
  return env
    ? path.resolve(env)
    : path.resolve(process.cwd(), 'data', 'olt-backups');
}

export function sanitizeBackupSegment(raw: string): string {
  const s = raw.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^\.+/, '');
  return s.slice(0, 80) || 'x';
}

export function oltBackupDir(schema: string, oltId: string): string {
  return path.join(
    oltBackupRoot(),
    sanitizeBackupSegment(schema),
    sanitizeBackupSegment(oltId),
  );
}

export function oltBackupFilePath(
  schema: string,
  oltId: string,
  fileName: string,
): string {
  const safe = path.basename(fileName).replace(/[^a-zA-Z0-9._-]+/g, '_');
  return path.join(oltBackupDir(schema, oltId), safe || 'snapshot.cfg');
}

export function looksCompleteHuaweiConfig(text: string): boolean {
  const trimmed = text?.trimEnd() ?? '';
  if (trimmed.length < 40) return false;
  if (!/(?:^|\n)\s*(?:interface|#|vlan)\b/im.test(trimmed)) return false;
  const last = trimmed.split(/\r?\n/).pop()?.trim() ?? '';
  return /^(?:return|#|[A-Za-z0-9_./()-]+(?:\([^)\n]*\))?[#>])\s*$/.test(last);
}

export function looksCompleteOltConfigDump(
  text: string,
  vendor: 'zte' | 'huawei',
): boolean {
  return vendor === 'huawei'
    ? looksCompleteHuaweiConfig(text)
    : looksCompleteRunningConfig(text);
}

export function shouldSkipOltHealWrites(technicianMode: boolean | undefined | null): boolean {
  return technicianMode === true;
}

export type ConfigLineHunk = {
  kind: 'same' | 'add' | 'del';
  text: string;
};

/** Line-oriented diff (LCS on unique lines, capped). */
export function diffConfigLines(
  a: string,
  b: string,
  maxHunks = 400,
): { added: number; removed: number; hunks: ConfigLineHunk[] } {
  const left = a.replace(/\r\n/g, '\n').split('\n');
  const right = b.replace(/\r\n/g, '\n').split('\n');
  const n = left.length;
  const m = right.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0),
  );
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] =
        left[i] === right[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const hunks: ConfigLineHunk[] = [];
  let i = 0;
  let j = 0;
  let added = 0;
  let removed = 0;
  while (i < n && j < m && hunks.length < maxHunks) {
    if (left[i] === right[j]) {
      hunks.push({ kind: 'same', text: left[i] });
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      hunks.push({ kind: 'del', text: left[i] });
      removed += 1;
      i += 1;
    } else {
      hunks.push({ kind: 'add', text: right[j] });
      added += 1;
      j += 1;
    }
  }
  while (i < n && hunks.length < maxHunks) {
    hunks.push({ kind: 'del', text: left[i] });
    removed += 1;
    i += 1;
  }
  while (j < m && hunks.length < maxHunks) {
    hunks.push({ kind: 'add', text: right[j] });
    added += 1;
    j += 1;
  }
  return { added, removed, hunks };
}
