export type NodeAssetStatus = 'online' | 'offline' | 'unknown'
export type NodeHealth = 'ok' | 'degraded' | 'down' | 'unknown'

export type NetworkNodeAsset = {
  id: string
  name: string
  type: string
  subtype: string | null
  mgmtHost: string | null
  connectionStatus: string
  lastCheckedAt: string | null
  status: NodeAssetStatus
  online: boolean
  assigned?: boolean
  nodeId?: string | null
}

export type NetworkNode = {
  id: string
  name: string
  note: string
  isRented: boolean
  contactName: string
  contactPhone: string
  contactEmail: string
  street: string
  city: string
  zipCode: string
  latitude: number | null
  longitude: number | null
  isActive: boolean
  createdAt: string
  updatedAt: string
  health: NodeHealth
  assetCount: number
  onlineCount: number
  offlineCount: number
  assets: NetworkNodeAsset[]
}

export type NetworkNodeMapMarker = {
  id: string
  kind: 'node'
  lat: number
  lng: number
  label: string
  subtitle: string | null
  health: NodeHealth
  onlineCount: number
  offlineCount: number
  assetCount: number
}

export const nodeHealthLabel: Record<NodeHealth, string> = {
  ok: 'Operativo',
  degraded: 'Degradado',
  down: 'Caído',
  unknown: 'Sin datos',
}

export const nodeAssetStatusLabel: Record<NodeAssetStatus, string> = {
  online: 'En línea',
  offline: 'Desconectado',
  unknown: 'Sin monitoreo',
}
