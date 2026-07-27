import { apiFetch } from './api'
import {
  loadMapDrafts,
  saveMapDrafts,
  type MapDraftElement,
} from './map-elements'

export type CatalogZone = {
  id: string
  name: string
  description: string
  clientCount?: number
}

/**
 * Da de alta en Ajustes → Zonas los perímetros del mapa que aún no tienen
 * `zoneId` (o cuyo `zoneId` ya no existe en el catálogo).
 * Devuelve cuántas zonas nuevas se crearon.
 */
export async function adoptOrphanMapZones(
  tenantKey: string | undefined,
  catalog: CatalogZone[],
): Promise<{
  created: number
  failed: number
  lastError: string | null
  drafts: MapDraftElement[]
  orphanCount: number
}> {
  const byId = new Map(catalog.map((z) => [z.id, z]))
  const drafts = loadMapDrafts(tenantKey)
  const used = new Set(
    drafts
      .filter((d) => d.type === 'zone' && d.zoneId && byId.has(d.zoneId))
      .map((d) => d.zoneId as string),
  )

  let created = 0
  let failed = 0
  let lastError: string | null = null
  let changed = false
  let orphanCount = 0
  const next: MapDraftElement[] = []

  for (const d of drafts) {
    if (d.type !== 'zone') {
      next.push(d)
      continue
    }

    // zoneId inválido → desvincular y adoptar de nuevo (no borrar el polígono).
    let zone = d
    if (zone.zoneId && !byId.has(zone.zoneId)) {
      zone = { ...zone, zoneId: null }
      changed = true
    }

    if (zone.zoneId) {
      next.push(zone)
      continue
    }

    orphanCount += 1

    // Emparejar por nombre único libre en el catálogo.
    const nameKey = zone.name.trim().toLocaleLowerCase()
    if (nameKey) {
      const matches = catalog.filter(
        (z) =>
          z.name.trim().toLocaleLowerCase() === nameKey && !used.has(z.id),
      )
      if (matches.length === 1) {
        used.add(matches[0].id)
        next.push({
          ...zone,
          zoneId: matches[0].id,
          name: matches[0].name,
          notes: matches[0].description,
        })
        changed = true
        orphanCount -= 1
        continue
      }
    }

    const createName =
      zone.name.trim().length >= 2
        ? zone.name.trim()
        : zone.name.trim()
          ? `${zone.name.trim()} zona`
          : 'Zona sin nombre'

    try {
      const saved = await apiFetch<CatalogZone>('/app/zones', {
        method: 'POST',
        body: JSON.stringify({
          name: createName.slice(0, 160),
          description: zone.notes ?? '',
        }),
      })
      used.add(saved.id)
      catalog.push(saved)
      byId.set(saved.id, saved)
      next.push({
        ...zone,
        zoneId: saved.id,
        name: saved.name,
        notes: saved.description ?? zone.notes,
      })
      created += 1
      changed = true
      orphanCount -= 1
    } catch (e) {
      failed += 1
      lastError = e instanceof Error ? e.message : 'No se pudo crear la zona'
      next.push(zone)
    }
  }

  if (changed) saveMapDrafts(tenantKey, next)
  return {
    created,
    failed,
    lastError,
    drafts: changed ? next : drafts,
    orphanCount,
  }
}
