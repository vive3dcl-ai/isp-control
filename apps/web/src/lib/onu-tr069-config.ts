export type Tr069WifiRadio = {
  index: number
  pathPrefix: string
  ssidPath: string
  keyPath: string | null
  enablePath: string | null
  ssid: string | null
  key: string | null
  enabled: boolean | null
  channel: string | null
  standard: string | null
}

export type Tr069EthPort = {
  index: number
  pathPrefix: string
  enablePath: string | null
  name: string | null
  enabled: boolean | null
  status: string | null
  mac: string | null
}

export type Tr069WebUser = {
  index: number
  pathPrefix: string
  usernamePath: string
  passwordPath: string
  username: string | null
  password: string | null
  enablePath: string | null
  enabled: boolean | null
}

export type Tr069OnuConfig = {
  onuId: string
  sn: string | null
  mgmtIp: string | null
  acsDeviceId: string | null
  inAcs: boolean
  lastInform: string | null
  model: string | null
  manufacturer: string | null
  softwareVersion: string | null
  dataModel: 'tr098' | 'tr181' | 'unknown'
  wifi: Tr069WifiRadio[]
  ethernet: Tr069EthPort[]
  webUsers: Tr069WebUser[]
  message: string | null
}

export type ApplyTr069OnuConfigBody = {
  wifi?: Array<{
    index: number
    ssid?: string
    key?: string
    enabled?: boolean
  }>
  ethernet?: Array<{ index: number; enabled?: boolean }>
  webUsers?: Array<{
    index: number
    username?: string
    password?: string
  }>
  refresh?: boolean
}

export type ApplyTr069OnuConfigResponse = {
  ok: boolean
  taskStatus: number | null
  queued: boolean
  message: string
  config: Tr069OnuConfig
}
