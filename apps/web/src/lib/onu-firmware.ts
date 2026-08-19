import { apiFetch, getToken, API_URL } from './api'

export type FirmwareImage = {
  id: string
  modelKey: string
  version: string
  fileName: string
  byteSize: number
  genieFileId: string | null
  acsRegistered: boolean
  note: string | null
  createdAt: string
}

export type FirmwareImagesResponse = {
  images: FirmwareImage[]
}

export type FirmwareTarget = {
  onuId: string
  sn: string | null
  name: string | null
  onuType: string | null
  online: boolean
  oltName: string
  acsVersion: string | null
  canUpgrade: boolean
  skipReason: string | null
}

export type FirmwareTargetsResponse = {
  image: FirmwareImage
  targets: FirmwareTarget[]
  onlineCount: number
}

export type FirmwareUpgradeResult = {
  onuId: string
  sn: string | null
  ok: boolean
  message: string
}

export type FirmwareUpgradeResponse = {
  image: FirmwareImage
  queued: number
  failed: number
  results: FirmwareUpgradeResult[]
}

export function listFirmwareImages() {
  return apiFetch<FirmwareImagesResponse>('/app/onus/firmware')
}

export function firmwareTargets(imageId: string) {
  return apiFetch<FirmwareTargetsResponse>(
    `/app/onus/firmware/${imageId}/targets`,
  )
}

export function deleteFirmwareImage(id: string) {
  return apiFetch<{ ok: boolean }>(`/app/onus/firmware/${id}`, {
    method: 'DELETE',
  })
}

export function upgradeFirmware(
  imageId: string,
  body: { onuId?: string; allOnlineOfModel?: boolean },
) {
  return apiFetch<FirmwareUpgradeResponse>(
    `/app/onus/firmware/${imageId}/upgrade`,
    { method: 'POST', body: JSON.stringify(body) },
  )
}

export async function uploadFirmwareImage(opts: {
  file: File
  modelKey: string
  version: string
  note?: string
}): Promise<{ image: FirmwareImage; acsWarning: string | null }> {
  const token = getToken()
  const form = new FormData()
  form.append('file', opts.file)
  form.append('modelKey', opts.modelKey)
  form.append('version', opts.version)
  if (opts.note?.trim()) form.append('note', opts.note.trim())
  const res = await fetch(`${API_URL}/app/onus/firmware`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  })
  if (!res.ok) {
    let message = `HTTP ${res.status}`
    try {
      const body = (await res.json()) as {
        message?: string | string[]
        error?: string
      }
      if (Array.isArray(body.message)) message = body.message.join(', ')
      else if (body.message) message = body.message
      else if (body.error) message = body.error
    } catch {
      /* ignore */
    }
    throw new Error(message)
  }
  return res.json() as Promise<{
    image: FirmwareImage
    acsWarning: string | null
  }>
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
