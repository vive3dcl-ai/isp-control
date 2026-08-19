import { apiFetch, getToken, API_URL } from './api'

export type OltConfigSnapshot = {
  id: string
  oltId: string
  source: 'scheduled' | 'manual'
  byteSize: number
  sha256: string
  complete: boolean
  fileName: string
  note: string | null
  createdAt: string
}

export type OltConfigSnapshotsResponse = {
  snapshots: OltConfigSnapshot[]
}

export type OltConfigDiffHunk = {
  kind: 'same' | 'add' | 'del'
  text: string
}

export type OltConfigDiffResponse = {
  a: OltConfigSnapshot
  b: OltConfigSnapshot
  added: number
  removed: number
  truncated: boolean
  hunks: OltConfigDiffHunk[]
}

export function listOltConfigBackups(oltId: string) {
  return apiFetch<OltConfigSnapshotsResponse>(
    `/app/topology/devices/${oltId}/config-backups`,
  )
}

export function captureOltConfigBackup(oltId: string) {
  return apiFetch<OltConfigSnapshot>(
    `/app/topology/devices/${oltId}/config-backups`,
    { method: 'POST' },
  )
}

export function diffOltConfigBackups(oltId: string, a: string, b: string) {
  const q = new URLSearchParams({ a, b })
  return apiFetch<OltConfigDiffResponse>(
    `/app/topology/devices/${oltId}/config-backups/diff?${q.toString()}`,
  )
}

export function setOltTechnicianMode(oltId: string, technicianMode: boolean) {
  return apiFetch<{ id: string; technicianMode: boolean }>(
    `/app/topology/devices/${oltId}/technician-mode`,
    {
      method: 'PATCH',
      body: JSON.stringify({ technicianMode }),
    },
  )
}

export async function downloadOltConfigBackup(
  oltId: string,
  snapId: string,
  fileName: string,
): Promise<void> {
  const token = getToken()
  const res = await fetch(
    `${API_URL}/app/topology/devices/${oltId}/config-backups/${snapId}/download`,
    { headers: token ? { Authorization: `Bearer ${token}` } : {} },
  )
  if (!res.ok) {
    let message = 'No se pudo descargar el respaldo'
    try {
      const body = (await res.json()) as { message?: string | string[] }
      if (Array.isArray(body.message)) message = body.message.join(', ')
      else if (body.message) message = body.message
    } catch {
      /* ignore */
    }
    throw new Error(message)
  }
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
