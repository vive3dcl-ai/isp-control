export type OnuProfile = {
  id: string
  code: string
  name: string
  description: string
  vlanCli: string
  portKind: 'eth' | 'veip' | string
  sortOrder: number
  isSystem: boolean
  label: string
}

export type OnuProfilesResponse = {
  profiles: OnuProfile[]
}

export type OnuType = {
  id: string
  ponType: 'gpon' | 'epon' | string
  ponTypeLabel: string
  channel: string
  channelGpon: boolean
  channelXgpon: boolean
  channelXgspon: boolean
  name: string
  vendor: string
  vendorLabel: string
  fromCatalog: boolean
  onuCount: number
  ethernetPorts: number
  wifiSsids: number
  voipPorts: number
  catv: boolean
  allowCustomProfiles: boolean
  allowCustomProfilesLabel: string
  defaultProfileId: string | null
  defaultProfileName: string | null
  /** Driver TR-069 real (library/generic). */
  provisionScriptId?: string
  provisionScriptLabel?: string
  provisionScriptKind?: 'library' | 'generic'
  skipOmciServiceWan?: boolean
  capability: 'bridging' | 'bridging_routing' | string
  capabilityLabel: string
  useDefaultImage: boolean
  imageUrl: string | null
  imageDisplayUrl: string
  localImageUrl: string
}

export type OnuTypesResponse = {
  types: OnuType[]
}
