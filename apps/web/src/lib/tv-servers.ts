import { apiFetch, getToken, API_URL } from './api'

export type TvServerStatus =
  | 'pending'
  | 'installing'
  | 'online'
  | 'error'
  | 'offline'

export type TvServer = {
  id: string
  deviceId: string
  name: string
  sshHost: string
  sshPort: number
  sshUsername: string
  hasSshPassword: boolean
  apiBaseUrl: string | null
  hasApiToken: boolean
  apiListen: string
  multicastCidr: string | null
  multicastPort: number
  agentVersion: string | null
  status: TvServerStatus
  lastError: string | null
  createdAt: string
  updatedAt: string
}

export type TvHostMetrics = {
  cpuPercent: number
  ramUsedBytes: number
  ramTotalBytes: number
  ramPercent: number
  load1: number
  gpu: {
    name: string
    utilPercent: number
    memUsedMb: number
    memTotalMb: number
  } | null
}

export type TvCategory = { id: string; name: string; createdAt: string }

export type TvChannel = {
  id: string
  name: string
  categoryId: string | null
  logoPath: string | null
  logoUrl: string | null
  source: string
  /** Primary + backups (failover order). First is preferred. */
  sources?: string[]
  output: string
  epgProviderId: string | null
  epgChannelKey: string | null
  createdAt: string
  updatedAt: string
}

export type TvChannelStatus = {
  channelId: string
  state: string
  /** Verified stream: up = producing, down = stopped/stalled */
  link?: 'up' | 'down'
  verified?: boolean
  unit?: string
  activeState?: string
  mainPid?: number
  reconnects?: number
  bitrateKbps?: number
  dropFrames?: number
  packetLossPercent?: number
  fps?: number
  speed?: number
  progressAgeMs?: number
  source?: string
  sources?: string[]
  activeSource?: string
  activeSourceIndex?: number
  output?: string
  result?: string
}

export type TvChannelRow = {
  channel: TvChannel
  status: TvChannelStatus
}

export type TvEpgProvider = {
  id: string
  name: string
  url: string
  refreshMinutes: number
  lastRefreshAt: string | null
  lastError: string | null
  channelCount: number
  createdAt: string
}

export type TvEpgChannel = {
  providerId: string
  key: string
  display: string
}

export function listTvServers() {
  return apiFetch<{ servers: TvServer[] }>('/app/tv/servers')
}

