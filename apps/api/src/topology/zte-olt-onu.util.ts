/** Parsers for per-ONU inventory from ZTE C3xx/C6xx CLI (read-only shows). */

import { toZteCanonicalOnuIf } from './zte-olt-firmware.util';

export type OnuPhaseStatus =
  'online' | 'offline' | 'los' | 'dying_gasp' | 'other';

export interface ZteOnuStateRow {
  onuIf: string;
  rack: string;
  shelf: string;
  slot: string;
  port: string;
  onuId: string;
  adminState: string;
  omccState: string;
  phaseState: string;
  online: boolean;
  status: OnuPhaseStatus;
  ponType: 'gpon' | 'epon';
}

export interface ZteOnuBaseInfoRow {
  onuIf: string;
  name: string | null;
  onuType: string | null;
  sn: string | null;
  state: string | null;
}

export interface ZteOnuInterfaceConfig {
  onuIf: string;
  name: string | null;
  description: string | null;
  vlans: number[];
  mode: 'bridge' | 'router' | null;
  raw: string;
}

export interface ZteOnuDetailOptical {
  onuRxDbm: number | null;
  oltRxDbm: number | null;
  distanceM: number | null;
}

function parseOnuIfParts(onuIf: string): {
  rack: string;
  shelf: string;
  slot: string;
  port: string;
  onuId: string;
  ponType: 'gpon' | 'epon';
} | null {
  const m =
    onuIf.match(/^(gpon|epon)-onu_(\d+)\/(\d+)\/(\d+):(\d+)$/i) ||
    onuIf.match(/^(gpon|epon)_onu-(\d+)\/(\d+)\/(\d+):(\d+)$/i);
  if (!m) return null;
  return {
    ponType: m[1].toLowerCase() as 'gpon' | 'epon',
    shelf: m[2],
    rack: m[2],
    slot: m[3],
    port: m[4],
    onuId: m[5],
  };
}

function classifyPhase(phase: string): {
  online: boolean;
  status: OnuPhaseStatus;
} {
  const p = phase.trim().toLowerCase();
  if (p === 'working' || p === 'operation' || p.includes('working')) {
    return { online: true, status: 'online' };
  }
  if (p === 'los' || p.includes('los')) {
    return { online: false, status: 'los' };
  }
  if (p.includes('dying')) {
    return { online: false, status: 'dying_gasp' };
  }
  if (
    p === 'offline' ||
    p === 'offLine'.toLowerCase() ||
    p.includes('offline')
  ) {
    return { online: false, status: 'offline' };
  }
  return { online: false, status: 'other' };
}

/**
 * Parse `show gpon onu state` / per-port state tables.
 *
 * ZTE C3xx often prints OnuIndex as `1/2/14:12` (not `gpon-onu_1/2/14:12`).
 */
export function parseOnuStateRows(
  text: string,
  oltIfHint?: string,
): ZteOnuStateRow[] {
  const rows: ZteOnuStateRow[] = [];
  const seen = new Set<string>();
  const family: 'gpon' | 'epon' = oltIfHint?.startsWith('epon')
    ? 'epon'
    : 'gpon';

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || /^OnuIndex/i.test(line) || /^----/.test(line)) continue;
    if (/^ONU\s*Number/i.test(line)) continue;
    if (/#$/.test(line) && !/\d+:\d+/.test(line)) continue;

    let onuIf: string | null = null;
    let rest = '';

    const full = line.match(
      /^((?:gpon|epon)-onu_[\d/]+:\d+|(?:gpon|epon)_onu-[\d/]+:\d+)\s+(.*)$/i,
    );
    if (full) {
      const titan = full[1].match(/^(gpon|epon)_onu-(\d+\/\d+\/\d+:\d+)$/i);
      onuIf = titan ? `${titan[1].toLowerCase()}-onu_${titan[2]}` : full[1];
      rest = full[2];
    } else {
      // `1/2/14:12  enable  enable  working  1(GPON)`
      const short = line.match(/^(\d+\/\d+\/\d+:\d+)\s+(.*)$/);
      if (short) {
        onuIf = `${family}-onu_${short[1]}`;
        rest = short[2];
      }
    }
    if (!onuIf) continue;
    if (seen.has(onuIf.toLowerCase())) continue;

    const parts = parseOnuIfParts(onuIf);
    if (!parts) continue;

    const tokens = rest.split(/\s+/).filter(Boolean);
    if (tokens.length < 1) continue;
    const adminState = tokens[0] ?? '';
    const omccState = tokens[1] ?? '';
    const phaseToken =
      tokens.find((t) =>
        /^(working|LOS|offline|OffLine|DyingGasp|Dying|Sync|discovery|ranging)/i.test(
          t,
        ),
      ) ||
      tokens[2] ||
      tokens[tokens.length - 1] ||
      '';

    const { online, status } = classifyPhase(phaseToken);
    seen.add(onuIf.toLowerCase());
    rows.push({
      onuIf,
      rack: parts.rack,
      shelf: parts.shelf,
      slot: parts.slot,
      port: parts.port,
      onuId: parts.onuId,
      adminState,
      omccState,
      phaseState: phaseToken,
      online,
      status,
      ponType: parts.ponType,
    });
  }
  return rows;
}

