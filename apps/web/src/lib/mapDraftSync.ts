import { apiFetch } from './api'
import type { MapDraftElement } from './map-elements'
import { loadMapDrafts, saveMapDrafts } from './map-elements'

const PENDING_PREFIX = 'isp-map-pending-poles:'

function pendingKey(tenantKey: string | null | undefined) {
  return `${PENDING_PREFIX}${tenantKey || 'unknown'}`
}

export function loadPendingPoles(
  tenantKey: string | null | undefined,
): MapDraftElement[] {
  try {
    const raw = localStorage.getItem(pendingKey(tenantKey))
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? (parsed as MapDraftElement[]) : []
  } catch {
    return []
  }
}

export function savePendingPoles(
  tenantKey: string | null | undefined,
  poles: MapDraftElement[],
) {
  localStorage.setItem(pendingKey(tenantKey), JSON.stringify(poles))
}

export function isOnline() {
  return typeof navigator === 'undefined' ? true : navigator.onLine
}

/** Guarda el poste en local y lo envía al servidor (o lo deja pendiente). */
export async function addPoleWithSync(
  tenantKey: string | null | undefined,
  pole: MapDraftElement,
  saveLocal: (el: MapDraftElement) => void,
): Promise<'synced' | 'queued' | 'local-only'> {
  // Nunca perder el poste: primero local.
  saveLocal(pole)

  if (!isOnline()) {
    const pending = loadPendingPoles(tenantKey)
    if (!pending.some((p) => p.id === pole.id)) {
      savePendingPoles(tenantKey, [...pending, pole])
    }
    return 'queued'
  }

  try {
    await apiFetch('/app/map-drafts/elements', {
      method: 'POST',
      body: JSON.stringify({
        id: pole.id,
        type: pole.type,
        name: pole.name,
        notes: pole.notes ?? '',
        lat: pole.lat,
        lng: pole.lng,
      }),
    })
    return 'synced'
  } catch {
    const pending = loadPendingPoles(tenantKey)
    if (!pending.some((p) => p.id === pole.id)) {
      savePendingPoles(tenantKey, [...pending, pole])
    }
    return 'queued'
  }
}

/** Empuja la cola pendiente al servidor. */
export async function flushPendingPoles(
  tenantKey: string | null | undefined,
): Promise<{ sent: number; left: number }> {
  if (!isOnline()) {
    const pending = loadPendingPoles(tenantKey)
    return { sent: 0, left: pending.length }
  }
  const pending = loadPendingPoles(tenantKey)
  if (pending.length === 0) return { sent: 0, left: 0 }

  const left: MapDraftElement[] = []
  let sent = 0
  for (const pole of pending) {
    try {
      await apiFetch('/app/map-drafts/elements', {
        method: 'POST',
        body: JSON.stringify({
          id: pole.id,
          type: pole.type,
          name: pole.name,
          notes: pole.notes ?? '',
          lat: pole.lat,
          lng: pole.lng,
        }),
      })
      sent += 1
    } catch {
      left.push(pole)
    }
  }
  savePendingPoles(tenantKey, left)

  // Asegurar que los locales siguen presentes
  const local = loadMapDrafts(tenantKey)
  const byId = new Map(local.map((d) => [d.id, d]))
  for (const p of pending) {
    if (!byId.has(p.id)) byId.set(p.id, p)
  }
  saveMapDrafts(tenantKey, [...byId.values()])

  return { sent, left: left.length }
}

/** Mezcla borradores del servidor con los locales (local gana por id más reciente implícito). */
export async function pullServerDrafts(
  tenantKey: string | null | undefined,
): Promise<MapDraftElement[]> {
  const local = loadMapDrafts(tenantKey)
  if (!isOnline()) return local
  try {
    const res = await apiFetch<{ elements: MapDraftElement[] }>(
      '/app/map-drafts',
    )
    const remote = Array.isArray(res.elements) ? res.elements : []
    const byId = new Map<string, MapDraftElement>()
    for (const el of remote) {
      if (el?.id) byId.set(el.id, el)
    }
    for (const el of local) {
      byId.set(el.id, el)
    }
    const merged = [...byId.values()]
    saveMapDrafts(tenantKey, merged)
    return merged
  } catch {
    return local
  }
}
