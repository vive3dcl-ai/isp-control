export type NetworkMapClientMarker = {
  id: string
  kind: 'client'
  lat: number
  lng: number
  label: string
  subtitle: string | null
  clientId: string
}

export type NetworkMapOnuMarker = {
  id: string
  kind: 'onu'
  lat: number
  lng: number
  label: string
  subtitle: string | null
  clientId: string
  serviceId: string
  onuId: string | null
  serviceName: string
  planName: string | null
  onuSn: string | null
  onuIf: string | null
}

export type NetworkMapLocations = {
  clients: NetworkMapClientMarker[]
  onus: NetworkMapOnuMarker[]
}