/**
 * Parse `show gpon onu baseinfo gpon-olt_…`
 * OnuIndex may be `gpon-onu_1/2/1:1` or short `1/2/1:1`.
 * AuthInfo often looks like `SN:48575443AABBCCDD` (colon broke the old regex).
 */
export function parseOnuBaseInfo(
  text: string,
  oltIfHint?: string,
): ZteOnuBaseInfoRow[] {
  const rows: ZteOnuBaseInfoRow[] = [];
  const family: 'gpon' | 'epon' = oltIfHint?.startsWith('epon')
    ? 'epon'
    : 'gpon';
  const isEmptyName = (t: string) => !t || /^(--|—|-|n\/a|none|null)$/i.test(t);
  const isModel = (t: string) =>
    /^(ZTE-|ZTE|Huawei|HG|EG|F\d|ZX|HWTC|ONT)/i.test(t);
  const looksLikeSn = (cand: string) =>
    cand.length >= 12 || /^(ZTEG|HWTC|ALCL|FHTT|CMGD|4857)/i.test(cand);

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || /^OnuIndex/i.test(line) || /^----/.test(line)) continue;

    let onuIf: string | null = null;
    let restTokens: string[] = [];

    const full = line.match(
      /^((?:gpon|epon)-onu_[\d/]+:\d+|(?:gpon|epon)_onu-[\d/]+:\d+)\s+(.*)$/i,
    );
    if (full) {
      onuIf = toZteCanonicalOnuIf(full[1]);
      restTokens = full[2].trim().split(/\s+/).filter(Boolean);
    } else {
      const short = line.match(/^(\d+\/\d+\/\d+:\d+)\s+(.*)$/);
      if (short) {
        onuIf = `${family}-onu_${short[1]}`;
        restTokens = short[2].trim().split(/\s+/).filter(Boolean);
      }
    }
    if (!onuIf) continue;

    let sn: string | null = null;
    const snLabeled = line.match(/\bSN[:\s=]+([A-Z0-9]{8,20})\b/i);
    if (snLabeled) sn = snLabeled[1].toUpperCase();

    let onuType: string | null = null;
    let name: string | null = null;
    let state: string | null = null;

    for (const tok of restTokens) {
      const snTok = tok.match(/^(?:SN[:\s=]*)?([A-Z0-9]{8,20})$/i);
      if (
        !sn &&
        snTok &&
        !/^(gpon|epon|ready|enable|disable|offline|online|working|none)$/i.test(
          snTok[1],
        ) &&
        looksLikeSn(snTok[1])
      ) {
        sn = snTok[1].toUpperCase();
      }
    }

    const snIdx = sn
      ? restTokens.findIndex((t) => {
          const u = t.replace(/^SN[:\s=]*/i, '').toUpperCase();
          return u === sn;
        })
      : -1;

    if (snIdx > 0) {
      const before = restTokens
        .slice(0, snIdx)
        .filter((t) => !/^SN[:\s=]/i.test(t));
      if (before.length >= 2) {
        if (!isEmptyName(before[0]) && !isModel(before[0])) name = before[0];
        onuType = before.find((t) => isModel(t)) ?? before[before.length - 1];
      } else if (before.length === 1) {
        if (isModel(before[0])) onuType = before[0];
        else if (!isEmptyName(before[0])) name = before[0];
      }
    } else if (restTokens.length >= 1) {
      const first = restTokens[0];
      if (first && !/^(none|ready|enable|disable)$/i.test(first)) {
        if (isModel(first)) {
          onuType = first;
        } else if (!isEmptyName(first)) {
          name = first;
          if (restTokens[1] && isModel(restTokens[1])) {
            onuType = restTokens[1];
          }
        }
      }
      if (!onuType) {
        const modelTok = restTokens.find((t) => isModel(t));
        if (modelTok) onuType = modelTok;
      }
    }

    if (restTokens.length) {
      const last = restTokens[restTokens.length - 1];
      if (/^(ready|dyinggasp|offline|LOS|working)$/i.test(last)) state = last;
    }
    rows.push({ onuIf, name, onuType, sn, state });
  }
  return rows;
}