export function createTvServer(body: {
  deviceId: string
  name: string
  sshHost: string
  sshPort?: number
  sshUsername: string
  sshPassword: string
  apiListen?: string
  apiBaseUrl?: string
  multicastCidr?: string
  multicastPort?: number
}) {
  return apiFetch<TvServer>('/app/tv/servers', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function updateTvServer(
  id: string,
  body: {
    name?: string
    multicastCidr?: string | null
    multicastPort?: number
  },
) {
  return apiFetch<TvServer>(`/app/tv/servers/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

export function nextTvOutput(serverId: string) {
  return apiFetch<{
    output: string
    multicastCidr: string
    multicastPort: number
  }>(`/app/tv/servers/${serverId}/next-output`)
}

export function deleteTvServer(id: string) {
  return apiFetch<{ ok: boolean }>(`/app/tv/servers/${id}`, {
    method: 'DELETE',
  })
}

export function installTvServerStep(
  id: string,
  step:
    | 'ssh'
    | 'detect'
    | 'upload'
    | 'install'
    | 'health'
    | 'rewrite'
    | 'verify',
) {
  return apiFetch<{ ok: boolean; step: string; detail: string }>(
    `/app/tv/servers/${id}/install`,
    { method: 'POST', body: JSON.stringify({ step }) },
  )
}

export function getTvAgentRelease() {
  return apiFetch<{ version: string }>('/app/tv/agent-release')
}

export function checkTvServerUpdate(id: string) {
  return apiFetch<{
    serverId: string
    installedVersion: string | null
    availableVersion: string
    updateAvailable: boolean
    reachable: boolean
    server: TvServer
  }>(`/app/tv/servers/${id}/update-check`)
}

export function getTvServerHost(id: string) {
  return apiFetch<{ server: TvServer; host: TvHostMetrics }>(
    `/app/tv/servers/${id}/host`,
  )
}

export function listTvCategories(serverId: string) {
  return apiFetch<{ categories: TvCategory[] }>(
    `/app/tv/servers/${serverId}/categories`,
  )
}

export function createTvCategory(serverId: string, name: string) {
  return apiFetch<TvCategory>(`/app/tv/servers/${serverId}/categories`, {
    method: 'POST',
    body: JSON.stringify({ name }),
  })
}

export function listTvChannels(serverId: string) {
  return apiFetch<{ channels: TvChannelRow[] }>(
    `/app/tv/servers/${serverId}/channels`,
  )
}

export function createTvChannel(
  serverId: string,
  body: {
    name: string
    categoryId?: string | null
    source: string
    sources?: string[]
    output: string
    epgProviderId?: string | null
    epgChannelKey?: string | null
  },
) {
  return apiFetch<{ channel: TvChannel; warning?: string }>(
    `/app/tv/servers/${serverId}/channels`,
    { method: 'POST', body: JSON.stringify(body) },
  )
}

export function patchTvChannel(
  serverId: string,
  channelId: string,
  body: Record<string, unknown>,
) {
  return apiFetch<{ channel: TvChannel }>(
    `/app/tv/servers/${serverId}/channels/${channelId}`,
    { method: 'PATCH', body: JSON.stringify(body) },
  )
}

export function deleteTvChannel(serverId: string, channelId: string) {
  return apiFetch<{ ok: boolean }>(
    `/app/tv/servers/${serverId}/channels/${channelId}`,
    { method: 'DELETE' },
  )
}

export function startTvChannel(serverId: string, channelId: string) {
  return apiFetch<TvChannelStatus>(
    `/app/tv/servers/${serverId}/channels/${channelId}/start`,
    { method: 'POST' },
  )
}

export function stopTvChannel(serverId: string, channelId: string) {
  return apiFetch<TvChannelStatus>(
    `/app/tv/servers/${serverId}/channels/${channelId}/stop`,
    { method: 'POST' },
  )
}

export async function uploadTvChannelLogo(
  serverId: string,
  channelId: string,
  file: File,
) {
  const token = getToken()
  const form = new FormData()
  form.append('logo', file)
  const res = await fetch(
    `${API_URL}/app/tv/servers/${serverId}/channels/${channelId}/logo`,
    {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
    },
  )
  if (!res.ok) {
    let message = `HTTP ${res.status}`
    try {
      const body = (await res.json()) as { message?: string | string[]; error?: string }
      if (Array.isArray(body.message)) message = body.message.join(', ')
      else if (body.message) message = body.message
      else if (body.error) message = body.error
    } catch {
      // ignore
    }
    throw new Error(message)
  }
  return res.json() as Promise<{ channel: TvChannel }>
}

export function listTvEpgProviders(serverId: string) {
  return apiFetch<{ providers: TvEpgProvider[] }>(
    `/app/tv/servers/${serverId}/epg/providers`,
  )
}

export function createTvEpgProvider(
  serverId: string,
  body: { name: string; url: string; refreshMinutes?: number },
) {
  return apiFetch<TvEpgProvider>(
    `/app/tv/servers/${serverId}/epg/providers`,
    { method: 'POST', body: JSON.stringify(body) },
  )
}

export function deleteTvEpgProvider(serverId: string, providerId: string) {
  return apiFetch<{ ok: boolean }>(
    `/app/tv/servers/${serverId}/epg/providers/${providerId}`,
    { method: 'DELETE' },
  )
}

export function refreshTvEpgProvider(serverId: string, providerId: string) {
  return apiFetch<{ provider: TvEpgProvider; channels: number }>(
    `/app/tv/servers/${serverId}/epg/providers/${providerId}/refresh`,
    { method: 'POST' },
  )
}

export function listTvEpgChannels(serverId: string, providerId: string) {
  return apiFetch<{ channels: TvEpgChannel[] }>(
    `/app/tv/servers/${serverId}/epg/providers/${providerId}/channels`,
  )
}

export function tvLogoUrl(serverId: string, channelId: string) {
  return `${API_URL}/app/tv/servers/${serverId}/logos/${channelId}`
}

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`
  return `${(n / 1024 ** 3).toFixed(1)} GB`
}
