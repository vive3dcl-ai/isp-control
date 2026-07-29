/**
 * Huawei SmartAX firmware / chassis dialect detection for OMCI TR-069.
 *
 * Families (CLI differs mainly in WAN OMCI + profile syntax):
 * - ma5600t: MA5608T / MA5683T / MA5680T / MA5600T
 * - ma5800:  MA5800-X2/X7/X15/X17 (+ EA5800 when added)
 *
 * Detected from subtype, product banner (`display version`) and SoftVer.
 */

export const HUAWEI_FW_FAMILIES = ['ma5600t', 'ma5800', 'unknown'] as const;
export type HuaweiFwFamily = (typeof HUAWEI_FW_FAMILIES)[number];

export const HUAWEI_FW_FAMILY_LABELS: Record<HuaweiFwFamily, string> = {
  ma5600t: 'MA5600T',
  ma5800: 'MA5800',
  unknown: 'Huawei (auto)',
};

export type HuaweiVersionInfo = {
  family: HuaweiFwFamily;
  product: string | null;
  softVer: string | null;
  vrp: string | null;
  rawHint: string | null;
};

/** Prefer explicit subtype, then product / version banner. */
export function detectHuaweiFwFamily(input: {
  subtype?: string | null;
  product?: string | null;
  softVer?: string | null;
  versionText?: string | null;
}): HuaweiFwFamily {
  const subtype = (input.subtype || '').toLowerCase();
  if (
    subtype.startsWith('huawei_ma5800') ||
    subtype.startsWith('huawei_ea5800')
  ) {
    return 'ma5800';
  }
  if (
    subtype.startsWith('huawei_ma5608') ||
    subtype.startsWith('huawei_ma568') ||
    subtype.startsWith('huawei_ma5600')
  ) {
    return 'ma5600t';
  }

  const blob = [input.product, input.softVer, input.versionText]
    .filter(Boolean)
    .join(' ')
    .toUpperCase();

  if (!blob.trim()) return 'unknown';

  // Explicit dialect tags we may append to SoftVer / hints (e.g. "V100R019 · ma5800")
  if (/(?:^|[\s·])ma5800(?:[\s·]|$)/i.test(blob)) return 'ma5800';
  if (/(?:^|[\s·])ma5600t(?:[\s·]|$)/i.test(blob)) return 'ma5600t';

  if (
    /\bMA5800\b/.test(blob) ||
    /\bEA5800\b/.test(blob) ||
    /\bMA5801\b/.test(blob)
  ) {
    return 'ma5800';
  }
  if (
    /\bMA5608T\b/.test(blob) ||
    /\bMA5683T\b/.test(blob) ||
    /\bMA5680T\b/.test(blob) ||
    /\bMA5600T\b/.test(blob) ||
    /\bMA5603T\b/.test(blob)
  ) {
    return 'ma5600t';
  }

  // SoftVer heuristics (not exclusive): V100R01x common on MA5800 distributed;
  // V800R013/R015 often MA5600T-class.
  if (/\bV100R0(1[6-9]|2\d)\b/.test(blob)) return 'ma5800';
  if (/\bV800R0\d{2}\b/.test(blob)) return 'ma5600t';

  return 'unknown';
}

export function parseHuaweiVersionBanner(text: string): HuaweiVersionInfo {
  const product =
    text.match(
      /\b(MA5800(?:-X\d+)?|EA5800(?:-X\d+)?|MA5608T|MA5683T|MA5680T|MA5600T|MA5603T)\b/i,
    )?.[1] ?? null;
  const softVer =
    text
      .match(
        /(?:VERSION|PRODUCT\s*VERSION|SOFTWARE\s*VERSION|SoftVer)\s*[:=]?\s*([^\r\n]+)/i,
      )?.[1]
      ?.trim()
      ?.replace(/\s{2,}/g, ' ') ?? null;
  const vrp =
    text
      .match(/VRP(?:\s*\(R\))?\s*(?:software,)?\s*Version\s*([^\r\n]+)/i)?.[1]
      ?.trim() ?? null;

  const family = detectHuaweiFwFamily({
    product,
    softVer,
    versionText: text,
  });

  return {
    family,
    product,
    softVer,
    vrp,
    rawHint: softVer || product || null,
  };
}

/** ACS URL forms accepted by different SmartAX builds. */
export function buildHuaweiAcsUrlVariants(endpoint: string): string[] {
  const ep = endpoint
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '');
  if (!ep) return [];
  return [`http://${ep}`, `http://${ep}/`, ep, `https://${ep}`];
}

/**
 * Ordered TR069 server-profile create commands.
 * First success wins; callers skip if profile with matching URL already exists.
 */
