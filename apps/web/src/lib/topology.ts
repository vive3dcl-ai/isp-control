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

export const SWITCH_SUBTYPES = [
  'generic',
  'mikrotik_routeros',
  'mikrotik_swos',
] as const

export type SwitchSubtype = (typeof SWITCH_SUBTYPES)[number]

export const switchSubtypeLabel: Record<SwitchSubtype, string> = {
  generic: 'Genérico',
  mikrotik_routeros: 'MikroTik RouterOS',
  mikrotik_swos: 'MikroTik SwitchOS',
}

export const SWITCH_VENDORS = ['generic', 'mikrotik'] as const
export type SwitchVendor = (typeof SWITCH_VENDORS)[number]

export const switchVendorLabel: Record<SwitchVendor, string> = {
  generic: 'Genérico',
  mikrotik: 'MikroTik',
}

export const SWITCH_MIKROTIK_OS = ['routeros', 'swos'] as const
export type SwitchMikrotikOs = (typeof SWITCH_MIKROTIK_OS)[number]

export const switchMikrotikOsLabel: Record<SwitchMikrotikOs, string> = {
  routeros: 'RouterOS',
  swos: 'SwitchOS',
}

export function switchSubtypeFromUi(
  vendor: SwitchVendor,
  os?: SwitchMikrotikOs | null,
): SwitchSubtype {
  if (vendor === 'generic') return 'generic'
  return os === 'swos' ? 'mikrotik_swos' : 'mikrotik_routeros'
}

export function switchVendorFromSubtype(
  subtype?: string | null,
): SwitchVendor {
  if (subtype === 'mikrotik_routeros' || subtype === 'mikrotik_swos') {
    return 'mikrotik'
  }
  return 'generic'
}

export function switchOsFromSubtype(
  subtype?: string | null,
): SwitchMikrotikOs | null {
  if (subtype === 'mikrotik_swos') return 'swos'
  if (subtype === 'mikrotik_routeros') return 'routeros'
  return null
}

export function isMikrotikRouterOsDevice(
  type?: string | null,
  subtype?: string | null,
): boolean {
  if (type === 'router' && subtype === 'mikrotik') return true
  if (type === 'switch' && subtype === 'mikrotik_routeros') return true
  return false
}

export function isMikrotikSwosDevice(
  type?: string | null,
  subtype?: string | null,
): boolean {
  return type === 'switch' && subtype === 'mikrotik_swos'
}

export function isManagedSwitch(
  type?: string | null,
  subtype?: string | null,
): boolean {
  return (
    type === 'switch' &&
    (subtype === 'mikrotik_routeros' || subtype === 'mikrotik_swos')
  )
}

export const ZTE_SELECTABLE_SUBTYPES = [
  'zte_c220',
  'zte_c300',
  'zte_c320',
  'zte_c350',
  'zte_c610',
  'zte_c620',
  'zte_c650',
  'zte_c600',
  'zte_c680',
] as const

export const ZTE_C3XX_SUBTYPES = [
  'zte_c220',
  'zte_c300',
  'zte_c320',
  'zte_c350',
] as const

export const ZTE_C6XX_SUBTYPES = [
  'zte_c610',
  'zte_c620',
  'zte_c650',
  'zte_c600',
  'zte_c680',
] as const

export const HUAWEI_SELECTABLE_SUBTYPES = [
  'huawei_ma5608t',
  'huawei_ma5683t',
  'huawei_ma5680t',
  'huawei_ma5800_x2',
  'huawei_ma5800_x7',
  'huawei_ma5800_x15',
  'huawei_ma5800_x17',
] as const

export const OLT_SUBTYPES = [
  ...ZTE_SELECTABLE_SUBTYPES,
  'zte_c3xx',
  ...HUAWEI_SELECTABLE_SUBTYPES,
] as const

export type OltSubtype = (typeof OLT_SUBTYPES)[number]
export type ZteSelectableSubtype = (typeof ZTE_SELECTABLE_SUBTYPES)[number]
export type HuaweiSelectableSubtype =
  (typeof HUAWEI_SELECTABLE_SUBTYPES)[number]

