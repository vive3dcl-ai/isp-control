/** Parsers for ZTE uplink interfaces (gei_ / xgei_). */

export type UplinkMediaType = 'fiber' | 'copper' | 'unknown';

export interface ZteUplinkRaw {
  ifName: string;
  description: string | null;
  mediaType: UplinkMediaType;
  adminEnabled: boolean;
  /** Oper status string: Down | 10G-FullD | 1G-FullD | Up | … */
  status: string;
  negotiation: string | null;
  mtu: number | null;
  wavelengthNm: number | null;
  signalDbm: number | null;
  tempC: number | null;
  pvidUntag: number | null;
  mode: string | null;
  taggedVlans: number[];
}

const IF_RE = /^interface\s+((?:x)?gei_[\d/]+)\s*$/im;

export function extractUplinkIfNames(runningConfig: string): string[] {
  const names: string[] = [];
  for (const line of runningConfig.split(/\r?\n/)) {
    const m = line.match(/^\s*interface\s+((?:x)?gei_[\d/]+)\s*$/i);
    if (m) names.push(m[1]);
  }
  return [...new Set(names)];
}

/**
 * Discover uplink ifNames from lighter CLI output (`show interface`,
 * `show running-config | include …`) without a full running-config dump.
 */
export function extractUplinkIfNamesLoose(text: string): string[] {
  const names = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/\b((?:x)?gei_[\d/]+)\b/i);
    if (m) names.add(m[1]);
  }
  return [...names].sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true }),
  );
}

export function extractInterfaceBlock(
  runningConfig: string,
  ifName: string,
): string {
  const all = extractAllInterfaceBlocks(runningConfig);
  // Case-insensitive lookup
  const exact = all.get(ifName);
  if (exact != null) return exact;
  const lower = ifName.toLowerCase();
  for (const [name, block] of all) {
    if (name.toLowerCase() === lower) return block;
  }
  return '';
}

/**
 * Split a running-config dump into interface name → body (until next
 * interface / `!` / prompt). Used to avoid N× `show running-config interface`.
 */
export function extractAllInterfaceBlocks(
  runningConfig: string,
): Map<string, string> {
  const map = new Map<string, string>();
  const lines = runningConfig.split(/\r?\n/);
  let current: string | null = null;
  const buf: string[] = [];
  const flush = () => {
    if (current) map.set(current, buf.join('\n'));
    current = null;
    buf.length = 0;
  };
  for (const line of lines) {
    const m = line.match(/^\s*interface\s+(\S+)\s*$/i);
    if (m) {
      flush();
      current = m[1];
      continue;
    }
    if (!current) continue;
    // End only on next interface or CLI prompt — do not cut on section `!`
    // (some firmwares emit `!` mid-block / aesthetic separators).
    if (/^[\w-]+#/.test(line)) {
      flush();
      continue;
    }
    buf.push(line);
  }
  flush();
  return map;
}

export function parseUplinkConfigBlock(block: string): {
  description: string | null;
  adminEnabled: boolean;
  mode: string | null;
  taggedVlans: number[];
  pvidUntag: number | null;
  mtu: number | null;
} {
  let description: string | null = null;
  let adminEnabled = true;
  let mode: string | null = null;
  const tagged = new Set<number>();
  let pvidUntag: number | null = null;
  let mtu: number | null = null;

  for (const raw of block.split(/\r?\n/)) {
    const line = raw.trim();
    if (/^shutdown$/i.test(line)) adminEnabled = false;
    if (/^no\s+shutdown$/i.test(line)) adminEnabled = true;
    const desc = line.match(/^description\s+(.+)$/i);
    if (desc) description = desc[1].trim();
    const modeM = line.match(/^switchport\s+mode\s+(\S+)/i);
    if (modeM) mode = capitalize(modeM[1]);
    const tagM = line.match(/^switchport\s+vlan\s+(\d+(?:[,-]\d+)*)\s+tag\b/i);
    if (tagM) {
      for (const v of expandVlanList(tagM[1])) tagged.add(v);
    }
    const untagM = line.match(/^switchport\s+vlan\s+(\d+)\s+untag\b/i);
    if (untagM) pvidUntag = Number(untagM[1]);
    const mtuM = line.match(/^mtu\s+(\d+)/i);
    if (mtuM) mtu = Number(mtuM[1]);
  }

  return {
    description,
    adminEnabled,
    mode,
    taggedVlans: [...tagged].sort((a, b) => a - b),
    pvidUntag,
    mtu,
  };
}

