import { apiFetch } from './api'

export type MigrationCandidate = {
  onuIf: string
  ponType: string
  board: string
  port: string
  onuId: string
  sn: string | null
  onuType: string | null
  name: string | null
  description: string | null
  status: string
  phaseState: string
  adminState: string
  online: boolean
  signalDbm: number | null
  mode: string | null
  vlan: number | null
  vlans: number[]
  inDb: boolean
  onuDbId: string | null
  suggestedClientName: string
  suggestedFirstName: string
  suggestedLastName: string
  suggestedServiceName: string
  nameSource: 'name' | 'description' | 'empty'
  nameConfidence: 'high' | 'medium' | 'low'
}

export type MigrationScanResponse = {
  oltId: string
  oltName: string
  probedAt: string
  totalLive: number
  totalCandidates: number
  sourceVlans: number[]
  candidates: MigrationCandidate[]
}

export type MigrationSegmentConfig = {
  oltId: string
  oltName: string
  sourceVlan: number | null
  mgmtVlanId: number
  wanVlanId: number
  tr069ProfileId: string | null
}

export function scanMigrationOlts(oltId: string) {
  return apiFetch<MigrationScanResponse>('/app/onus/migration/scan', {
    method: 'POST',
    body: JSON.stringify({ oltId }),
  })
}

/** Filter candidates belonging to a source VLAN segment. */
export function filterBySourceVlan(
  candidates: MigrationCandidate[],
  sourceVlan: number | null,
): MigrationCandidate[] {
  if (sourceVlan == null) return candidates
  return candidates.filter((c) => {
    if (c.vlan === sourceVlan) return true
    return Array.isArray(c.vlans) && c.vlans.includes(sourceVlan)
  })
}

const SERVICE_SUFFIXES = new Set(
  [
    'casa',
    'local',
    'oficina',
    'negocio',
    'tienda',
    'empresa',
    'internet',
    'fibra',
    'principal',
    'secundario',
    'secundaria',
    'apto',
    'apt',
    'depto',
    'dpto',
    'departamento',
    'taller',
    'bodega',
    'residencia',
    'vivienda',
    'hogar',
    'servicio',
  ].map((s) => s.toLowerCase()),
)

/** Split display name into tentative first/last (+ optional service suffix). */
export function splitSuggestedName(full: string): {
  firstName: string
  lastName: string
  serviceName: string
} {
  const parts = full.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) {
    return { firstName: '', lastName: '', serviceName: '' }
  }

  let serviceName = ''
  if (parts.length >= 2) {
    const last = parts[parts.length - 1]
    if (SERVICE_SUFFIXES.has(last.toLowerCase())) {
      serviceName = last
      parts.pop()
    }
  }

  if (parts.length === 0) {
    return { firstName: '', lastName: '', serviceName }
  }
  if (parts.length === 1) {
    return { firstName: parts[0], lastName: '', serviceName }
  }

  // «Juan Carlos Perez» → nombre compuesto si el 2º parece nombre
  const compoundSeconds = new Set([
    'jose',
    'maría',
    'maria',
    'juan',
    'luis',
    'carlos',
    'ana',
    'rosa',
    'miguel',
    'angel',
    'ángel',
    'francisco',
    'antonio',
    'manuel',
    'de',
    'del',
    'la',
  ])
  let firstCount = 1
  if (
    parts.length >= 3 &&
    compoundSeconds.has(parts[1].toLowerCase())
  ) {
    firstCount = 2
  }

  return {
    firstName: parts.slice(0, firstCount).join(' '),
    lastName: parts.slice(firstCount).join(' '),
    serviceName,
  }
}
