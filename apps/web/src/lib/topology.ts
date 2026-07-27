export const NETWORK_DEVICE_TYPES = [
  'internet',
  'router',
  'switch',
  'olt',
  'server',
  'onu',
  'ont',
  'cpe_router',
] as const

export type NetworkDeviceType = (typeof NETWORK_DEVICE_TYPES)[number]

export const INTERNET_DEVICE_TYPE: NetworkDeviceType = 'internet'

export const CREATABLE_DEVICE_TYPES = NETWORK_DEVICE_TYPES.filter(
  (t) => t !== 'internet',
)

export const deviceTypeLabel: Record<NetworkDeviceType, string> = {
  internet: 'Internet',
  router: 'Router',
  switch: 'Switch',
  olt: 'OLT',
  server: 'Servidor',
  onu: 'ONU',
  ont: 'ONT',
  cpe_router: 'Router CPE',
}

export const ROUTER_SUBTYPES = [
  'mikrotik',
  'cisco',
  'edge_router',
] as const

export type RouterSubtype = (typeof ROUTER_SUBTYPES)[number]

export const routerSubtypeLabel: Record<RouterSubtype, string> = {
  mikrotik: 'MikroTik',
  cisco: 'Cisco',
  edge_router: 'Edge Router',
}

export const OLT_SUBTYPES = [
  'zte_c220',
  'zte_c300',
  'zte_c320',
  'zte_c350',
  'zte_c3xx',
] as const

export type OltSubtype = (typeof OLT_SUBTYPES)[number]

/** Models shown in create/edit form (exact chassis). */
export const OLT_SELECTABLE_SUBTYPES = [
  'zte_c220',
  'zte_c300',
  'zte_c320',
  'zte_c350',
] as const satisfies readonly OltSubtype[]

export const oltSubtypeLabel: Record<OltSubtype, string> = {
  zte_c220: 'ZTE C220',
  zte_c300: 'ZTE C300',
  zte_c320: 'ZTE C320',
  zte_c350: 'ZTE C350 / C350M',
  zte_c3xx: 'ZTE C3xx (sin modelo)',
}

export function isZteOltSubtype(subtype?: string | null): boolean {
  return (
    !!subtype &&
    (OLT_SELECTABLE_SUBTYPES as readonly string[]).includes(subtype)
  )
}

export function isZteOltDevice(type?: string | null, subtype?: string | null) {
  return type === 'olt' && (isZteOltSubtype(subtype) || subtype === 'zte_c3xx')
}

export type OltCardRow = {
  rack: string
  shelf: string
  slot: string
  cfgType: string
  realType: string
  ports: number | null
  softVer: string | null
  status: string
  role: string | null
  infoUpdated: string
}

export type OltCardsResponse = {
  deviceId: string
  probedAt: string
  summary: string | null
  cards: OltCardRow[]
}

export type OltPonPortRow = {
  rack: string
  shelf: string
  slot: string
  port: string
  ifName: string
  boardType: string
  ponType: 'gpon' | 'epon'
  adminEnabled: boolean
  adminState: 'Enabled' | 'Disabled'
  status: 'Up' | 'Down'
  onuOnline: number
  onuTotal: number
  maxOnus: number
  loadPct: number
  avgSignalDbm: number | null
  description: string | null
  minRangeM: number
  maxRangeM: number
  rogueDetectEnabled: boolean | null
  txPowerDbm: number | null
  infoUpdated: string
}

export type OltPonPortsResponse = {
  deviceId: string
  probedAt: string
  summary: string | null
  ports: OltPonPortRow[]
}

export type OltUplinkRow = {
  ifName: string
  description: string | null
  mediaType: 'fiber' | 'copper' | 'unknown'
  mediaTypeLabel: string
  adminEnabled: boolean
  adminState: 'Enabled' | 'Disabled'
  status: string
  negotiation: string | null
  mtu: number | null
  wavelengthNm: number | null
  signalDbm: number | null
  tempC: number | null
  pvidUntag: number | null
  mode: string | null
  taggedVlans: number[]
  taggedVlansLabel: string
  modeVlansLabel: string
  infoUpdated: string
}

