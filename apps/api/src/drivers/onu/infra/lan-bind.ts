/**
 * Bind LAN/Wi‑Fi a la WAN de internet (TR-098).
 *
 * Cada vendor publica otra hoja:
 *  - Huawei: X_HW_LANBIND.LanNEnable / SSIDNEnable (unsignedInt)
 *  - FiberHome / CT-COM: lista de paths en X_FH_LanInterface / X_CT-COM_LanInterface
 *  - Tenda: tokens LAN1… / WLANn-APm en X_TDTC_LanInterfaceBind
 *
 * Un boolean `true` (bug del genérico FiberHome) no liga nada.
 * IPTV: no reinyectar puertos eth que ya están en otra WAN.
 */
import {
  genieChildIndices,
  genieGet,
  genieNodeExists,
  strVal,
} from '../../../topology/shared/genieacs-nbi.client';
/** 4×GE + SSID 2.4 + 5 GHz (HG6143D / HG6244C). */
export const FH_HG6143D_DEFAULT_LAN_BIND = [
  'InternetGatewayDevice.LANDevice.1.LANEthernetInterfaceConfig.1',
  'InternetGatewayDevice.LANDevice.1.LANEthernetInterfaceConfig.2',
  'InternetGatewayDevice.LANDevice.1.LANEthernetInterfaceConfig.3',
  'InternetGatewayDevice.LANDevice.1.LANEthernetInterfaceConfig.4',
  'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1',
  'InternetGatewayDevice.LANDevice.1.WLANConfiguration.5',
].join(',');

/** Bind LAN+Wi‑Fi Tenda HG9 (tokens, no paths TR-098). */
export const TENDA_HG9_DEFAULT_LAN_BIND = [
  'LAN1',
  'LAN2',
  'LAN3',
  'LAN4',
  'WLAN0-AP1',
  'WLAN0-AP2',
  'WLAN0-AP3',
  'WLAN0-AP4',
  'WLAN1-AP1',
  'WLAN1-AP2',
  'WLAN1-AP3',
  'WLAN1-AP4',
].join(',');

export type LanBindSpv = [string, string | number | boolean, string];

export type LanBindAssessment = {
  ok: boolean;
  /** Sin hoja ACS: el bind lo pone OMCI / no aplica. */
  skip: boolean;
  message: string;
  current?: string;
  heal?: LanBindSpv[];
};

const WAN_DEV = 'InternetGatewayDevice.WANDevice';
const LAN_DEV = 'InternetGatewayDevice.LANDevice.1';
const BROKEN_SCALAR = /^(true|false|1|0)$/i;

function parseList(raw: string | null | undefined): string[] {
  return String(raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function joinList(tokens: string[]): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tokens) {
    const x = t.trim();
    if (!x || seen.has(x)) continue;
    seen.add(x);
    out.push(x);
  }
  return out.join(',');
}

function isBrokenScalar(raw: string | null | undefined): boolean {
  const t = (raw ?? '').trim();
  return !t || BROKEN_SCALAR.test(t);
}

function tokenKind(t: string): 'lan' | 'wlan' | 'other' {
  if (/LANEthernetInterfaceConfig/i.test(t) || /^LAN\d+$/i.test(t)) {
    return 'lan';
  }
  if (/WLANConfiguration/i.test(t) || /WLAN/i.test(t)) return 'wlan';
  return 'other';
}

function hasKind(tokens: string[], kind: 'lan' | 'wlan'): boolean {
  return tokens.some((t) => tokenKind(t) === kind);
}

/** Lista de bind (FiberHome/Tenda/CT-COM) con LAN y Wi‑Fi reales. */
export function lanWifiStringBindOk(raw: string | null | undefined): boolean {
  if (isBrokenScalar(raw)) return false;
  const tokens = parseList(raw);
  return hasKind(tokens, 'lan') && hasKind(tokens, 'wlan');
}