/** Models shown in create/edit form (exact chassis). */
export const OLT_SELECTABLE_SUBTYPES = [
  ...ZTE_SELECTABLE_SUBTYPES,
  ...HUAWEI_SELECTABLE_SUBTYPES,
] as const satisfies readonly OltSubtype[]

export type OltSelectableSubtype = (typeof OLT_SELECTABLE_SUBTYPES)[number]
export type OltVendor = 'zte' | 'huawei'

export const oltSubtypeLabel: Record<OltSubtype, string> = {
  zte_c220: 'ZTE C220',
  zte_c300: 'ZTE C300',
  zte_c320: 'ZTE C320',
  zte_c350: 'ZTE C350 / C350M',
  zte_c610: 'ZTE C610 (Titan)',
  zte_c620: 'ZTE C620 (Titan)',
  zte_c650: 'ZTE C650 (Titan)',
  zte_c600: 'ZTE C600 (Titan)',
  zte_c680: 'ZTE C680 (Titan)',
  zte_c3xx: 'ZTE C3xx (sin modelo)',
  huawei_ma5608t: 'Huawei MA5608T',
  huawei_ma5683t: 'Huawei MA5683T',
  huawei_ma5680t: 'Huawei MA5680T / MA5600T',
  huawei_ma5800_x2: 'Huawei MA5800-X2',
  huawei_ma5800_x7: 'Huawei MA5800-X7',
  huawei_ma5800_x15: 'Huawei MA5800-X15',
  huawei_ma5800_x17: 'Huawei MA5800-X17',
}

export function isZteOltSubtype(subtype?: string | null): boolean {
  return (
    !!subtype &&
    ((ZTE_SELECTABLE_SUBTYPES as readonly string[]).includes(subtype) ||
      subtype === 'zte_c3xx')
  )
}

export function isZteC6xxSubtype(subtype?: string | null): boolean {
  return (
    !!subtype && (ZTE_C6XX_SUBTYPES as readonly string[]).includes(subtype)
  )
}

export function isZteC3xxSubtype(subtype?: string | null): boolean {
  return (
    !!subtype &&
    ((ZTE_C3XX_SUBTYPES as readonly string[]).includes(subtype) ||
      subtype === 'zte_c3xx')
  )
}

export function isHuaweiOltSubtype(subtype?: string | null): boolean {
  return (
    !!subtype &&
    (HUAWEI_SELECTABLE_SUBTYPES as readonly string[]).includes(subtype)
  )
}

export function isZteOltDevice(type?: string | null, subtype?: string | null) {
  return type === 'olt' && isZteOltSubtype(subtype)
}

export function isHuaweiOltDevice(
  type?: string | null,
  subtype?: string | null,
) {
  return type === 'olt' && isHuaweiOltSubtype(subtype)
}

export function isManagedOltDevice(
  type?: string | null,
  subtype?: string | null,
) {
  return isZteOltDevice(type, subtype) || isHuaweiOltDevice(type, subtype)
}