export type OltUplinksResponse = {
  deviceId: string
  probedAt: string
  summary: string | null
  uplinks: OltUplinkRow[]
}

export type OltVlanRow = {
  vlanId: number
  description: string | null
  /** Derived from IP pools (+ IPTV from OLT if present). Display only. */
  typeLabel: string
  usedForMgmt: boolean
  usedForInternet: boolean
  usedForIptv: boolean
  /** ONUs de esta VLAN no se ven entre sí */
  isolated: boolean
  onuCount: number
  /** VLAN 1 del sistema ZTE */
  isSystem: boolean
}

export type OltVlansResponse = {
  deviceId: string
  probedAt: string
  summary: string | null
  vlans: OltVlanRow[]
}

export type OltConnectionMode = 'public' | 'secure'

export const oltConnectionModeLabel: Record<OltConnectionMode, string> = {
  public: 'Pública',
  secure: 'VPN',
}

export type ConnectionStatus =
  | 'unknown'
  | 'connected'
  | 'disconnected'
  | 'error'

export const connectionStatusLabel: Record<ConnectionStatus, string> = {
  unknown: 'Sin probar',
  connected: 'Conectado',
  disconnected: 'Desconectado',
  error: 'Error',
}

/** Physical Ethernet link state reported by the device. */
export type PortLinkStatus = 'unknown' | 'up' | 'down' | 'disabled'

export const portLinkStatusLabel: Record<PortLinkStatus, string> = {
  unknown: '—',
  up: 'Up',
  down: 'Down',
  disabled: 'Disabled',
}

export type PortVlanMode = 'tagged' | 'untagged'

export const portVlanModeLabel: Record<PortVlanMode, string> = {
  tagged: 'Tagged',
  untagged: 'Untagged',
}

export interface PortVlanAssignment {
  vlanId: number
  mode: PortVlanMode
  interfaceName?: string
  ipAddresses?: string[]
  comment?: string
}

export interface TopologyPort {
  id: string
  deviceId: string
  name: string
  ipAddress: string | null
  sortOrder: number
  linkStatus?: PortLinkStatus | string
  isSynced?: boolean
  comment?: string | null
  vlans?: PortVlanAssignment[]
  /** All CIDR addresses on the interface */
  ipAddresses?: string[]
  linkId: string | null
  linkedPortId: string | null
  linkedDeviceName?: string | null
  linkedPortName?: string | null
}

export interface TopologyDevice {
  id: string
  name: string
  type: NetworkDeviceType
  subtype?: string | null
  note: string
  isActive: boolean
  mgmtHost?: string | null
  mgmtPort?: number | null
  mgmtUsername?: string | null
  mgmtProtocol?: string | null
  hasPassword?: boolean
  connectionStatus?: ConnectionStatus | string
  lastCheckedAt?: string | null
  lastError?: string | null
  metricCpuLoad?: number | null
  metricFreeMemory?: string | null
  metricTotalMemory?: string | null
  metricUptime?: string | null
  metricIdentity?: string | null
  metricVersion?: string | null
  metricBoardName?: string | null
  metricTemperature?: number | null
  metricSummary?: string | null
  mgmtConnectionMode?: string | null
  snmpCommunity?: string | null
  snmpCommunityRw?: string | null
  snmpPort?: number | null
  /** gpon | epon | gpon_epon — usually auto-detected */
  ponType?: string | null
  /** After connect test: prompt to import ONUs into DB */
  suggestOnuImport?: boolean
  ports: TopologyPort[]
  createdAt?: string
  updatedAt?: string
}

export const OLT_PON_TYPES = ['gpon', 'epon', 'gpon_epon'] as const
export type OltPonType = (typeof OLT_PON_TYPES)[number]

export const oltPonTypeLabel: Record<OltPonType, string> = {
  gpon: 'GPON (GPON, XGPON, XGSPON)',
  epon: 'EPON (EPON, 10G-EPON)',
  gpon_epon: 'GPON+EPON',
}

