export const VPN_PROTOCOLS = [
  'openvpn_tcp',
  'openvpn_udp',
  'wireguard',
] as const

export type VpnProtocol = (typeof VPN_PROTOCOLS)[number]

export const vpnProtocolLabel: Record<VpnProtocol, string> = {
  openvpn_tcp: 'OpenVPN TCP',
  openvpn_udp: 'OpenVPN UDP',
  wireguard: 'WireGuard',
}

export const VPN_MODES = ['outbound', 'reverse'] as const

export type VpnMode = (typeof VPN_MODES)[number]

export const vpnModeLabel: Record<VpnMode, string> = {
  outbound: 'Concentrador (MikroTik cliente)',
  reverse: 'Inverso lab TR069 (MikroTik servidor)',
}

export const DEFAULT_VPN_ROUTES = `10.0.0.0/8
172.16.0.0/12
192.168.0.0/16`

export interface VpnTunnel {
  id: string
  name: string
  protocol: string
  protocolLabel?: string
  mode?: string
  modeLabel?: string
  endpointHost?: string | null
  tunnelSubnet: string
  clientAddress: string
  serverAddress: string
  tunnelRoutes: string
  status: string
  hasPassword?: boolean
  hasWgKeys?: boolean
  setupTokenValid?: boolean
  lastImportedDeviceId?: string | null
  lastImportedAt?: string | null
  note?: string | null
  createdAt?: string
  updatedAt?: string
}

export interface VpnSetupPayload {
  tunnel: VpnTunnel
  protocolLabel: string
  mode?: string
  modeLabel?: string
  expiresInSeconds: number
  endpoint: { host: string; port: number }
  script: string
  /** Reverse mode: OpenVPN client config for the local ACS host */
  acsClientConfig?: string | null
  /** Suggested ACS URL for TR069 (reverse → clientAddress) */
  acsUrlHint?: string | null
  bootstrap: string | null
  fetchUrl: string | null
  /** WireGuard outbound: bloque [Peer] para el concentrador */
  concentratorPeerConfig?: string | null
  /** WireGuard outbound: wg set + ip address en el concentrador */
  concentratorApplyCommands?: string | null
  /** OpenVPN outbound: CCD + credenciales para el concentrador */
  concentratorOpenVpnConfig?: string | null
  /** OpenVPN outbound: comandos si el concentrador es MikroTik */
  concentratorOpenVpnMikrotik?: string | null
  note: string
}