/** Parse `show pon power onu-rx gpon-olt_…` → map onuIf → dBm */
export function parseOnuRxByIf(
  text: string,
  oltIfHint?: string,
): Map<string, number> {
  const map = new Map<string, number>();
  const family: 'gpon' | 'epon' = oltIfHint?.startsWith('epon')
    ? 'epon'
    : 'gpon';
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const withIf = line.match(
      /((?:gpon|epon)-onu_[\d/]+:\d+|(?:gpon|epon)_onu-[\d/]+:\d+)\s+(-?\d+(?:\.\d+)?)\s*(?:\(?\s*dbm)?/i,
    );
    if (withIf) {
      const n = Number(withIf[2]);
      if (Number.isFinite(n) && n > -50 && n < 10) {
        map.set(toZteCanonicalOnuIf(withIf[1]), n);
      }
      continue;
    }
    // `1/2/14:12   -21.75(dbm)`
    const short = line.match(/^(\d+\/\d+\/\d+:\d+)\s+(-?\d+(?:\.\d+)?)/);
    if (short) {
      const n = Number(short[2]);
      if (Number.isFinite(n) && n > -50 && n < 10) {
        map.set(`${family}-onu_${short[1]}`, n);
      }
    }
  }
  return map;
}

export type ZteOpticalWavelengthRow = {
  wavelength: string;
  olt: string;
  onu: string;
  attenuation: string;
};