export function buildTr069ProfileAddCommands(opts: {
  profileId: number;
  profileName: string;
  acsUrl: string;
  username: string;
  password: string;
  family: HuaweiFwFamily;
}): string[] {
  const id = opts.profileId;
  const name = opts.profileName.replace(/"/g, '');
  const u = opts.username.replace(/"/g, '');
  const p = opts.password.replace(/"/g, '');
  const url = opts.acsUrl;
  const cmds: string[] = [];

  // Most common (MA5608T / MA568x / many MA5800)
  cmds.push(
    `ont tr069-server-profile add profile-id ${id} profile-name "${name}" url "${url}" user ${u} ${p}`,
  );
  cmds.push(
    `ont tr069-server-profile add profile-id ${id} profile-name "${name}" url ${url} user "${u}" "${p}"`,
  );
  cmds.push(
    `ont tr069-server-profile add profile-id ${id} profile-name ${name} url ${url} user ${u} ${p}`,
  );
  // MA5800 docs often include auth-realm
  if (opts.family === 'ma5800' || opts.family === 'unknown') {
    cmds.push(
      `ont tr069-server-profile add profile-id ${id} url ${url} user "${u}" "${p}" auth-realm auth`,
    );
    cmds.push(
      `ont tr069-server-profile add profile-id ${id} profile-name "${name}" url ${url} user "${u}" "${p}" auth-realm auth`,
    );
  }
  // Compact without profile-name
  cmds.push(
    `ont tr069-server-profile add profile-id ${id} url ${url} user ${u} ${p}`,
  );
  return cmds;
}

/** Mgmt / TR069 WAN IP assignment variants (ip-index 0 = typical TR069). */
export function buildOntIpconfigCommands(opts: {
  port: string | number;
  ontId: string | number;
  ipIndex: number;
  vlan: number;
  priority?: number;
  mode: 'dhcp' | 'static';
  ip?: string | null;
  mask?: string | null;
  gateway?: string | null;
  family: HuaweiFwFamily;
}): string[] {
  const { port, ontId, ipIndex, vlan } = opts;
  const pri = opts.priority ?? 5;
  const cmds: string[] = [];

  if (opts.mode === 'dhcp') {
    cmds.push(
      `ont ipconfig ${port} ${ontId} ip-index ${ipIndex} dhcp vlan ${vlan} priority ${pri}`,
    );
    cmds.push(
      `ont ipconfig ${port} ${ontId} dhcp vlan ${vlan} priority ${pri}`,
    );
    return cmds;
  }

  const ip = opts.ip?.trim();
  const mask = opts.mask?.trim();
  const gw = (opts.gateway || ip || '').trim();
  if (!ip || !mask) return cmds;

  const ma5800Forms = [
    `ont ipconfig ${port} ${ontId} ip-index ${ipIndex} static ip-address ${ip} mask ${mask} vlan ${vlan} priority ${pri} gateway ${gw}`,
    `ont ipconfig ${port} ${ontId} ip-index ${ipIndex} static ip-address ${ip} mask ${mask} vlan ${vlan} priority ${pri}`,
  ];
  const ma5600Forms = [
    `ont ipconfig ${port} ${ontId} ip-index ${ipIndex} static ${ip} ${mask} ${gw} vlan ${vlan} priority ${pri}`,
    `ont ipconfig ${port} ${ontId} static ${ip} ${mask} ${gw} vlan ${vlan} priority ${pri}`,
    `ont ipconfig ${port} ${ontId} ip-index ${ipIndex} static-ip ${ip} mask ${mask} gateway ${gw} vlan ${vlan}`,
  ];

  if (opts.family === 'ma5600t') {
    cmds.push(...ma5600Forms, ...ma5800Forms);
  } else {
    // ma5800 + unknown: prefer documented MA5800 forms, then classic
    cmds.push(...ma5800Forms, ...ma5600Forms);
  }
  return cmds;
}

export function cliRejected(out: string): boolean {
  const text = out.replace(/\r/g, '');
  // Success counters like "Failure: 0" / "failure:0" must NOT count as reject
  const cleaned = text
    .replace(/\bfailures?\s*[:=]?\s*0\b/gi, ' ')
    .replace(/\berrors?\s*[:=]?\s*0\b/gi, ' ');
  return /(?:^|[\s%])(?:Error|Failure|Invalid|Unknown command|Unrecognized|Incomplete|Ambiguous|Wrong parameter|does not exist|not support|Parameter error)/i.test(
    cleaned,
  );
}

export function parseExistingTr069ProfileId(
  displayOut: string,
  acsEndpoint: string,
): number | null {
  const needle = acsEndpoint
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '')
    .toLowerCase();
  if (!needle) return null;

  // Split into profile blocks when possible
  const blocks = displayOut.split(
    /(?=profile-id\s*[:=]?\s*\d+|Profile ID\s*[:=]?\s*\d+)/i,
  );
  for (const block of blocks) {
    const id = Number(
      block.match(/(?:profile-id|Profile ID)\s*[:=]?\s*(\d+)/i)?.[1],
    );
    if (!Number.isFinite(id)) continue;
    const url = (block.match(/url\s*[:=]?\s*(\S+)/i)?.[1] || '').toLowerCase();
    if (
      url.includes(needle) ||
      needle.includes(url.replace(/^https?:\/\//, ''))
    ) {
      return id;
    }
  }

  // Fallback: any profile-id near the endpoint string
  const idx = displayOut.toLowerCase().indexOf(needle);
  if (idx >= 0) {
    const window = displayOut.slice(Math.max(0, idx - 200), idx + 200);
    const id = Number(
      window.match(/(?:profile-id|Profile ID)\s*[:=]?\s*(\d+)/i)?.[1],
    );
    if (Number.isFinite(id)) return id;
  }
  return null;
}

export function nextFreeProfileId(displayOut: string, preferred = 20): number {
  const used = new Set(
    [...displayOut.matchAll(/(?:profile-id|Profile ID)\s*[:=]?\s*(\d+)/gi)].map(
      (m) => Number(m[1]),
    ),
  );
  let id = preferred;
  while (used.has(id) && id < 512) id += 1;
  return id;
}

/** Indexes of service-ports for an ONT that use a given gemport. */
export function parseServicePortIndexesByGemport(
  displayOut: string,
  gemport: number,
): string[] {
  const indexes = new Set<string>();
  for (const m of displayOut.matchAll(
    /service-port\s+(\d+)[^\n]*gemport\s+(\d+)/gi,
  )) {
    if (Number(m[2]) === gemport) indexes.add(m[1]);
  }
  for (const m of displayOut.matchAll(
    /gemport\s+(\d+)[^\n]*?(?:index|INDEX)\s*[:=]?\s*(\d+)/gi,
  )) {
    if (Number(m[1]) === gemport) indexes.add(m[2]);
  }
  for (const line of displayOut.split(/\r?\n/)) {
    // INDEX VLAN ATTR gpon F/S/P VPI VCI(FlowPara/gem) …
    // e.g. "2677 212 common gpon 0/1/0 0 1 vlan 212"
    const row = line.match(
      /^\s*(\d+)\s+\d+\s+\S+\s+gpon\s+\d+\/\d+\/\d+\s+(\d+)\s+(\d+)\b/i,
    );
    if (row && Number(row[3]) === gemport) {
      indexes.add(row[1]);
      continue;
    }
    // INDEX VLAN VLAN gpon F/S/P VPI VCI FlowType FlowPara(gem)
    const row2 = line.match(
      /^\s*(\d+)\s+\d+\s+\d+\s+gpon\s+\d+\/\d+\/\d+\s+\d+\s+\d+\s+\S+\s+(\d+)\b/i,
    );
    if (row2 && Number(row2[2]) === gemport) indexes.add(row2[1]);
  }
  return [...indexes];
}

/** Also match service-port indexes carrying a given VLAN (for replace). */
export function parseServicePortIndexesByVlan(
  displayOut: string,
  vlan: number,
): string[] {
  const indexes = new Set<string>();
  for (const m of displayOut.matchAll(
    new RegExp(`service-port\\s+(\\d+)[^\\n]*\\bvlan\\s+${vlan}\\b`, 'gi'),
  )) {
    indexes.add(m[1]);
  }
  for (const line of displayOut.split(/\r?\n/)) {
    const row = line.match(/^\s*(\d+)\s+(\d+)\s+\S+\s+gpon\s+\d+\/\d+\/\d+/i);
    if (row && Number(row[2]) === vlan) indexes.add(row[1]);
  }
  return [...indexes];
}

/** Strip dialect tag we may have appended historically: "V100 · ma5800" */
export function stripHuaweiDialectTag(value?: string | null): string | null {
  if (!value?.trim()) return null;
  return (
    value.replace(/\s*[·|]\s*(ma5600t|ma5800|unknown)\s*$/i, '').trim() || null
  );
}

/** Line profile id bound to an ONT from `display ont info …`. */
export function parseOntLineProfileId(displayOut: string): number | null {
  const id = Number(
    displayOut.match(
      /(?:Line\s*profile\s*ID|ont-lineprofile-id|Line profile(?:\s*ID)?)\s*[:=]?\s*(\d+)/i,
    )?.[1],
  );
  return Number.isFinite(id) ? id : null;
}
