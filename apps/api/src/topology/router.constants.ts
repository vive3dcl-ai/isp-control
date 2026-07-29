export const ROUTER_SUBTYPES = ['mikrotik', 'cisco', 'edge_router'] as const;

export type RouterSubtype = (typeof ROUTER_SUBTYPES)[number];

export const ROUTER_SUBTYPE_LABELS: Record<RouterSubtype, string> = {
  mikrotik: 'MikroTik',
  cisco: 'Cisco',
  edge_router: 'Edge Router',
};

/** Default management ports by subtype + protocol */
export const DEFAULT_MGMT_PORTS: Record<string, number> = {
  mikrotik_rest_https: 443,
  mikrotik_api_ssl: 8729,
  mikrotik_winbox: 8291,
  cisco: 22,
  edge_router: 443,
};