/** Optical attenuation for one ONU (summary Rx values). */
export function parseOnuAttenuation(text: string): ZteOnuDetailOptical {
  const table = parseOnuOpticalTable(text);
  let onuRxDbm: number | null = null;
  let oltRxDbm: number | null = null;

  for (const row of table) {
    if (/1310/i.test(row.wavelength)) {
      const oltRx = row.olt.match(/Rx\s*[:=]\s*(-?\d+(?:\.\d+)?)/i);
      const onuTx = row.onu.match(/Tx\s*[:=]\s*(-?\d+(?:\.\d+)?)/i);
      if (oltRx) {
        const n = Number(oltRx[1]);
        if (Number.isFinite(n)) oltRxDbm = n;
      }
      void onuTx;
    }
    if (/1490/i.test(row.wavelength)) {
      const onuRx = row.onu.match(/Rx\s*[:=]\s*(-?\d+(?:\.\d+)?)/i);
      if (onuRx) {
        const n = Number(onuRx[1]);
        if (Number.isFinite(n)) onuRxDbm = n;
      }
    }
  }

  // down … Rx:-18.210(dbm)
  if (onuRxDbm == null) {
    const downRx = text.match(/down[\s\S]*?Rx\s*[:=]\s*(-?\d+(?:\.\d+)?)/i);
    if (downRx) {
      const n = Number(downRx[1]);
      if (Number.isFinite(n)) onuRxDbm = n;
    }
  }
  // up Rx :-20.850(dbm)  (OLT receives from ONU)
  if (oltRxDbm == null) {
    const upRx = text.match(/up[\s\S]*?Rx\s*[:=]\s*(-?\d+(?:\.\d+)?)/i);
    if (upRx) {
      const n = Number(upRx[1]);
      if (Number.isFinite(n) && n > -50) oltRxDbm = n;
    }
  }
  // single-line onu-rx
  if (onuRxDbm == null) {
    const m = text.match(/(-?\d+(?:\.\d+)?)\s*\(?\s*dbm/i);
    if (m) {
      const n = Number(m[1]);
      if (Number.isFinite(n) && n > -50 && n < 10) onuRxDbm = n;
    }
  }
  return { onuRxDbm, oltRxDbm, distanceM: null };
}

/** Parse SmartOLT-style optical wavelength table from attenuation CLI. */
export function parseOnuOpticalTable(text: string): ZteOpticalWavelengthRow[] {
  const rows: ZteOpticalWavelengthRow[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(
      /^\s*(1310|1490|1550)\s*nm\s+(.+?)\s{2,}(.+?)\s{2,}(.+?)\s*$/i,
    );
    if (m) {
      rows.push({
        wavelength: `${m[1]}nm`,
        olt: m[2].trim(),
        onu: m[3].trim(),
        attenuation: m[4].trim(),
      });
      continue;
    }
    // Compact: 1310nm Rx:-25.376(dbm) Tx:2.299(dbm) 27.675(dB)
    const compact = line.match(/^\s*(1310|1490|1550)\s*nm\s+(.+)$/i);
    if (compact) {
      const rest = compact[2].trim();
      const parts = rest.split(/\s{2,}|\t+/).filter(Boolean);
      if (parts.length >= 3) {
        rows.push({
          wavelength: `${compact[1]}nm`,
          olt: parts[0],
          onu: parts[1],
          attenuation: parts[2],
        });
      }
      continue;
    }
    // ZTE up/down rows → map to 1310 (up) / 1490 (down)
    const upDown = line.match(
      /^\s*(up|down)\s+(.+?)\s{2,}(.+?)\s{2,}(.+?)\s*$/i,
    );
    if (upDown) {
      const dir = upDown[1].toLowerCase();
      rows.push({
        wavelength: dir === 'up' ? '1310nm' : '1490nm',
        olt: upDown[2].trim(),
        onu: upDown[3].trim(),
        attenuation: upDown[4].trim(),
      });
    }
  }
  return rows;
}

export type ZteOnuHistoryRow = {
  index: number;
  authpassTime: string;
  offlineTime: string;
  cause: string;
};

export type ZteOnuDetailInfoParsed = {
  sn: string | null;
  onuType: string | null;
  name: string | null;
  description: string | null;
  phaseState: string | null;
  distanceM: number | null;
  onlineDuration: string | null;
  adminState: string | null;
  vendorId: string | null;
  hwVersion: string | null;
  detectedType: string | null;
  state: string | null;
  currentChannel: string | null;
  onuStatus: string | null;
  history: ZteOnuHistoryRow[];
  fields: Array<{ label: string; value: string }>;
};

export function parseOnuDetailInfo(text: string): ZteOnuDetailInfoParsed {
  const pick = (re: RegExp) => {
    const m = text.match(re);
    return m?.[1]?.trim() || null;
  };
  const sn =
    pick(/Serial\s*number\s*[:=]\s*([A-Z0-9]+)/i) ||
    pick(/SN\s*[:=]\s*([A-Z0-9]+)/i);
  const onuType =
    pick(/^\s*Type\s*[:=]\s*(\S+)/im) || pick(/ONU\s*type\s*[:=]\s*(\S+)/i);
  const name = pick(/^\s*Name\s*[:=]\s*(.+)$/im);
  const description = pick(/Description\s*[:=]\s*(.+)$/im);
  const phaseState = pick(/Phase\s*state\s*[:=]\s*(\S+)/i);
  const adminState = pick(/Admin\s*state\s*[:=]\s*(\S+)/i);
  const onlineDuration = pick(/Online\s*Duration\s*[:=]\s*(.+)$/im);
  const distRaw = pick(/ONU\s*Distance\s*[:=]\s*(\d+)\s*m?/i);
  const distanceM = distRaw ? Number(distRaw) : null;

  const fields: Array<{ label: string; value: string }> = [];
  const labelRe =
    /^\s*(Vendor\s*ID|HW\s*Version|Detected\s*ONU\s*type|Name|Type|State|Current\s*channel|Admin\s*state|Phase\s*state|Serial\s*number|Description|ONU\s*Status|ONU\s*Distance|Online\s*Duration)\s*[:=]\s*(.+)$/gim;
  for (const m of text.matchAll(labelRe)) {
    fields.push({
      label: m[1].replace(/\s+/g, ' ').trim(),
      value: m[2].trim(),
    });
  }

  const history: ZteOnuHistoryRow[] = [];
  for (const line of text.split(/\r?\n/)) {
    const hm = line.match(
      /^\s*(\d+)\s+(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})\s+(.+?)(?:\s{2,}(.+))?$/,
    );
    if (hm) {
      history.push({
        index: Number(hm[1]),
        authpassTime: hm[2],
        offlineTime: (hm[3] || '').trim(),
        cause: (hm[4] || '').trim(),
      });
    }
  }

  return {
    sn: sn?.toUpperCase() ?? null,
    onuType,
    name,
    description,
    phaseState,
    distanceM: Number.isFinite(distanceM) ? distanceM : null,
    onlineDuration,
    adminState,
    vendorId: pick(/Vendor\s*ID\s*[:=]\s*(.+)$/im),
    hwVersion: pick(/HW\s*Version\s*[:=]\s*(.+)$/im),
    detectedType: pick(/Detected\s*ONU\s*type\s*[:=]\s*(.+)$/im),
    state: pick(/^\s*State\s*[:=]\s*(\S+)/im),
    currentChannel: pick(/Current\s*channel\s*[:=]\s*(.+)$/im),
    onuStatus: pick(/ONU\s*Status\s*[:=]\s*(\S+)/i),
    history,
    fields,
  };
}

