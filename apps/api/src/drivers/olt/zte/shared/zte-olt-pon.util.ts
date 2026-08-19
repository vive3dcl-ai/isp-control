/** Parsers and types for ZTE PON port inventory (SmartOLT-style). */

import {
  parseZteOltIfParts,
  toZteCanonicalOltIf,
} from './zte-olt-firmware.util';

export type PonFamily = 'gpon' | 'epon';

export interface ZtePonPortRaw {
  rack: string;
  shelf: string;
  slot: string;
  port: string;
  ifName: string;
  boardType: string;
  ponType: PonFamily;
  adminEnabled: boolean;
  /** Link status: Up | Down (English, as SmartOLT) */
  status: 'Up' | 'Down';
  onuOnline: number;
  onuTotal: number;
  maxOnus: number;
  avgSignalDbm: number | null;
  description: string | null;
  minRangeM: number;
  maxRangeM: number;
  rogueDetectEnabled: boolean | null;
  txPowerDbm: number | null;
}

export function isPonLineCard(
  cfgType: string,
  realType: string,
): PonFamily | null {
  const t = (realType || cfgType || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (t.startsWith('ET') || t.startsWith('EF')) return 'epon';
  if (
    t.startsWith('GT') ||
    t.startsWith('XG') ||
    t.startsWith('GF') ||
    t.startsWith('CG')
  ) {
    return 'gpon';
  }
  return null;
}

export function buildOltIfName(
  family: PonFamily,
  rack: string,
  shelf: string,
  slot: string,
  port: number,
): string {
  const prefix = family === 'epon' ? 'epon-olt' : 'gpon-olt';
  // Canonical ZTE ifName: shelf/slot/port (C220 uses 0/…)
  const a = shelf || rack || '1';
  return `${prefix}_${a}/${slot}/${port}`;
}

/** Parse `show gpon onu state gpon-olt_…` footer / rows. */
export function parseOnuStateCounts(text: string): {
  online: number;
  total: number;
  hasWorking: boolean;
} {
  let online = 0;
  let total = 0;
  let hasWorking = false;

  const footer =
    text.match(/ONU\s*Number\s*:\s*(\d+)\s*\/\s*(\d+)/i) ||
    text.match(/online\s*[:=]\s*(\d+).*total\s*[:=]\s*(\d+)/i);
  if (footer) {
    online = Number(footer[1]);
    total = Number(footer[2]);
    hasWorking = online > 0;
    return { online, total, hasWorking };
  }

  for (const line of text.split(/\r?\n/)) {
    const prefixed = /gpon-onu_|epon-onu_|gpon_onu-|epon_onu-/i.test(line);
    // Sin pie de tabla y con OnuIndex sin prefijo (`1/2/4:13  enable …`) hay
    // que contar igual: dar total 0 haría creer que el puerto está vacío.
    const bare = /^\s*\d+(?:\/\d+)+:\d+(?:\s|$)/.test(line);
    if (!prefixed && !bare) continue;
    total += 1;
    if (/\bworking\b/i.test(line)) {
      online += 1;
      hasWorking = true;
    }
  }

  return { online, total, hasWorking };
}

export function parseAdminShutdown(runConfigText: string): boolean {
  const lines = runConfigText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  for (const line of lines) {
    if (/^shutdown$/i.test(line)) return false;
    if (/^no\s+shutdown$/i.test(line)) return true;
  }
  return true;
}

export function parseDescription(runConfigText: string): string | null {
  const m = runConfigText.match(/^\s*description\s+(.+)$/im);
  return m?.[1]?.trim() || null;
}

export function parseOpticalTxPower(text: string): number | null {
  const m =
    text.match(/Tx\s*Power\s*[:=]\s*(-?[\d.]+)\s*\(?\s*dbm/i) ||
    text.match(/TxPower\s*[:=]\s*(-?[\d.]+)/i);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

/** Average ONU RX from `show pon power onu-rx …` lines. */
export function parseAvgOnuRx(text: string): number | null {
  const vals: number[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (
      /index|----|onu\s*id|power\s*dbm/i.test(line) &&
      !/\d+\.\d+/.test(line)
    ) {
      continue;
    }
    const m = line.match(/(-?\d+\.\d+)\s*(?:\(dbm\))?/i);
    if (!m) continue;
    const n = Number(m[1]);
    if (Number.isFinite(n) && n > -45 && n < 5) vals.push(n);
  }
  if (!vals.length) return null;
  return (
    Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100
  );
}

export function parseOnuIdsFromState(text: string): string[] {
  const ids: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m =
      line.match(/gpon-onu_[\d/]+:(\d+)/i) ||
      line.match(/epon-onu_[\d/]+:(\d+)/i) ||
      line.match(/gpon_onu-[\d/]+:(\d+)/i) ||
      line.match(/epon_onu-[\d/]+:(\d+)/i) ||
      // `show onu state` en varias versiones imprime el OnuIndex sin prefijo:
      // `1/2/4:13   enable   enable   working   1(GPON)`.
      line.match(/^\s*\d+(?:\/\d+)+:(\d+)(?:\s|$)/) ||
      line.match(/^\s*:?(\d+)\s+(?:enable|disable)\b/i);
    if (m) ids.push(m[1]);
  }
  return [...new Set(ids)];
}

export function defaultMaxOnus(family: PonFamily): number {
  return family === 'epon' ? 64 : 128;
}

export function parseRangeFromConfig(text: string): {
  minRangeM: number;
  maxRangeM: number;
} {
  const m =
    text.match(/distance\s+(\d+)\s+(\d+)/i) ||
    text.match(/range\s+(\d+)\s+(\d+)/i);
  if (m) {
    return { minRangeM: Number(m[1]), maxRangeM: Number(m[2]) };
  }
  return { minRangeM: 0, maxRangeM: 20000 };
}

/** gpon-olt_ / gpon_olt- / epon names present in a running-config dump. */
export function extractPonOltIfNames(runningConfig: string): string[] {
  const names: string[] = [];
  for (const line of runningConfig.split(/\r?\n/)) {
    const m =
      line.match(/^\s*interface\s+((?:gpon|epon)-olt_[\d/]+)\s*$/i) ||
      line.match(/^\s*interface\s+((?:gpon|epon)_olt-[\d/]+)\s*$/i);
    if (m) names.push(toZteCanonicalOltIf(m[1]));
  }
  return [...new Set(names)];
}

/** Parse CLI or SNMP-style PON OLT ifName (C3xx gpon-olt_ / C6xx gpon_olt- / SNMP gpon_). */
export function parsePonOltIfName(ifName: string): {
  family: PonFamily;
  shelf: string;
  slot: string;
  port: string;
} | null {
  return parseZteOltIfParts(ifName);
}

/** Canonical CLI ifName used in inventory cache keys (always gpon-olt_ form). */
export function normalizePonOltIfName(ifName: string): string {
  return toZteCanonicalOltIf(ifName);
}

/**
 * Heuristic: full running-config should end on a hostname prompt line and
 * contain at least one interface. Truncated dumps (false prompt mid-stream)
 * must not overwrite inventory cache.
 */
export function looksCompleteRunningConfig(text: string): boolean {
  const trimmed = text?.trimEnd() ?? '';
  if (trimmed.length < 40) return false;
  if (!/(?:^|\n)\s*interface\s+\S+/i.test(trimmed)) return false;
  const last = trimmed.split(/\r?\n/).pop()?.trim() ?? '';
  return /^[A-Za-z0-9_./()-]+(?:\([^)\n]*\))?[#>]\s*$/.test(last);
}
