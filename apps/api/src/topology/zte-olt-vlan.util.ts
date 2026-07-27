/** Parsers for ZTE OLT VLAN catalogue (SmartOLT-style). */

export interface ZteVlanRaw {
  vlanId: number
  description: string | null
  usedForIptv: boolean
  /** ONUs in this VLAN cannot talk to each other (no `all-to-all`). */
  isolated: boolean
  /** PON ifNames that already tag this VLAN (from running-config). */
  defaultPonPorts: string[]
  onuCount: number
  /** VLAN 1 — default del sistema ZTE (siempre presente). */
  isSystem: boolean
}

export type OltVlanMetaFlags = {
  isolated?: boolean
}

export type OltVlanMetaMap = Record<string, OltVlanMetaFlags>

/** Extract `vlan N` blocks + related global flags from running-config. */
export function parseVlansFromRunningConfig(cfg: string): ZteVlanRaw[] {
  const byId = new Map<number, ZteVlanRaw>()

  const ensure = (id: number): ZteVlanRaw => {
    let row = byId.get(id)
    if (!row) {
      row = {
        vlanId: id,
        description: null,
        usedForIptv: false,
        // ZTE default: no `all-to-all` in the vlan block means ONUs are isolated.
        isolated: true,
        defaultPonPorts: [],
        onuCount: 0,
        isSystem: id === 1,
      }
      byId.set(id, row)
    }
    return row
  }

  // VLAN 1 is always present on ZTE (system / default) even if omitted from config.
  ensure(1)

  const lines = cfg.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s*vlan\s+(\d+)\s*$/i)
    if (!m) continue
    const id = Number(m[1])
    if (!Number.isInteger(id) || id < 1 || id > 4094) continue
    const row = ensure(id)
    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j].trim()
      if (!line || line === '!') break
      if (/^vlan\s+\d+/i.test(line) || /^interface\s+/i.test(line)) break
      if (/^[\w.-]+#/.test(line)) break
      const name = line.match(/^name\s+(.+)$/i)
      if (name) {
        row.description = name[1].trim()
        continue
      }
      const desc = line.match(/^description\s+(.+)$/i)
      if (desc) {
        row.description = desc[1].trim()
        continue
      }
      if (/^all-to-all$/i.test(line) || /^lan-to-lan\s+enable$/i.test(line)) {
        row.isolated = false
      }
      if (/^isolate(\s+enable)?$/i.test(line)) {
        row.isolated = true
      }
    }
  }

  // Also pick up VLANs only referenced as tagged on uplinks / PON
  for (const line of lines) {
    const tag = line.match(
      /^\s*switchport\s+vlan\s+(\d+(?:[,-]\d+)*)\s+tag\b/i,
    )
    if (tag) {
      for (const v of expandSimpleVlanList(tag[1])) ensure(v)
    }
  }

  for (const line of lines) {
    const mv = line.match(/^\s*igmp\s+mvlan\s+(\d+)\b/i)
    if (mv) {
      const row = ensure(Number(mv[1]))
      row.usedForIptv = true
    }
  }

  // Default for PON: gpon-olt / epon-olt with switchport vlan N tag
  let currentIf: string | null = null
  for (const raw of lines) {
    const ifM = raw.match(
      /^\s*interface\s+((?:g|e)pon-olt_[\d/]+)\s*$/i,
    )
    if (ifM) {
      currentIf = ifM[1]
      continue
    }
    if (/^\s*interface\s+/i.test(raw) || /^\s*!\s*$/.test(raw)) {
      currentIf = null
      continue
    }
    if (!currentIf) continue
    const tag = raw.match(
      /^\s*switchport\s+vlan\s+(\d+(?:[,-]\d+)*)\s+tag\b/i,
    )
    if (!tag) continue
    for (const v of expandSimpleVlanList(tag[1])) {
      const row = ensure(v)
      if (!row.defaultPonPorts.includes(currentIf)) {
        row.defaultPonPorts.push(currentIf)
      }
    }
  }

  // ONU count: unique onu ifaces that reference this VLAN
  const onuByVlan = new Map<number, Set<string>>()
  let onuIf: string | null = null
  for (const raw of lines) {
    const ifM = raw.match(
      /^\s*interface\s+((?:g|e)pon-onu_[\d/:]+)\s*$/i,
    )
    if (ifM) {
      onuIf = ifM[1]
      continue
    }
    if (/^\s*interface\s+/i.test(raw) || /^\s*!\s*$/.test(raw)) {
      onuIf = null
      continue
    }
    if (!onuIf) continue
    const refs = [
      ...raw.matchAll(/\buser-vlan\s+(\d+)\b/gi),
      ...raw.matchAll(/\bvlan\s+(\d+)\b/gi),
    ]
    for (const r of refs) {
      const id = Number(r[1])
      if (!onuByVlan.has(id)) onuByVlan.set(id, new Set())
      onuByVlan.get(id)!.add(onuIf)
      ensure(id)
    }
  }
  for (const [id, set] of onuByVlan) {
    const row = byId.get(id)
    if (row) row.onuCount = set.size
  }

  const vlan1 = byId.get(1)
  if (vlan1 && !vlan1.description) {
    vlan1.description = 'Sistema'
  }

  return [...byId.values()].sort((a, b) => a.vlanId - b.vlanId)
}

function expandSimpleVlanList(spec: string): number[] {
  const out: number[] = []
  for (const part of spec.split(',').map((s) => s.trim()).filter(Boolean)) {
    const range = part.match(/^(\d+)-(\d+)$/)
    if (range) {
      const a = Number(range[1])
      const b = Number(range[2])
      for (let i = Math.min(a, b); i <= Math.max(a, b); i++) out.push(i)
    } else if (/^\d+$/.test(part)) {
      out.push(Number(part))
    }
  }
  return out
}
