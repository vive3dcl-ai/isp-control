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

/**
 * Tunnel subnets live in 10.69.0.0/16, split per transport: the OpenVPN TCP and
 * UDP servers need disjoint pools so their tun devices never install the same
 * kernel route. WireGuard peers get /24s out of the TCP half (wg0 routes are
 * more specific, so they win over the tun0 pool route).
 */
export const VPN_TUNNEL_THIRD_OCTET_RANGES: Record<
  VpnProtocol,
  { first: number; last: number }
> = {
  openvpn_tcp: { first: 1, last: 126 },
  wireguard: { first: 1, last: 126 },
  openvpn_udp: { first: 129, last: 254 },
};

/** OpenVPN server pools matching the ranges above (see concentrator entrypoint). */
export const VPN_OPENVPN_SERVER_POOLS: Record<
  'openvpn_tcp' | 'openvpn_udp',
  { network: string; mask: string }
> = {
  openvpn_tcp: { network: '10.69.0.0', mask: '255.255.128.0' },
  openvpn_udp: { network: '10.69.128.0', mask: '255.255.128.0' },
};