function enabledFlag(raw: string | null): boolean | null {
  if (raw == null || raw === '') return null;
  const s = raw.toLowerCase();
  if (s === '1' || s === 'true') return true;
  if (s === '0' || s === 'false') return false;
  return null;
}

function peerBoundTokens(
  device: Record<string, unknown>,
  skipConn: string,
): Set<string> {
  const out = new Set<string>();
  for (const wd of genieChildIndices(device, WAN_DEV)) {
    const cdBase = `${WAN_DEV}.${wd}.WANConnectionDevice`;
    for (const cd of genieChildIndices(device, cdBase)) {
      const ipBase = `${cdBase}.${cd}.WANIPConnection`;
      for (const ip of genieChildIndices(device, ipBase)) {
        const conn = `${ipBase}.${ip}`;
        if (conn === skipConn) continue;
        const raw =
          strVal(genieGet(device, `${conn}.X_FH_LanInterface`)) ??
          strVal(genieGet(device, `${conn}.X_CT-COM_LanInterface`)) ??
          strVal(genieGet(device, `${conn}.X_TDTC_LanInterfaceBind`));
        if (isBrokenScalar(raw)) continue;
        for (const t of parseList(raw)) out.add(t);
      }
    }
  }
  return out;
}

function discoverEthPaths(device: Record<string, unknown>): string[] {
  return genieChildIndices(device, `${LAN_DEV}.LANEthernetInterfaceConfig`).map(
    (n) => `${LAN_DEV}.LANEthernetInterfaceConfig.${n}`,
  );
}

function discoverWlanPaths(device: Record<string, unknown>): string[] {
  return genieChildIndices(device, `${LAN_DEV}.WLANConfiguration`).map(
    (n) => `${LAN_DEV}.WLANConfiguration.${n}`,
  );
}

function defaultPathBind(
  device: Record<string, unknown>,
  peer: Set<string>,
): string {
  const eth = discoverEthPaths(device);
  const wlan = discoverWlanPaths(device);
  const fromTree = [...(eth.length ? eth : []), ...(wlan.length ? wlan : [])];
  const fallback = parseList(FH_HG6143D_DEFAULT_LAN_BIND);
  const base = fromTree.length ? fromTree : fallback;
  return joinList(base.filter((t) => !peer.has(t)));
}

function assessStringBind(opts: {
  leaf: string;
  raw: string | null;
  device: Record<string, unknown>;
  conn: string;
  tenda: boolean;
}): LanBindAssessment {
  const { leaf, raw, device, conn, tenda } = opts;
  const peer = peerBoundTokens(device, conn);
  const broken = isBrokenScalar(raw);
  const tokens = broken ? [] : parseList(raw);
  const lanOk = hasKind(tokens, 'lan');
  const wlanOk = hasKind(tokens, 'wlan');
  if (!broken && lanOk && wlanOk) {
    return {
      ok: true,
      skip: false,
      message: tokens.length > 40 ? `${tokens.length} ifaces` : tokens.join(','),
      current: raw ?? '',
    };
  }

  const next = [...tokens];
  if (tenda) {
    const want = parseList(TENDA_HG9_DEFAULT_LAN_BIND).filter((t) => !peer.has(t));
    for (const t of want) {
      if (!next.includes(t)) next.push(t);
    }
  } else {
    const want = parseList(defaultPathBind(device, peer));
    if (!lanOk) {
      for (const t of want) {
        if (tokenKind(t) === 'lan' && !next.includes(t)) next.push(t);
      }
    }
    if (!wlanOk) {
      for (const t of want) {
        if (tokenKind(t) === 'wlan' && !next.includes(t)) next.push(t);
      }
    }
    if (broken && !next.length) {
      next.push(...want);
    }
  }

  const expected = joinList(next);
  const why = broken
    ? `bind inválido (${raw?.trim() || 'vacío'})`
    : !lanOk
      ? 'LAN sin bind a internet'
      : 'Wi‑Fi sin bind a internet';
  return {
    ok: false,
    skip: false,
    message: why,
    current: raw ?? '',
    heal: [[leaf, expected, 'xsd:string']],
  };
}

