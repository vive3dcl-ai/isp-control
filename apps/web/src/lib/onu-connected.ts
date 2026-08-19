/** Sanitize text for ZTE ONU `name` / labels (ASCII; sin `+` / `-` / comillas). */
export function sanitizeOltLabel(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[+\-]/g, ' ')
    .replace(/["'`\\<>|]/g, '')
    .replace(/[^A-Za-z0-9 @#$&()._/,\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * OLT ONU display name: «Cliente Servicio» (solo espacios).
 * El guion `-` lo rechaza la OLT; comillas no hacen falta.
 */
export function oltOnuName(clientName: string, serviceName: string): string {
  const client = sanitizeOltLabel(clientName)
  const service = sanitizeOltLabel(serviceName)
  return [client, service].filter(Boolean).join(' ').slice(0, 60)
}

/** OLT `description` from service coordinates (preferred). */
export function onuDescriptionFromCoords(
  lat?: number | null,
  lng?: number | null,
): string | null {
  if (
    lat == null ||
    lng == null ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng)
  ) {
    return null
  }
  return `${lat.toFixed(6)}, ${lng.toFixed(6)}`.slice(0, 200)
}

/** Fallback OLT `description` from install address (street / city / zip). */
export function onuDescriptionFromAddress(parts: {
  street?: string | null
  city?: string | null
  zipCode?: string | null
}): string | null {
  const addr = [parts.street, parts.city, parts.zipCode]
    .map((s) => (s ?? '').trim())
    .filter(Boolean)
    .join(', ')
  if (!addr) return null
  return sanitizeOltLabel(`dirección - ${addr}`).slice(0, 200)
}

/** Prefer coords; fall back to address so the ONU still gets a comment. */
export function onuDescriptionForService(parts: {
  latitude?: number | null
  longitude?: number | null
  street?: string | null
  city?: string | null
  zipCode?: string | null
}): string | null {
  return (
    onuDescriptionFromCoords(parts.latitude, parts.longitude) ??
    onuDescriptionFromAddress(parts)
  )
}

export type ConnectedOnu = {
  id: string
  oltId: string
  oltName: string
  onuIf: string
  ponType: 'gpon' | 'epon' | string
  board: string
  port: string
  onuId: string
  status: string
  online: boolean
  phaseState: string
  adminState: string
  sn: string | null
  onuType: string | null
  name: string | null
  description: string | null
  signalDbm: number | null
  mode: 'bridge' | 'router' | null
  vlan: number | null
  vlans: number[]
  zone: string | null
  /** Catálogo CRM; si está, `zone` es el nombre sincronizado. */
  zoneId?: string | null
  odb: string | null
  voip: string | null
  tv: string | null
  authDate: string | null
  probedAt?: string
  mgmtIp?: string | null
  mgmtPoolId?: string | null
  mgmtVlanId?: number | null
  wanIp?: string | null
  wanPoolId?: string | null
  wanVlanId?: number | null
  tr069ProfileId?: string | null
  tr069Enabled?: boolean
  provisionMode?: 'auto' | 'manual'
  verifyStatus?: 'idle' | 'test' | 'ok' | 'fail'
  verifyStartedAt?: string | null
  verifyCheckedAt?: string | null
  verifyAttempt?: number
  verifyDetail?: Record<string, unknown>
  serviceState?: import('./crm').ServiceStateView | null
}

export type OnuManualConfig = {
  ok: boolean
  provisionMode: 'auto' | 'manual'
  sn: string | null
  onuIf: string
  wan: {
    mode: 'static'
    connectionType: string
    ip: string
    prefix: number
    mask: string
    gateway: string
    vlan: number
    dns1: string | null
    dns2: string | null
  } | null
  mgmt: {
    ip: string
    prefix: number
    mask: string
    gateway: string
    vlan: number
  } | null
}

export type ConnectedOnusResponse = {
  onus: ConnectedOnu[]
  olts: Array<{ id: string; name: string }>
  errors: Array<{ oltId: string; oltName: string; error: string }>
  total: number
  online: number
  message?: string | null
  fromDatabase?: boolean
}

export type OnuDiscoverOnu = {
  onuIf: string
  ponType?: string
  board?: string
  port?: string
  onuId?: string
  sn?: string | null
  onuType?: string | null
  name?: string | null
  description?: string | null
  status?: string
  phaseState?: string
  adminState?: string
  online?: boolean
  signalDbm?: number | null
  mode?: string | null
  vlan?: number | null
  vlans?: number[]
}

export type OnuDiscoverResponse = {
  oltId: string
  oltName: string
  probedAt: string
  total: number
  online: number
  importedCount: number
  suggestOnuImport: boolean
  ports: Array<{
    ifName: string
    board: string
    port: string
    count: number
    online: number
  }>
  onus: OnuDiscoverOnu[]
}

export type OnuMetricsResponse = {
  onuId: string
  hours: number
  live?: boolean
  samples: Array<{
    kind: string
    value: number
    sampledAt: string
  }>
}

export type ConnectedOnuDetail = ConnectedOnu & {
  oltRxDbm: number | null
  distanceM: number | null
  onlineDuration: string | null
  /** Customer download rate (bytes/s) */
  downloadBps?: number | null
  /** Customer upload rate (bytes/s) */
  uploadBps?: number | null
  contact: string | null
  address: string | null
  configurationPreset: string | null
  tr069Profile: string | null
  tr069ProfileId?: string | null
  tr069Enabled?: boolean
  mgmtIp: string | null
  mgmtPoolId?: string | null
  mgmtVlanId?: number | null
  wanIp?: string | null
  wanPoolId?: string | null
  wanVlanId?: number | null
  wanSetupMode: string | null
  runningConfig: string
  detailInfoRaw: string
  ethernetPorts: Array<{
    port: string
    adminState: string
    mode: string
    dhcp: string
  }>
  wifiPorts: Array<{
    port: string
    band: string
    adminState: string
    mode: string
    ssid: string
    dhcp: string
  }>
  voipSupported: boolean | null
  catvSupported: boolean | null
  speedProfile: { download: string | null; upload: string | null }
  imageUrl: string | null
}

export type ConnectedOnuDetailResponse = {
  probedAt: string | null
  fromDatabase?: boolean
  /** Cliente dueño según el servicio ligado (no depende del mapa/coordenadas). */
  client?: {
    clientId: string
    serviceId: string
    label: string
    serviceName: string | null
    serviceStatus: string | null
    serviceState?: import('./crm').ServiceStateView | null
  } | null
  onu: ConnectedOnuDetail
}

export type OnuCliReportResponse = {
  oltId: string
  oltName: string
  onuIf: string
  probedAt: string
  report: string
  runningConfig?: string
  swInfo?: {
    vendorId: string | null
    version: string | null
    model: string | null
    equipId: string | null
    sn: string | null
    omccVersion: string | null
    fields: Array<{ label: string; value: string }>
    raw: string
  } | null
}

export type OnuRunningConfigResponse = {
  oltId: string
  oltName: string
  onuIf: string
  probedAt: string
  runningConfig: string
}

export type OnuSwInfoResponse = {
  oltId: string
  oltName: string
  onuIf: string
  probedAt: string
  report: string
  equip: {
    vendorId: string | null
    version: string | null
    model: string | null
    equipId: string | null
    sn: string | null
    omccVersion: string | null
    fields: Array<{ label: string; value: string }>
    raw: string
  }
}

export type OnuLiveTrafficResponse = {
  oltId: string
  oltName: string
  onuIf: string
  probedAt: string
  downloadBps: number | null
  uploadBps: number | null
  downloadPps: number | null
  uploadPps: number | null
  downloadAvgSize: number | null
  uploadAvgSize: number | null
}

export type UncfgOnu = {
  oltId: string
  oltName: string
  oltIf: string
  onuIfHint: string | null
  sn: string
  state: string | null
  ponType: string
  board: string
  port: string
  suggestedOnuId: number | null
  /** SN also present in Conectadas (possible stale inventory row). */
  inConnected?: boolean
  /** Modelo ACS (ProductClass), p. ej. HG6143D. */
  model?: string | null
  modelSource?: 'acs' | 'sighting' | 'inventory' | null
  /** Driver ONU resuelto (library/generic). */
  driverId?: string | null
  vendor?: string
  /** Primera aparición en Huérfanas (ISO). */
  firstSeenAt?: string | null
  lastSeenAt?: string | null
}

export type UncfgResponse = {
  onus: UncfgOnu[]
  olts: Array<{ id: string; name: string }>
  errors: Array<{ oltId: string; oltName: string; error: string }>
  total: number
  deniedCount?: number
  suspendedCount?: number
  rawUncfg?: number
  alsoInConnected?: number
  probedAt: string
}

export type SuspendedOnu = {
  id: string
  sn: string | null
  oltId: string
  oltName: string
  onuIf: string
  ponType: string
  board: string
  port: string
  onuId: string
  adminState: string
  online: boolean
  status: string
  name: string | null
}

export type SuspendedOnusResponse = {
  suspended: SuspendedOnu[]
  total: number
}

export type DeniedOnu = {
  id: string
  sn: string
  oltId: string | null
  oltIf: string | null
  oltName: string | null
  board: string | null
  port: string | null
  ponType: string | null
  note: string | null
  manual?: boolean
  inConnected?: boolean
  deniedAt: string
}

export type DeniedOnusResponse = {
  denied: DeniedOnu[]
  total: number
}

export type AuthorizeOnuResponse = {
  ok: boolean
  message: string
  onuIf: string
  onu: ConnectedOnu
  authorizedType?: string
  detectedModel?: string
  steps?: Array<{
    step: string
    status: 'ok' | 'fail' | 'skip' | 'info'
    message: string
    typeName?: string
    model?: string
  }>
}

export function signalBand(
  dbm: number | null,
): 'good' | 'fair' | 'poor' | null {
  if (dbm == null || !Number.isFinite(dbm)) return null
  if (dbm >= -25) return 'good'
  if (dbm >= -28) return 'fair'
  return 'poor'
}

export function formatSignal(dbm: number | null): string {
  if (dbm == null || !Number.isFinite(dbm)) return '—'
  return `${dbm.toFixed(2)} dBm`
}

/** Format bytes/s as human rate (kbps / Mbps). */
export function formatBps(bps: number | null | undefined): string {
  if (bps == null || !Number.isFinite(bps)) return '—'
  if (bps < 1000) return `${Math.round(bps)} B/s`
  const kbps = bps / 125 // bytes/s → kbps (bits)
  if (kbps < 1000) return `${kbps.toFixed(1)} kbps`
  return `${(kbps / 1000).toFixed(2)} Mbps`
}

/** Convert bytes/s to Mbps (bits) for charts. */
export function bpsToMbps(bps: number): number {
  return (bps * 8) / 1_000_000
}