export type ZteLanPortStatus = {
  port: string;
  speed: string;
  admin: string;
  maxFrame: string;
  statusChanges: string;
  operate?: string;
};

/** Parse `show gpon remote-onu interface eth …` */
export function parseRemoteOnuLanPorts(text: string): ZteLanPortStatus[] {
  const ports: ZteLanPortStatus[] = [];
  // Table style: eth_0/1  auto  unlock  1632  0
  for (const line of text.split(/\r?\n/)) {
    const row = line.match(
      /^\s*(eth_0\/\d+)\s+(\S+)\s+(\S+)\s+(\d+)\s+(\d+)\s*$/i,
    );
    if (row) {
      ports.push({
        port: row[1],
        speed: row[2],
        admin: row[3],
        maxFrame: row[4],
        statusChanges: row[5],
      });
    }
  }
  if (ports.length) return ports;

  // Block style per Interface:
  const blocks = text.split(/Interface\s*[:=]\s*/i).slice(1);
  for (const block of blocks) {
    const port = block.match(/^(eth_0\/\d+)/i)?.[1];
    if (!port) continue;
    const pick = (re: RegExp) => block.match(re)?.[1]?.trim() || '—';
    ports.push({
      port,
      speed: pick(/Speed\s*(?:status|config)\s*[:=]\s*(\S+)/i),
      admin: pick(/Admin\s*status\s*[:=]\s*(\S+)/i),
      maxFrame: pick(/Max[- ]?frame\s*[:=]\s*(\S+)/i),
      statusChanges: pick(/Status\s*changes\s*[:=]\s*(\S+)/i),
      operate: pick(/Operate\s*status\s*[:=]\s*(\S+)/i),
    });
  }
  return ports;
}

export type ZteOnuMacRow = {
  mac: string;
  vlan: string;
  type: string;
  port: string;
  vc: string;
};

/** Parse `show mac gpon onu …` */
export function parseOnuMacTable(text: string): ZteOnuMacRow[] {
  const rows: ZteOnuMacRow[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(
      /^\s*([0-9a-f]{4}\.[0-9a-f]{4}\.[0-9a-f]{4}|[0-9a-f:]{11,17})\s+(\d+)\s+(\S+)\s+(\S+)\s+(.+)?$/i,
    );
    if (!m) continue;
    rows.push({
      mac: m[1],
      vlan: m[2],
      type: m[3],
      port: m[4],
      vc: (m[5] || '').trim(),
    });
  }
  return rows;
}

export type ZteRemoteOnuEquip = {
  vendorId: string | null;
  version: string | null;
  model: string | null;
  equipId: string | null;
  sn: string | null;
  omccVersion: string | null;
  fields: Array<{ label: string; value: string }>;
  raw: string;
};

/** Parse `show gpon remote-onu equip …` */
export function parseRemoteOnuEquip(text: string): ZteRemoteOnuEquip {
  const pick = (re: RegExp) => text.match(re)?.[1]?.trim() || null;
  const fields: Array<{ label: string; value: string }> = [];
  for (const m of text.matchAll(
    /^\s*([A-Za-z][A-Za-z0-9 /_-]*)\s*[:=]\s*(.+)$/gm,
  )) {
    const label = m[1].trim();
    const value = m[2].trim();
    if (/^(show|interface|Total)/i.test(label)) continue;
    fields.push({ label, value });
  }
  return {
    vendorId: pick(/Vendor\s*ID\s*[:=]\s*(.+)$/im),
    version: pick(/^\s*Version\s*[:=]\s*(.+)$/im),
    model: pick(/^\s*Model\s*[:=]\s*(.+)$/im),
    equipId: pick(/EquipID\s*[:=]\s*(.+)$/im),
    sn: pick(/^\s*SN\s*[:=]\s*(.+)$/im),
    omccVersion: pick(/OMCC\s*Version\s*[:=]\s*(.+)$/im),
    fields,
    raw: text,
  };
}

