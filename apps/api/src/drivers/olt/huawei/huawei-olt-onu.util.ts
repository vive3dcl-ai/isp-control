export type HuaweiOnuStatus = 'online' | 'offline' | 'los' | 'other';

export interface HuaweiOltCard {
  rack: string;
  shelf: string;
  slot: string;
  cfgType: string;
  realType: string;
  status: string;
  role?: string | null;
  ports?: number;
  softVer?: string;
}

export function isHuaweiGponCard(cardType: string): boolean {
  const type = cardType.trim().toUpperCase();
  if (!type || /^(?:EP|ET)/.test(type) || /EPON/.test(type)) return false;
  return /^(?:GP|XG)|GPON/.test(type);
}

export function isHuaweiEponCard(cardType: string): boolean {
  const type = cardType.trim().toUpperCase();
  return /^(?:EP|ET)/.test(type) || /EPON/.test(type);
}

export interface HuaweiConnectedOnu {
  onuIf: string;
  ponType: 'gpon';
  board: string;
  port: string;
  onuId: string;
  status: HuaweiOnuStatus;
  online: boolean;
  phaseState: string;
  adminState: string;
  sn: string | null;
  onuType: string | null;
  name: string | null;
  description: string | null;
  signalDbm: number | null;
  mode: 'bridge' | 'router' | null;
  vlan: number | null;
  vlans: number[];
}

export interface HuaweiUncfgOnu {
  oltIf: string;
  onuIfHint: string | null;
  sn: string;
  onuType: string | null;
  state: string | null;
  ponType: 'gpon';
  board: string;
  port: string;
  suggestedOnuId: number | null;
}

export function buildHuaweiOltIf(
  slot: string | number,
  port: string | number,
): string {
  return `gpon-olt_0/${slot}/${port}`;
}

export function buildHuaweiOnuIf(
  slot: string | number,
  port: string | number,
  ontId: string | number,
): string {
  return `gpon-onu_0/${slot}/${port}:${ontId}`;
}

export function parseHuaweiOltIf(ifName: string): {
  shelf: string;
  slot: string;
  port: string;
  family: 'gpon';
} | null {
  const match = ifName.trim().match(/^gpon-olt_(\d+)\/(\d+)\/(\d+)$/i);
  return match
    ? {
        family: 'gpon',
        shelf: match[1],
        slot: match[2],
        port: match[3],
      }
    : null;
}

export function parseHuaweiOnuIf(ifName: string): {
  shelf: string;
  slot: string;
  port: string;
  ontId: string;
  family: 'gpon';
} | null {
  const match = ifName.trim().match(/^gpon-onu_(\d+)\/(\d+)\/(\d+):(\d+)$/i);
  return match
    ? {
        family: 'gpon',
        shelf: match[1],
        slot: match[2],
        port: match[3],
        ontId: match[4],
      }
    : null;
}

/**
 * Normalize Huawei IF-MIB spellings (GPON0/1/0, gpon_0/1/0, gpon 0/1/0)
 * to the DB/UI key. EPON is deliberately unsupported.
 */
export function canonicalizeHuaweiPonIfName(ifName: string): string | null {
  const value = ifName.trim();
  const canonical = parseHuaweiOltIf(value);
  if (canonical) return buildHuaweiOltIf(canonical.slot, canonical.port);
  if (/epon/i.test(value)) return null;
  const match = value.match(
    /^(?:gpon|xgpon|xgspon)(?:-olt_|_olt-|[\s_-]*)(\d+)\/(\d+)\/(\d+)$/i,
  );
  return match ? buildHuaweiOltIf(match[2], match[3]) : null;
}

export function parseHuaweiTrafficRates(text: string): {
  downloadBps: number | null;
  uploadBps: number | null;
  downloadPps: number | null;
  uploadPps: number | null;
} {
  const rate = (
    direction: 'upstream' | 'downstream',
    unit: 'bit' | 'packet',
  ) => {
    const aliases =
      direction === 'upstream'
        ? '(?:upstream|up\\s*stream|ont\\s*(?:rx|receive)|input)'
        : '(?:downstream|down\\s*stream|ont\\s*(?:tx|transmit)|output)';
    const units =
      unit === 'bit'
        ? '(?:([kmg]?)\\s*(?:bits?|bps|bit/s)|([kmg]?)\\s*bytes?(?:/s|ps)?)'
        : '(?:packets?(?:/s|ps)?|pps)';
    const match =
      (unit === 'packet'
        ? text.match(
            new RegExp(
              `${aliases}[^\\r\\n]*(?:packets?(?:/s|ps)?|pps)[^\\d]*(\\d+(?:\\.\\d+)?)`,
              'i',
            ),
          )
        : null) ??
      text.match(
        new RegExp(
          `${aliases}[^\\r\\n:=]*[:=]?\\s*(\\d+(?:\\.\\d+)?)\\s*${units}`,
          'i',
        ),
      );
    if (!match) return null;
    const value = Number(match[1]);
    if (!Number.isFinite(value) || value < 0) return null;
    if (unit === 'packet') return value;
    const prefix = (match[2] || match[3] || '').toLowerCase();
    const multiplier =
      prefix === 'g' ? 1e9 : prefix === 'm' ? 1e6 : prefix === 'k' ? 1e3 : 1;
    const isBytes = /bytes?/i.test(match[0]);
    return (value * multiplier) / (isBytes ? 1 : 8);
  };
  return {
    downloadBps: rate('downstream', 'bit'),
    uploadBps: rate('upstream', 'bit'),
    downloadPps: rate('downstream', 'packet'),
    uploadPps: rate('upstream', 'packet'),
  };
}