export function expandVlanList(spec: string): number[] {
  const out: number[] = [];
  for (const part of spec
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)) {
    const range = part.match(/^(\d+)-(\d+)$/);
    if (range) {
      const a = Number(range[1]);
      const b = Number(range[2]);
      for (let i = Math.min(a, b); i <= Math.max(a, b); i++) out.push(i);
    } else if (/^\d+$/.test(part)) {
      out.push(Number(part));
    }
  }
  return out;
}

export function formatVlanList(vlans: number[]): string {
  if (!vlans.length) return '';
  const sorted = [...vlans].sort((a, b) => a - b);
  const parts: string[] = [];
  let start = sorted[0];
  let prev = sorted[0];
  for (let i = 1; i <= sorted.length; i++) {
    const cur = sorted[i];
    if (cur === prev + 1) {
      prev = cur;
      continue;
    }
    parts.push(start === prev ? String(start) : `${start}-${prev}`);
    start = cur;
    prev = cur;
  }
  return parts.join(', ');
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

export function parseInterfaceStatus(text: string): {
  status: string;
  negotiation: string | null;
  mtu: number | null;
} {
  // Examples: "line protocol is up", "10G-FullD", "down"
  let status = 'Down';
  let negotiation: string | null = null;
  let mtu: number | null = null;

  if (
    /line protocol is up|is up,/i.test(text) &&
    !/administratively down/i.test(text)
  ) {
    const speed =
      text.match(/\b(\d+G?)-(Full|Half)D?\b/i) ||
      text.match(/\b(10G|1G|1000|100|10)\s*(full|half)?/i);
    if (speed) {
      const s = speed[0].replace(/\s+/g, '-');
      status = /full/i.test(s) || /G/i.test(s) ? normalizeSpeed(s) : 'Up';
      negotiation =
        status.includes('Full') || status.includes('Half')
          ? `Forced ${status}`
          : 'Auto';
    } else {
      status = 'Up';
      negotiation = 'Auto';
    }
  } else if (/administratively down|is down/i.test(text)) {
    status = 'Down';
  }

  const mtuM = text.match(/MTU\s+(\d+)/i);
  if (mtuM) mtu = Number(mtuM[1]);

  // Duplex/speed from explicit lines
  const forced = text.match(
    /(?:speed|duplex|configured).*?(10G-FullD|1G-FullD|1000-Full|100-Full)/i,
  );
  if (forced) {
    negotiation = `Forced ${forced[1]}`;
    if (status !== 'Down') status = forced[1];
  }
  const auto = text.match(/negotiation\s*:\s*auto/i);
  if (auto)
    negotiation = negotiation?.startsWith('Forced') ? negotiation : 'Auto';

  return { status, negotiation, mtu };
}

function normalizeSpeed(s: string): string {
  const u = s.replace(/\s+/g, '');
  if (/10G/i.test(u)) return '10G-FullD';
  if (/1000|1G/i.test(u)) return '1G-FullD';
  return u;
}

export function parseOpticalUplink(text: string): {
  wavelengthNm: number | null;
  signalDbm: number | null;
  tempC: number | null;
  isFiber: boolean;
} {
  const wl = text.match(/Wavelength\s*[:=]\s*(\d+)/i);
  const rx =
    text.match(/Rx\s*Power\s*[:=]\s*(-?[\d.]+)/i) ||
    text.match(/Tx\s*Power\s*[:=]\s*(-?[\d.]+)/i);
  const temp = text.match(/Temperature\s*[:=]\s*(-?[\d.]+)/i);
  const isFiber =
    /Optical module|Wavelength|SFP|Transceiver/i.test(text) &&
    !/N\/A.*Wavelength|no optical/i.test(text);

  return {
    wavelengthNm: wl ? Number(wl[1]) : null,
    signalDbm: rx && Number.isFinite(Number(rx[1])) ? Number(rx[1]) : null,
    tempC: temp && Number.isFinite(Number(temp[1])) ? Number(temp[1]) : null,
    isFiber,
  };
}

export function inferMediaType(
  ifName: string,
  optical: { isFiber: boolean },
): UplinkMediaType {
  if (optical.isFiber || /^xgei_/i.test(ifName)) return 'fiber';
  if (/^gei_/i.test(ifName)) return optical.isFiber ? 'fiber' : 'copper';
  return 'unknown';
}

// silence unused if IF_RE reserved for later
void IF_RE;