export function formatBytes(value?: string | number | null) {
  if (value == null || value === '') return '—'
  const n = typeof value === 'string' ? Number(value) : value
  if (!Number.isFinite(n)) return '—'
  const units = ['B', 'KB', 'MB', 'GB']
  let v = n
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

export interface TopologyLink {
  id: string
  portAId: string
  portBId: string
}

export interface TopologyGraph {
  devices: TopologyDevice[]
  links: TopologyLink[]
}

export interface PortCandidateDevice {
  id: string
  name: string
  type: NetworkDeviceType
  ports: Array<{
    id: string
    name: string
    ipAddress: string | null
    sortOrder: number
  }>
}

export const CRM_WRITE_ROLES = ['owner', 'admin', 'administrativo'] as const

export function canWriteTopology(tenantRole?: string | null) {
  return (
    !!tenantRole &&
    (CRM_WRITE_ROLES as readonly string[]).includes(tenantRole)
  )
}

/** BFS layered layout from core devices; returns pixel positions. */
export function layoutTopology(
  devices: TopologyDevice[],
  links: TopologyLink[],
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>()
  if (devices.length === 0) return positions

  const portToDevice = new Map<string, string>()
  for (const d of devices) {
    for (const p of d.ports) portToDevice.set(p.id, d.id)
  }

  const adj = new Map<string, Set<string>>()
  for (const d of devices) adj.set(d.id, new Set())
  for (const link of links) {
    const a = portToDevice.get(link.portAId)
    const b = portToDevice.get(link.portBId)
    if (!a || !b || a === b) continue
    adj.get(a)!.add(b)
    adj.get(b)!.add(a)
  }

  const coreTypes = new Set<NetworkDeviceType>([
    'internet',
    'router',
    'olt',
    'server',
  ])
  const visited = new Set<string>()
  const layers: string[][] = []

  const internet = devices.find((d) => d.type === 'internet')
  const otherRoots = devices
    .filter((d) => coreTypes.has(d.type) && d.type !== 'internet')
    .sort((a, b) => a.name.localeCompare(b.name))
  const startIds =
    internet || otherRoots.length > 0
      ? [
          ...(internet ? [internet.id] : []),
          ...otherRoots.map((r) => r.id),
        ]
      : [devices.slice().sort((a, b) => a.name.localeCompare(b.name))[0].id]

  // Prefer BFS from Internet alone so it sits on the leftmost layer
  const queue: Array<{ id: string; depth: number }> = []
  if (internet) {
    visited.add(internet.id)
    queue.push({ id: internet.id, depth: 0 })
  } else {
    for (const id of startIds) {
      if (!visited.has(id)) {
        visited.add(id)
        queue.push({ id, depth: 0 })
      }
    }
  }

  // Also seed disconnected components
  for (const d of devices) {
    if (!visited.has(d.id) && (adj.get(d.id)?.size ?? 0) === 0) {
      // leave for later pass
    }
  }

  while (queue.length > 0) {
    const { id, depth } = queue.shift()!
    if (!layers[depth]) layers[depth] = []
    layers[depth].push(id)
    for (const n of adj.get(id) ?? []) {
      if (!visited.has(n)) {
        visited.add(n)
        queue.push({ id: n, depth: depth + 1 })
      }
    }
  }

  // Remaining disconnected nodes
  const rest = devices
    .filter((d) => !visited.has(d.id))
    .sort((a, b) => a.name.localeCompare(b.name))
  if (rest.length > 0) {
    const depth = layers.length
    layers[depth] = rest.map((d) => d.id)
  }

  const colGap = 180
  const rowGap = 100
  const padX = 80
  const padY = 60

  for (let depth = 0; depth < layers.length; depth++) {
    const row = layers[depth]
    const totalH = (row.length - 1) * rowGap
    const startY = padY + Math.max(0, (300 - totalH) / 2)
    row.forEach((id, i) => {
      positions.set(id, {
        x: padX + depth * colGap,
        y: startY + i * rowGap,
      })
    })
  }

  return positions
}