function pad(s: string, n: number): string {
  const t = s ?? '';
  return t.length >= n ? t : t + ' '.repeat(n - t.length);
}

/** Build a SmartOLT-like status report text from CLI sections. */
export function formatOnuStatusReport(parts: {
  opticalRaw?: string | null;
  opticalRows?: ZteOpticalWavelengthRow[];
  catvRaw?: string | null;
  detailRaw?: string | null;
  detail?: ZteOnuDetailInfoParsed | null;
  wanRaw?: string | null;
  lanPorts?: ZteLanPortStatus[];
  lanRaw?: string | null;
  vlanRaw?: string | null;
  voipRaw?: string | null;
  macs?: ZteOnuMacRow[];
  macRaw?: string | null;
}): string {
  const usable = (raw?: string | null) => {
    const t = raw?.trim() || '';
    if (!t) return '';
    if (/%Error\s*\d+|Invalid\s+(?:input|parameter|command)/i.test(t))
      return '';
    return t;
  };

  const out: string[] = [];

  out.push('Optical status');
  if (parts.opticalRows?.length) {
    out.push(
      `${pad('Wavelength', 12)}${pad('OLT', 22)}${pad('ONU', 22)}Attenuation`,
    );
    for (const r of parts.opticalRows) {
      out.push(
        `${pad(r.wavelength, 12)}${pad(r.olt, 22)}${pad(r.onu, 22)}${r.attenuation}`,
      );
    }
  } else if (usable(parts.opticalRaw)) {
    out.push(usable(parts.opticalRaw));
  } else {
    out.push('(sin datos)');
  }
  out.push('');

  out.push('ONU CATV port');
  out.push(usable(parts.catvRaw) || '(no disponible / N/A)');
  out.push('');

  out.push('ONU details');
  if (parts.detail?.fields?.length) {
    for (const f of parts.detail.fields) {
      out.push(`${pad(f.label + ':', 22)}${f.value}`);
    }
  } else if (usable(parts.detailRaw)) {
    out.push(usable(parts.detailRaw));
  } else {
    out.push('(sin datos)');
  }
  out.push('');

  out.push('History');
  if (parts.detail?.history?.length) {
    out.push(`     ${pad('Authpass Time', 22)}${pad('OfflineTime', 24)}Cause`);
    for (const h of parts.detail.history) {
      out.push(
        ` ${String(h.index).padStart(2)}   ${pad(h.authpassTime, 22)}${pad(h.offlineTime, 24)}${h.cause}`,
      );
    }
  } else {
    const hist = usable(parts.detailRaw)?.match(/History[\s\S]*/i)?.[0];
    out.push(hist?.trim() || '(sin historial)');
  }
  out.push('');

  out.push('ONU WAN Interfaces');
  out.push(usable(parts.wanRaw) || '(no disponible)');
  out.push('');

  out.push('ONU LAN Interfaces status');
  if (parts.lanPorts?.length) {
    out.push(
      `${pad('Port', 14)}${pad('Speed', 13)}${pad('Admin', 10)}${pad('Max-frame', 11)}Status changes`,
    );
    for (const p of parts.lanPorts) {
      out.push(
        `${pad(p.port, 14)}${pad(p.speed, 13)}${pad(p.admin, 10)}${pad(p.maxFrame, 11)}${p.statusChanges}`,
      );
    }
  } else if (usable(parts.lanRaw)) {
    out.push(usable(parts.lanRaw));
  } else {
    out.push('(sin datos)');
  }
  out.push('');

  out.push('Realtime VLAN info');
  out.push(usable(parts.vlanRaw) || '(no disponible)');
  out.push('');

  out.push('VoIP status');
  out.push(usable(parts.voipRaw) || '(no disponible)');
  out.push('');

  out.push('MACs on OLT from this ONU');
  if (parts.macs?.length) {
    out.push(
      `${pad('Mac address', 20)}${pad('Vlan', 6)}${pad('Type', 10)}${pad('Port', 26)}Vc`,
    );
    for (const m of parts.macs) {
      out.push(
        `${pad(m.mac, 20)}${pad(m.vlan, 6)}${pad(m.type, 10)}${pad(m.port, 26)}${m.vc}`,
      );
    }
  } else if (usable(parts.macRaw)) {
    out.push(usable(parts.macRaw));
  } else {
    out.push('(sin MACs)');
  }

  return out.join('\n');
}

