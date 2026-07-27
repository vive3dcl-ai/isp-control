/**
 * OLT ONU-type profiles (`show onu-type` / `pon` → `onu-type`).
 * Distinct from marketing model: these are capability templates on the OLT.
 */

export type OnuVendorKind = 'huawei' | 'zte' | 'fiberhome' | 'other'

export type OltOnuTypeSummary = {
  name: string
  ponType: 'gpon' | 'epon'
  description: string | null
}

export type OnuTypeProfileSpec = {
  name: string
  ponType: 'gpon' | 'epon'
  description?: string | null
  ethernetPorts: number
  wifiSsids: number
  voipPorts: number
  catv: boolean
}

/** Vendor from GPON SN prefix (first 4 ASCII chars). */
export function vendorFromSn(sn: string | null | undefined): OnuVendorKind {
  const p = (sn ?? '').trim().toUpperCase().slice(0, 4)
  if (p === 'HWTC' || p === 'HWHT') return 'huawei'
  if (p === 'ZTEG' || p === 'ZTEg' || p.startsWith('ZTE')) return 'zte'
  if (p === 'FHTT' || p === 'FHTC') return 'fiberhome'
  return 'other'
}

/** Preferred vendor try-order when SN is unknown / other. */
export const VENDOR_PROBE_ORDER: OnuVendorKind[] = [
  'huawei',
  'zte',
  'fiberhome',
  'other',
]

/**
 * Parse `show onu-type gpon` / `show onu-type epon` output.
 * C3xx often dumps full blocks:
 *   ONU type name:          F660
 *   PON type:               gpon
 *   Description:            4ETH,2POTS,WIFI
 * Older/table style: `gpon   F660   4ETH,2POTS,WIFI`
 */
export function parseOnuTypeList(
  text: string,
  defaultPon: 'gpon' | 'epon' = 'gpon',
): OltOnuTypeSummary[] {
  const rows: OltOnuTypeSummary[] = []
  const seen = new Set<string>()

  let current: Partial<OltOnuTypeSummary> | null = null
  const flush = () => {
    if (!current?.name) return
    const name = current.name
    const ponType = current.ponType ?? defaultPon
    const key = `${ponType}:${name.toLowerCase()}`
    if (seen.has(key)) return
    seen.add(key)
    rows.push({
      name,
      ponType,
      description: current.description ?? null,
    })
    current = null
  }

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue

    const nameM = trimmed.match(/^ONU\s*type\s*name\s*[:=]\s*(\S+)/i)
    if (nameM) {
      flush()
      current = { name: nameM[1].trim(), ponType: defaultPon }
      continue
    }
    if (current) {
      const ponM = trimmed.match(/^PON\s*type\s*[:=]\s*(gpon|epon)/i)
      if (ponM) {
        current.ponType = ponM[1].toLowerCase() === 'epon' ? 'epon' : 'gpon'
        continue
      }
      const descM = trimmed.match(/^Description\s*[:=]\s*(.*)$/i)
      if (descM) {
        current.description = descM[1].trim() || null
        continue
      }
    }

    if (/^(Pon\s*Type|Onu\s*type|Type\s*name|----|show\s|Total)/i.test(trimmed)) {
      continue
    }

    // Table row: gpon  HG8245H  4ETH ...
    const m = trimmed.match(/^(gpon|epon)\s+(\S+)\s+(.*)$/i)
    if (m) {
      flush()
      const name = m[2].trim()
      const key = `${m[1].toLowerCase()}:${name.toLowerCase()}`
      if (seen.has(key)) continue
      seen.add(key)
      rows.push({
        name,
        ponType: m[1].toLowerCase() === 'epon' ? 'epon' : 'gpon',
        description: m[3]?.trim() || null,
      })
      continue
    }

    const named = trimmed.match(/^Type\s*name\s*[:=]\s*(\S+)/i)
    if (named) {
      flush()
      const name = named[1].trim()
      const key = `${defaultPon}:${name.toLowerCase()}`
      if (seen.has(key)) continue
      seen.add(key)
      rows.push({
        name,
        ponType: defaultPon,
        description: null,
      })
    }
  }
  flush()
  return rows
}

/** Build eth_0/1 … eth_0/N interface list (OLT uses one onu-type-if per port). */
export function ethIfList(ports: number): string[] {
  const n = Math.max(0, Math.min(24, Math.floor(ports)))
  return Array.from({ length: n }, (_, i) => `eth_0/${i + 1}`)
}

export function potsIfList(ports: number): string[] {
  const n = Math.max(0, Math.min(8, Math.floor(ports)))
  return Array.from({ length: n }, (_, i) => `pots_0/${i + 1}`)
}

export function wifiIfList(ssids: number): string[] {
  const n = Math.max(0, Math.min(8, Math.floor(ssids)))
  return Array.from({ length: n }, (_, i) => `wifi_0/${i + 1}`)
}

/** @deprecated prefer ethIfList — some firmwares reject eth_0/1-N ranges */
export function ethIfRange(ports: number): string | null {
  const list = ethIfList(ports)
  if (!list.length) return null
  if (list.length === 1) return list[0]
  return `eth_0/1-${list.length}`
}

export function potsIfRange(ports: number): string | null {
  const list = potsIfList(ports)
  if (!list.length) return null
  if (list.length === 1) return list[0]
  return `pots_0/1-${list.length}`
}

export function wifiIfRange(ssids: number): string | null {
  const list = wifiIfList(ssids)
  if (!list.length) return null
  if (list.length === 1) return list[0]
  return `wifi_0/1-${list.length}`
}

export function defaultDescription(spec: OnuTypeProfileSpec): string {
  if (spec.description?.trim()) return spec.description.trim().slice(0, 60)
  const parts: string[] = []
  if (spec.ethernetPorts > 0) parts.push(`${spec.ethernetPorts}ETH`)
  if (spec.voipPorts > 0) parts.push(`${spec.voipPorts}POTS`)
  if (spec.wifiSsids > 0) parts.push('WIFI')
  if (spec.catv) parts.push('CATV')
  return parts.join(',') || 'ONU'
}