export function oltVendor(
  type?: string | null,
  subtype?: string | null,
): OltVendor | null {
  if (isHuaweiOltDevice(type, subtype)) return 'huawei'
  if (isZteOltDevice(type, subtype)) return 'zte'
  return null
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
  /** Last CLI sync of PON config (stable until next Sincronizar). */
  syncedAt?: string | null
  summary: string | null
  source?: string
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
  syncedAt?: string | null
  summary: string | null
  source?: string
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
  syncedAt?: string | null
  summary: string | null
  source?: string
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
  technicianMode?: boolean
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
  /** Last SNMP RO probe summary (from connection test / metricSummary). */
  snmpMonitor?: { ok: boolean; error?: string } | null
  /** gpon | epon | gpon_epon — usually auto-detected */
  ponType?: string | null
  /** Puerto físico de salida a Internet (RouterOS). */
  internetEgressPortName?: string | null
  /** VLAN sobre ese puerto; null = interfaz física. */
  internetEgressVlanId?: number | null
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

// Geometría del plano. Vive acá porque el layout de columnas y el de la
// expansión PON (TopologyPage) tienen que coincidir.
export const NODE_W = 100
export const NODE_H = 56
export const CLOUD_W = 120
export const CLOUD_H = 72

export const PON_W = 58
export const PON_H = 20
export const PON_OFFSET_X = 60
export const PON_BLOCK_GAP = 12
export const PON_DOTS_GAP = 18
export const ONU_COLS = 10
export const DOT_GAP = 15
export const DOT_R = 5

/** Ancho total que ocupa una OLT con sus puertos PON y sus ONUs desplegadas. */
export const PON_EXPANSION_W =
  NODE_W + PON_OFFSET_X + PON_W + PON_DOTS_GAP + ONU_COLS * DOT_GAP

/** El primer puerto PON arranca a la altura del centro de la OLT. */
export const PON_ANCHOR_DY = NODE_H / 2 - PON_H / 2

/**
 * BFS layered layout from core devices; returns pixel positions.
 * `clusterHeights` es el alto que cada equipo despliega hacia abajo a su
 * derecha (las ONUs de una OLT), medido desde el borde superior del nodo.
 */
export function layoutTopology(
  devices: TopologyDevice[],
  links: TopologyLink[],
  clusterHeights?: Map<string, number>,
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

  // Todavía sin enlaces: no tienen lugar en el grafo, van a una fila aparte
  // debajo de todo (ver más abajo).
  const unlinked = devices
    .filter((d) => !visited.has(d.id))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((d) => d.id)

  const colGap = 180
  const rowGap = 100
  const padX = 80
  const padY = 60
  const rowPad = rowGap - NODE_H
  const clusterPadX = 40
  const clusterPadY = 24
  const clusterH = (id: string) => clusterHeights?.get(id) ?? 0

  // El clúster de ONUs cuelga hacia abajo y a la derecha de la OLT. Por eso la
  // OLT baja al final de su fila y las columnas siguientes solo se corren si
  // realmente caerían encima: así el resto del plano queda compacto.
  const clusters: Array<{ x1: number; y1: number; x2: number; y2: number }> = []
  let x = padX
  for (let depth = 0; depth < layers.length; depth++) {
    const row = (layers[depth] ?? [])
      .slice()
      .sort((a, b) => (clusterH(a) ? 1 : 0) - (clusterH(b) ? 1 : 0))

    // El centrado usa solo el alto de los nodos: el clúster crece hacia abajo,
    // no hay nada que equilibrar arriba.
    const nodesH = rowGap * row.length - rowPad
    let cursorY = padY + Math.max(0, (300 - nodesH) / 2)
    const hasLaterColumns = depth < layers.length - 1
    const ys = row.map((id, i) => {
      // Las ONUs quedan bien por debajo de la línea principal del plano, así
      // los equipos aguas abajo siguen en su columna en vez de irse al final.
      if (clusterH(id) && (i > 0 || hasLaterColumns)) cursorY += rowGap
      const y = cursorY
      cursorY += Math.max(NODE_H, clusterH(id)) + rowPad
      return y
    })

    for (let guard = 0; guard < 4; guard++) {
      let shifted = x
      row.forEach((_, i) => {
        for (const c of clusters) {
          const hits =
            x < c.x2 + clusterPadX &&
            c.x1 < x + NODE_W &&
            ys[i] < c.y2 &&
            c.y1 - clusterPadY < ys[i] + NODE_H
          if (hits) shifted = Math.max(shifted, c.x2 + clusterPadX)
        }
      })
      if (shifted === x) break
      x = shifted
    }

    row.forEach((id, i) => {
      positions.set(id, { x, y: ys[i] })
      const h = clusterH(id)
      if (h > 0) {
        clusters.push({
          x1: x + NODE_W + PON_OFFSET_X,
          y1: ys[i] + PON_ANCHOR_DY,
          x2: x + PON_EXPANSION_W + 2 * DOT_R,
          y2: ys[i] + h,
        })
      }
    })

    x += colGap
  }

  if (unlinked.length > 0) {
    let bottom = padY
    for (const p of positions.values()) bottom = Math.max(bottom, p.y + NODE_H)
    for (const c of clusters) bottom = Math.max(bottom, c.y2)
    const startY = bottom + 90
    unlinked.forEach((id, i) => {
      positions.set(id, {
        x: padX + (i % 6) * colGap,
        y: startY + Math.floor(i / 6) * rowGap,
      })
    })
  }

  return positions
}