export function parseHuaweiBoard(text: string): HuaweiOltCard[] {
  const cards: HuaweiOltCard[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || /^(frame|slot|board|[-=]|display)/i.test(line)) continue;
    const m = line.match(
      /^(\d+)\s*(?:\/\s*)?(\d+)?\s+(\S+)\s+(\S+)\s+(\S+)(?:\s+(.+))?$/,
    );
    if (!m || !/^[A-Za-z]{2,}\d*/.test(m[3])) continue;
    const tail = m[6] || '';
    const ports = tail.match(/\b(\d+)\s*(?:port|ports)\b/i);
    const version = tail.match(/\b(V\d[\w.-]*|[A-Z]\d{2,}[\w.-]*)\b/i);
    cards.push({
      rack: m[1],
      shelf: m[2] || '0',
      slot: m[1],
      cfgType: m[3],
      realType: m[4],
      status: m[5],
      role: /\b(main|active|standby|slave|master)\b/i.exec(tail)?.[1] ?? null,
      ports: ports ? Number(ports[1]) : undefined,
      softVer: version?.[1],
    });
  }
  return cards;
}

export function parseHuaweiOntAutofind(text: string): HuaweiUncfgOnu[] {
  const rows: HuaweiUncfgOnu[] = [];
  const seen = new Set<string>();
  let slot: string | null = null;
  let port: string | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const context = raw.match(/(?:gpon\s+)?0\/(\d+)\/(\d+)/i);
    if (context) [slot, port] = [context[1], context[2]];
    const sn = raw.match(/\b(?:SN\s*[:=]?\s*)?([A-Z0-9]{8,20})\b/i);
    if (!sn || /^(display|serial|number|ont)$/i.test(sn[1])) continue;
    const type = raw.match(
      /(?:ont[- ]?type|equipment[- ]?id|type)\s*[:=]\s*([A-Za-z0-9_.-]+)/i,
    );
    const point = raw.match(/\b0\/(\d+)\/(\d+)\b/);
    const currentSlot = point?.[1] || slot;
    const currentPort = point?.[2] || port;
    if (!currentSlot || !currentPort) continue;
    const serial = sn[1].toUpperCase();
    const key = `${currentSlot}/${currentPort}/${serial}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      oltIf: buildHuaweiOltIf(currentSlot, currentPort),
      onuIfHint: null,
      sn: serial,
      onuType: type?.[1] ?? null,
      state: null,
      ponType: 'gpon',
      board: currentSlot,
      port: currentPort,
      suggestedOnuId: null,
    });
  }
  return rows;
}

export function parseHuaweiConnectedOnus(
  text: string,
  oltIfHint?: string,
): HuaweiConnectedOnu[] {
  const rows: HuaweiConnectedOnu[] = [];
  const hinted = oltIfHint ? parseHuaweiOltIf(oltIfHint) : null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const row =
      line.match(/^(?:0\/)?(\d+)\/(\d+)\s+(\d+)\s+(.+)$/) ||
      line.match(/^(\d+)\s+(\S+)\s+(.+)$/);
    if (!row) continue;
    const slot = row.length > 4 ? row[1] : hinted?.slot;
    const port = row.length > 4 ? row[2] : hinted?.port;
    const ontId = row.length > 4 ? row[3] : row[1];
    const rest = row.length > 4 ? row[4] : `${row[2]} ${row[3]}`;
    if (!slot || !port || !/^\d+$/.test(ontId)) continue;
    const state = /\b(online|online\/normal|working|up)\b/i.test(rest)
      ? 'online'
      : /\blos\b/i.test(rest)
        ? 'los'
        : /\boffline|down\b/i.test(rest)
          ? 'offline'
          : 'other';
    const online = state === 'online';
    const sn = rest.match(/\b([A-Z0-9]{8,20})\b/i)?.[1]?.toUpperCase() ?? null;
    const type =
      rest.match(/\b(HG\w+|EG\w+|EchoLife-\S+|[A-Z]{2,}\d[\w.-]*)\b/i)?.[1] ??
      null;
    rows.push({
      onuIf: buildHuaweiOnuIf(slot, port, ontId),
      ponType: 'gpon',
      board: slot,
      port,
      onuId: ontId,
      status: state,
      online,
      phaseState: online ? 'online' : state,
      adminState: /\bdeactivate|disable\b/i.test(rest) ? 'disable' : 'enable',
      sn,
      onuType: type,
      name: null,
      description: null,
      signalDbm: null,
      mode: null,
      vlan: null,
      vlans: [],
    });
  }
  return rows;
}

export function parseHuaweiOpticalSignal(text: string): number | null {
  const match =
    text.match(
      /(?:ont\s+receive\s+optical\s+power|rx\s+optical\s+power|receive\s+power|rx\s+power)\s*[:=]?\s*(-?\d+(?:\.\d+)?)\s*(?:dBm)?/i,
    ) || text.match(/\b(-?\d+(?:\.\d+)?)\s*\(?\s*dBm\)?/i);
  const value = match ? Number(match[1]) : NaN;
  return Number.isFinite(value) && value > -50 && value < 10 ? value : null;
}

export function suggestNextOntId(
  occupiedIds: Array<string | number>,
  maxOnus = 128,
): number | null {
  const used = new Set(
    occupiedIds.map(Number).filter((n) => Number.isInteger(n) && n > 0),
  );
  for (let id = 1; id <= maxOnus; id++) if (!used.has(id)) return id;
  return null;
}
