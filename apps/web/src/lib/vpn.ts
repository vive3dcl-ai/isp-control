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

export const vpnStatusLabel: Record<string, string> = {
  pending: 'Pendiente',
  configured: 'Configurado',
  connected: 'Conectado',
  online: 'Conectado',
  offline: 'Desconectado',
}

export const DEFAULT_VPN_ROUTES = `10.0.0.0/8
172.16.0.0/12
192.168.0.0/16`

export interface VpnTunnel {
  id: string
  name: string
  protocol: string
  protocolLabel?: string
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
  expiresInSeconds: number
  endpoint: { host: string; port: number }
  script: string
  /** Suggested ACS URL for TR069 via concentrator (serverAddress) */
  acsUrlHint?: string | null
  bootstrap: string | null
  fetchUrl: string | null
  note: string
}
