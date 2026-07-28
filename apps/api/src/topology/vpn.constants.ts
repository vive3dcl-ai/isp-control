export const VPN_PROTOCOLS = [
  'openvpn_tcp',
  'openvpn_udp',
  'wireguard',
] as const;

export type VpnProtocol = (typeof VPN_PROTOCOLS)[number];

export const VPN_PROTOCOL_LABELS: Record<VpnProtocol, string> = {
  openvpn_tcp: 'OpenVPN TCP',
  openvpn_udp: 'OpenVPN UDP',
  wireguard: 'WireGuard',
};

/** SmartOLT-style default LAN routes through the tunnel */
export const DEFAULT_VPN_TUNNEL_ROUTES = [
  '10.0.0.0/8',
  '172.16.0.0/12',
  '192.168.0.0/16',
].join('\n');

/** Defaults; override in production with VPN_PORT_OPENVPN_TCP / _UDP / VPN_PORT_WIREGUARD */
export const DEFAULT_VPN_PORTS: Record<VpnProtocol, number> = {
  openvpn_tcp: 1194,
  openvpn_udp: 1195,
  wireguard: 51820,
};