function assessHuaweiBind(
  device: Record<string, unknown>,
  conn: string,
): LanBindAssessment {
  const root = `${conn}.X_HW_LANBIND`;
  if (!genieNodeExists(device, root)) {
    return { ok: true, skip: true, message: 'sin X_HW_LANBIND' };
  }

  const lanLeaves: Array<{ path: string; on: boolean | null }> = [];
  const ssidLeaves: Array<{ path: string; on: boolean | null }> = [];
  for (const n of [1, 2, 3, 4]) {
    const path = `${root}.Lan${n}Enable`;
    if (!genieNodeExists(device, path)) continue;
    lanLeaves.push({
      path,
      on: enabledFlag(strVal(genieGet(device, path))),
    });
  }
  for (const n of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const path = `${root}.SSID${n}Enable`;
    if (!genieNodeExists(device, path)) continue;
    ssidLeaves.push({
      path,
      on: enabledFlag(strVal(genieGet(device, path))),
    });
  }

  const lanOn = lanLeaves.some((l) => l.on === true);
  const ssidOn = ssidLeaves.some((l) => l.on === true);
  const lanKnown = lanLeaves.length > 0;
  const ssidKnown = ssidLeaves.length > 0;

  if ((!lanKnown || lanOn) && (!ssidKnown || ssidOn)) {
    const nLan = lanLeaves.filter((l) => l.on === true).length;
    const nSsid = ssidLeaves.filter((l) => l.on === true).length;
    return {
      ok: true,
      skip: false,
      message: `LAN ${nLan}/${lanLeaves.length || 4} · SSID ${nSsid}/${ssidLeaves.length || 0}`,
    };
  }

  const heal: LanBindSpv[] = [];
  const u = 'xsd:unsignedInt';
  if (lanKnown && !lanOn) {
    for (const l of lanLeaves) heal.push([l.path, 1, u]);
  }
  if (ssidKnown && !ssidOn) {
    for (const l of ssidLeaves) heal.push([l.path, 1, u]);
  }
  if (!heal.length) {
    for (const n of [1, 2, 3, 4]) {
      heal.push([`${root}.Lan${n}Enable`, 1, u]);
    }
    for (const n of [1, 2, 3, 4]) {
      heal.push([`${root}.SSID${n}Enable`, 1, u]);
    }
  }

  const why =
    lanKnown && !lanOn
      ? 'LAN sin bind a internet'
      : 'Wi‑Fi sin bind a internet';
  return { ok: false, skip: false, message: why, heal };
}

export function assessServiceLanBind(
  device: Record<string, unknown>,
  conn: string | null | undefined,
): LanBindAssessment {
  if (!conn) {
    return { ok: false, skip: false, message: 'sin WAN de servicio' };
  }

  if (genieNodeExists(device, `${conn}.X_HW_LANBIND`)) {
    return assessHuaweiBind(device, conn);
  }

  const tendaLeaf = `${conn}.X_TDTC_LanInterfaceBind`;
  if (genieNodeExists(device, tendaLeaf)) {
    return assessStringBind({
      leaf: tendaLeaf,
      raw: strVal(genieGet(device, tendaLeaf)),
      device,
      conn,
      tenda: true,
    });
  }

  const fhLeaf = `${conn}.X_FH_LanInterface`;
  if (genieNodeExists(device, fhLeaf)) {
    return assessStringBind({
      leaf: fhLeaf,
      raw: strVal(genieGet(device, fhLeaf)),
      device,
      conn,
      tenda: false,
    });
  }

  const ctLeaf = `${conn}.X_CT-COM_LanInterface`;
  if (genieNodeExists(device, ctLeaf)) {
    return assessStringBind({
      leaf: ctLeaf,
      raw: strVal(genieGet(device, ctLeaf)),
      device,
      conn,
      tenda: false,
    });
  }

  return {
    ok: true,
    skip: true,
    message: 'sin hoja de bind ACS',
  };
}
