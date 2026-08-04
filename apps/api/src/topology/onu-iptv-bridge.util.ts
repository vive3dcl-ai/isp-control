/**
 * FiberHome IPTV bridge helpers (TR-069 WAN IP_Bridged + X_FH_LanInterface).
 * Never treat INTERNET / TR069 / VOIP routed WANs as IPTV bridges.
 */

export const IPTV_BRIDGE_NAME_PREFIX = 'ISPCTRL_IPTV';

export type FhWanConn = {
  path: string;
  cdIndex: number;
  ipIndex: number;
  name: string;
  type: string;
  vlanId: number | null;
  serviceList: string;
  lanInterface: string;
  addressingType: string;
  externalIp: string;
};

export function lanEthPath(portIndex: number): string {
  return `InternetGatewayDevice.LANDevice.1.LANEthernetInterfaceConfig.${portIndex}`;
}

export function parseLanInterfaceList(raw: string | null | undefined): string[] {
  return String(raw || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function joinLanInterfaceList(paths: string[]): string {
  // Stable unique order
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of paths) {
    const t = p.trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out.join(',');
}

export function isProtectedWan(w: Pick<FhWanConn, 'name' | 'type' | 'serviceList'>): boolean {
  const blob = `${w.name}|${w.serviceList}|${w.type}`;
  if (/TR069|INTERNET|VOIP|VOICE/i.test(w.serviceList)) return true;
  if (/TR069|INTERNET_R_|_TR069_/i.test(w.name)) return true;
  if (/IP_Routed/i.test(w.type) && /INTERNET/i.test(blob)) return true;
  return false;
}

export function isIptvBridgeWan(w: FhWanConn): boolean {
  if (!/Bridged/i.test(w.type)) return false;
  if (isProtectedWan(w)) return false;
  if (new RegExp(`^${IPTV_BRIDGE_NAME_PREFIX}`, 'i').test(w.name)) return true;
  if (/IPTV_B_VID|ISPCTRL_IPTV/i.test(w.name)) return true;
  if (/^(OTHER|IPTV)$/i.test(w.serviceList.trim())) return true;
  return false;
}

export function iptvBridgeName(vlanId?: number | null): string {
  if (vlanId != null && Number.isFinite(vlanId) && vlanId > 0) {
    return `${IPTV_BRIDGE_NAME_PREFIX}_B_VID_${vlanId}`;
  }
  return `${IPTV_BRIDGE_NAME_PREFIX}_BRIDGE`;
}

export function removeLanPort(
  lanList: string[],
  portIndex: number,
): string[] {
  const eth = lanEthPath(portIndex);
  return lanList.filter(
    (p) => p !== eth && !p.endsWith(`.LANEthernetInterfaceConfig.${portIndex}`),
  );
}

export function addLanPort(lanList: string[], portIndex: number): string[] {
  const eth = lanEthPath(portIndex);
  if (lanList.includes(eth)) return lanList;
  return [...lanList, eth];
}

export function boundEthPortsFromWan(w: FhWanConn): number[] {
  const out: number[] = [];
  for (const p of parseLanInterfaceList(w.lanInterface)) {
    const m = p.match(/LANEthernetInterfaceConfig\.(\d+)/i);
    if (m) out.push(Number(m[1]));
  }
  return out.sort((a, b) => a - b);
}