/** Parse `show running-config interface gpon-onu_…` */
export function parseOnuInterfaceConfig(
  onuIf: string,
  text: string,
): ZteOnuInterfaceConfig {
  const name = text.match(/^\s*name\s+(.+)$/im)?.[1]?.trim() || null;
  const description =
    text.match(/^\s*description\s+(.+)$/im)?.[1]?.trim() || null;
  const vlans = new Set<number>();
  for (const m of text.matchAll(
    /vlan\s+(\d+)\b|switchport\s+vlan\s+(\d+)|service-port\s+\d+\s+vlan\s+(\d+)/gi,
  )) {
    const v = Number(m[1] || m[2] || m[3]);
    if (Number.isFinite(v) && v > 0 && v < 4095) vlans.add(v);
  }
  let mode: 'bridge' | 'router' | null = null;
  if (/\bveip\b/i.test(text) || /\brouting\b/i.test(text)) mode = 'router';
  else if (/\bbridge\b/i.test(text) || /\beth_0\//i.test(text)) mode = 'bridge';
  return {
    onuIf,
    name,
    description,
    vlans: [...vlans].sort((a, b) => a - b),
    mode,
    raw: text,
  };
}

/** Extract gpon-onu / epon-onu interface blocks from full running-config */
export function parseOnuInterfacesFromRunningConfig(
  text: string,
): Map<string, ZteOnuInterfaceConfig> {
  const map = new Map<string, ZteOnuInterfaceConfig>();
  const re = /^interface\s+((?:gpon|epon)-onu_[\d/]+:\d+)\s*$/gim;
  const matches = [...text.matchAll(re)];
  for (let i = 0; i < matches.length; i++) {
    const onuIf = matches[i][1];
    const start = matches[i].index + matches[i][0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index : text.length;
    // Also stop at next top-level interface
    let block = text.slice(start, end);
    const nextIface = block.search(/^interface\s+/im);
    if (nextIface >= 0) block = block.slice(0, nextIface);
    map.set(onuIf, parseOnuInterfaceConfig(onuIf, block));
  }
  return map;
}

export function oltIfFromOnuIf(onuIf: string): string | null {
  const m =
    onuIf.match(/^((?:gpon|epon)-onu_([\d/]+)):(\d+)$/i) ||
    onuIf.match(/^((?:gpon|epon)_onu-([\d/]+)):(\d+)$/i);
  if (!m) return null;
  return m[1]
    .replace(/-onu_/i, '-olt_')
    .replace(/_onu-/i, '_olt-')
    .replace(/_olt-/i, '-olt_');
}

/**
 * Parse `show interface gpon-onu_…` ONU statistic rates.
 * OLT Input  = from ONU → customer upload (subida)
 * OLT Output = to ONU   → customer download (bajada)
 */
export function parseOnuInterfaceRates(text: string): {
  uploadBps: number | null;
  downloadBps: number | null;
  uploadPps: number | null;
  downloadPps: number | null;
} {
  const input = text.match(
    /Input\s+rate\s*[:=]\s*(\d+(?:\.\d+)?)\s*Bps(?:\s+(\d+(?:\.\d+)?)\s*pps)?/i,
  );
  const output = text.match(
    /Output\s+rate\s*[:=]\s*(\d+(?:\.\d+)?)\s*Bps(?:\s+(\d+(?:\.\d+)?)\s*pps)?/i,
  );
  const uploadBps = input ? Number(input[1]) : null;
  const downloadBps = output ? Number(output[1]) : null;
  const uploadPps = input?.[2] != null ? Number(input[2]) : null;
  const downloadPps = output?.[2] != null ? Number(output[2]) : null;
  return {
    uploadBps:
      uploadBps != null && Number.isFinite(uploadBps) ? uploadBps : null,
    downloadBps:
      downloadBps != null && Number.isFinite(downloadBps) ? downloadBps : null,
    uploadPps:
      uploadPps != null && Number.isFinite(uploadPps) ? uploadPps : null,
    downloadPps:
      downloadPps != null && Number.isFinite(downloadPps) ? downloadPps : null,
  };
}

export function buildOnuIf(
  family: 'gpon' | 'epon',
  shelf: string,
  slot: string,
  port: string | number,
  onuId: string | number,
): string {
  return `${family}-onu_${shelf}/${slot}/${port}:${onuId}`;
}

export type ZteUncfgOnu = {
  /** Parent OLT interface, e.g. gpon-olt_1/2/14 */
  oltIf: string;
  /** Hint from uncfg table if present (often provisional) */
  onuIfHint: string | null;
  sn: string;
  state: string | null;
  ponType: 'gpon' | 'epon';
  board: string;
  port: string;
  /** Suggested next free ONU id on this PON port */
  suggestedOnuId: number | null;
};

/**
 * Parse `show gpon onu uncfg` / per-port uncfg tables.
 * Rows look like: gpon-onu_1/1/1:1   ZTEG00000002   unknown
 */
export function parseOnuUncfg(
  text: string,
  defaultOltIf?: string | null,
): Omit<ZteUncfgOnu, 'suggestedOnuId'>[] {
  const rows: Omit<ZteUncfgOnu, 'suggestedOnuId'>[] = [];
  const seenSn = new Set<string>();

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^OnuIndex|^----|^Total|^show\s/i.test(trimmed)) continue;

    const m = trimmed.match(
      /^((?:gpon|epon)-onu_[\d/]+(?::\d+)?|(?:gpon|epon)_onu-[\d/]+(?::\d+)?)\s+([A-Za-z0-9]{8,16})\s*(\S+)?/i,
    );
    if (!m) {
      // SN-only style: ZTEG00000002 unknown
      const snOnly = trimmed.match(/^([A-Za-z0-9]{10,16})\s+(\S+)?$/);
      if (snOnly && defaultOltIf) {
        const sn = snOnly[1].toUpperCase();
        if (seenSn.has(sn)) continue;
        seenSn.add(sn);
        const family = defaultOltIf.startsWith('epon') ? 'epon' : 'gpon';
        const parts =
          defaultOltIf.match(/^(?:gpon|epon)-olt_(\d+)\/(\d+)\/(\d+)$/i) ||
          defaultOltIf.match(/^(?:gpon|epon)_olt-(\d+)\/(\d+)\/(\d+)$/i);
        const oltIfCanon = parts
          ? `${family}-olt_${parts[1]}/${parts[2]}/${parts[3]}`
          : defaultOltIf.replace(/_olt-/i, '-olt_');
        rows.push({
          oltIf: oltIfCanon,
          onuIfHint: null,
          sn,
          state: snOnly[2] ?? null,
          ponType: family,
          board: parts?.[2] ?? '',
          port: parts?.[3] ?? '',
        });
      }
      continue;
    }

    const onuIfHint = m[1];
    const sn = m[2].toUpperCase();
    if (seenSn.has(sn)) continue;
    seenSn.add(sn);

    const family = onuIfHint.startsWith('epon') ? 'epon' : 'gpon';
    const oltIfRaw =
      defaultOltIf ||
      onuIfHint
        .replace(/-onu_/i, '-olt_')
        .replace(/_onu-/i, '_olt-')
        .replace(/:\d+$/, '');
    const parts =
      oltIfRaw.match(/^(?:gpon|epon)-olt_(\d+)\/(\d+)\/(\d+)$/i) ||
      oltIfRaw.match(/^(?:gpon|epon)_olt-(\d+)\/(\d+)\/(\d+)$/i);
    const oltIf = parts
      ? `${family}-olt_${parts[1]}/${parts[2]}/${parts[3]}`
      : oltIfRaw.replace(/_olt-/i, '-olt_');

    rows.push({
      oltIf,
      onuIfHint,
      sn,
      state: m[3]?.trim() || null,
      ponType: family,
      board: parts?.[2] ?? '',
      port: parts?.[3] ?? '',
    });
  }
  return rows;
}

/** Next free ONU id given occupied ids (1-based). Caps at maxOnus. */
export function suggestNextOnuId(
  occupiedIds: Array<string | number>,
  maxOnus = 128,
): number | null {
  const used = new Set(
    occupiedIds
      .map((x) => Number(x))
      .filter((n) => Number.isFinite(n) && n >= 1),
  );
  for (let i = 1; i <= maxOnus; i++) {
    if (!used.has(i)) return i;
  }
  return null;
}

/** Build gpon-onu_…:id from gpon-olt_… / gpon_olt-… + onuId (canonical). */
export function onuIfFromOltIf(oltIf: string, onuId: string | number): string {
  const canon = oltIf
    .replace(/_olt-/i, '-olt_')
    .replace(/^(gpon|epon)_(\d)/i, '$1-olt_$2');
  return `${canon.replace(/-olt_/i, '-onu_')}:${onuId}`;
}
