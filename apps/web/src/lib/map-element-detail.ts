import {
  cableFibers,
  cableTubes,
  cablesEnteringMufa,
  cablesEnteringNap,
  cablesEnteringNode,
  dropClientId,
  findNapForClient,
  findNapForDrop,
  findFiberInCable,
  formatPathLength,
  mapElementLabel,
  pathLengthMeters,
  type MapDraftElement,
} from './map-elements'
import type { NetworkMapLocations } from './network-map'
import type { NetworkNodeMapMarker } from './network-nodes'
import { nodeHealthLabel } from './network-nodes'

export type MapElementDetailField = {
  label: string
  value: string
}

export type MapElementDetailSection = {
  title: string
  items: string[]
}

export type MapElementDetail = {
  kind: string
  name: string
  fields: MapElementDetailField[]
  sections: MapElementDetailSection[]
}

export type MapInspectTarget =
  | { type: 'client'; id: string }
  | { type: 'onu'; id: string }
  | { type: 'node'; id: string }
  | { type: 'draft'; id: string }

type DetailCtx = {
  drafts: MapDraftElement[]
  locations?: NetworkMapLocations | null
  nodes?: NetworkNodeMapMarker[] | null
}

function draftName(d: MapDraftElement | undefined | null) {
  if (!d) return '—'
  return d.name || mapElementLabel[d.type]
}

function pathAnchors(
  el: MapDraftElement,
  drafts: MapDraftElement[],
  clients: { id: string; label: string }[],
  nodes: { id: string; label: string }[],
): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const v of el.path ?? []) {
    const push = (key: string, label: string) => {
      if (seen.has(key)) return
      seen.add(key)
      out.push(label)
    }
    if (v.poleId) {
      const p = drafts.find((d) => d.id === v.poleId)
      push(`pole:${v.poleId}`, `Poste · ${draftName(p)}`)
    }
    if (v.mufaId) {
      const m = drafts.find((d) => d.id === v.mufaId)
      push(`mufa:${v.mufaId}`, `Mufa · ${draftName(m)}`)
    }
    if (v.napId) {
      const n = drafts.find((d) => d.id === v.napId)
      push(`nap:${v.napId}`, `NAP · ${draftName(n)}`)
    }
    if (v.nodeId) {
      const n = nodes.find((x) => x.id === v.nodeId)
      push(`node:${v.nodeId}`, `Nodo · ${n?.label ?? v.nodeId}`)
    }
    if (v.clientId) {
      const c = clients.find((x) => x.id === v.clientId)
      push(`client:${v.clientId}`, `Cliente · ${c?.label ?? v.clientId}`)
    }
  }
  return out
}

function cablesThroughPole(poleId: string, drafts: MapDraftElement[]) {
  return drafts.filter(
    (d) =>
      (d.type === 'cable' || d.type === 'drop') &&
      (d.path ?? []).some((v) => v.poleId === poleId),
  )
}

function fiberLabel(cable: MapDraftElement | undefined, fiberId: string) {
  if (!cable) return fiberId
  const found = findFiberInCable(cable, fiberId)
  if (!found) return fiberId
  return `${found.fiber.name}${found.tube ? ` · ${found.tube.name}` : ''}`
}

function pushField(
  fields: MapElementDetailField[],
  label: string,
  value: string | number | null | undefined,
) {
  if (value == null || value === '') return
  fields.push({ label, value: String(value) })
}

function pushSection(
  sections: MapElementDetailSection[],
  title: string,
  items: string[],
) {
  sections.push({ title, items })
}

export function buildDraftElementDetail(
  el: MapDraftElement,
  ctx: DetailCtx,
): MapElementDetail {
  const drafts = ctx.drafts
  const clients = ctx.locations?.clients ?? []
  const nodes = ctx.nodes ?? []
  const byId = new Map(drafts.map((d) => [d.id, d]))
  const clientLabel = (id: string | null | undefined) =>
    id ? (clients.find((c) => c.id === id)?.label ?? id) : null

  const kind = mapElementLabel[el.type]
  const name = el.name || kind
  const fields: MapElementDetailField[] = []
  const sections: MapElementDetailSection[] = []

  pushField(fields, 'Notas', el.notes || null)
  pushField(fields, 'Ubicación', `${el.lat.toFixed(5)}, ${el.lng.toFixed(5)}`)

  if (el.type === 'pole') {
    const hooked = cablesThroughPole(el.id, drafts)
    pushSection(
      sections,
      'Cables / drops',
      hooked.map(
        (c) =>
          `${c.name || mapElementLabel[c.type]} (${mapElementLabel[c.type]})`,
      ),
    )
  }

  if (el.type === 'cable' || el.type === 'drop') {
    const tubes = cableTubes(el)
    const fibers = cableFibers(el)
    const lengthM = pathLengthMeters(el.path)
    pushField(fields, 'Puntos de ruta', el.path?.length ?? 0)
    pushField(
      fields,
      'Largo total',
      lengthM > 0 ? formatPathLength(lengthM) : 'Sin ruta',
    )
    if (el.type === 'cable') {
      pushField(fields, 'Minitubos', tubes.length)
      pushField(fields, 'Pelos', fibers.length)
      pushField(fields, 'Norma color', el.colorNorm || null)
      if (tubes.length) {
        pushSection(
          sections,
          'Minitubos',
          tubes.map((t) => `${t.name} · ${t.fibers.length} pelo(s)`),
        )
      }
    } else {
      pushField(fields, 'Pelos', fibers.length)
      if (fibers.length) {
        pushSection(
          sections,
          'Pelos',
          fibers.map((f) => f.name),
        )
      }
      const nap = findNapForDrop(el, drafts)
      const cid = dropClientId(el)
      pushField(fields, 'NAP', nap ? draftName(nap) : 'Sin NAP')
      pushField(fields, 'Cliente', clientLabel(cid) ?? 'Sin cliente')
    }
    pushSection(sections, 'Enganches', pathAnchors(el, drafts, clients, nodes))
  }

  if (el.type === 'mufa' || el.type === 'nap') {
    const entering =
      el.type === 'mufa'
        ? cablesEnteringMufa(el, drafts)
        : cablesEnteringNap(el, drafts)
    const trays = el.trays ?? []
    const conns = el.connections ?? []
    pushField(fields, 'Bandejas', trays.length)
    pushField(fields, 'Uniones', conns.length)
    pushSection(
      sections,
      'Cables entrantes',
      entering.map(
        (c) =>
          `${c.name || mapElementLabel[c.type]} (${mapElementLabel[c.type]})`,
      ),
    )
    if (trays.length) {
      pushSection(
        sections,
        'Bandejas',
        trays.map((t) => {
          const tubeN = t.tubes?.length ?? 0
          const fiberN = t.fibers?.length ?? 0
          return `${t.name} · ${tubeN} tubo(s) · ${fiberN} pelo(s)`
        }),
      )
    }
    if (conns.length) {
      pushSection(
        sections,
        'Conexiones',
        conns.map((c) => {
          const from = byId.get(c.fromCableId)
          const to = byId.get(c.toCableId)
          const tray = trays.find((t) => t.id === c.trayId)
          return `${tray?.name ?? 'Bandeja'} · ${draftName(from)}/${fiberLabel(from, c.fromFiberId)} ↔ ${draftName(to)}/${fiberLabel(to, c.toFiberId)}`
        }),
      )
    }
  }

  if (el.type === 'nap') {
    const splitters = el.splitters ?? []
    pushField(fields, 'Splitters', splitters.length)
    if (splitters.length) {
      pushSection(
        sections,
        'Splitters',
        splitters.map((s) => {
          const used = s.ports.filter((p) => p.clientId || p.dropId).length
          const input =
            s.inputCableId && s.inputFiberId
              ? fiberLabel(byId.get(s.inputCableId), s.inputFiberId)
              : 'sin entrada'
          const ports = s.ports
            .filter((p) => p.clientId || p.dropId)
            .map((p) => {
              if (p.clientId) {
                return `P${p.index} → cliente ${clientLabel(p.clientId)}`
              }
              const drop = p.dropId ? byId.get(p.dropId) : null
              return `P${p.index} → drop ${draftName(drop)}`
            })
          const portsTxt = ports.length ? ` · ${ports.join('; ')}` : ''
          return `${s.name} 1:${s.ratio} · ${used}/${s.ratio} ocupados · entrada ${input}${portsTxt}`
        }),
      )
    }
  }

  if (el.type === 'zone') {
    pushField(fields, 'Vértices', el.path?.length ?? 0)
    pushField(fields, 'Color', el.color || null)
    pushField(fields, 'Zona CRM', el.zoneId || null)
  }

  return { kind, name, fields, sections }
}

export function buildClientDetail(
  client: NetworkMapLocations['clients'][number],
  ctx: DetailCtx,
): MapElementDetail {
  const drafts = ctx.drafts
  const drops = drafts.filter(
    (d) => d.type === 'drop' && dropClientId(d) === client.clientId,
  )
  const nap = findNapForClient(client.clientId, drafts)
  const onus = (ctx.locations?.onus ?? []).filter(
    (o) => o.clientId === client.clientId,
  )
  const fields: MapElementDetailField[] = []
  const sections: MapElementDetailSection[] = []
  pushField(fields, 'Detalle', client.subtitle)
  pushField(fields, 'Ubicación', `${client.lat.toFixed(5)}, ${client.lng.toFixed(5)}`)
  pushField(fields, 'NAP', nap ? draftName(nap) : 'Sin NAP')
  pushSection(
    sections,
    'Drops',
    drops.map((d) => d.name || 'Drop'),
  )
  pushSection(
    sections,
    'ONUs / servicios',
    onus.map(
      (o) =>
        `${o.label}${o.planName ? ` · ${o.planName}` : ''}${o.onuSn ? ` · SN ${o.onuSn}` : ''}`,
    ),
  )
  return { kind: 'Cliente', name: client.label, fields, sections }
}

export function buildOnuDetail(
  onu: NetworkMapLocations['onus'][number],
): MapElementDetail {
  const fields: MapElementDetailField[] = []
  pushField(fields, 'Detalle', onu.subtitle)
  pushField(fields, 'Servicio', onu.serviceName)
  pushField(fields, 'Plan', onu.planName)
  pushField(fields, 'SN', onu.onuSn)
  pushField(fields, 'Interfaz', onu.onuIf)
  pushField(fields, 'Ubicación', `${onu.lat.toFixed(5)}, ${onu.lng.toFixed(5)}`)
  return { kind: 'ONU · servicio', name: onu.label, fields, sections: [] }
}

export function buildNodeDetail(
  node: NetworkNodeMapMarker,
  ctx: DetailCtx,
): MapElementDetail {
  const cables = cablesEnteringNode(node.id, ctx.drafts)
  const fields: MapElementDetailField[] = []
  const sections: MapElementDetailSection[] = []
  pushField(fields, 'Detalle', node.subtitle)
  pushField(fields, 'Estado', nodeHealthLabel[node.health] ?? node.health)
  pushField(fields, 'Activos', node.assetCount)
  pushField(fields, 'En línea', node.onlineCount)
  pushField(fields, 'Desconectados', node.offlineCount)
  pushField(fields, 'Ubicación', `${node.lat.toFixed(5)}, ${node.lng.toFixed(5)}`)
  pushSection(
    sections,
    'Cables / drops',
    cables.map(
      (c) =>
        `${c.name || mapElementLabel[c.type]} (${mapElementLabel[c.type]})`,
    ),
  )
  return { kind: 'Nodo', name: node.label, fields, sections }
}

export function resolveInspectedDetail(
  target: MapInspectTarget | null,
  ctx: DetailCtx,
): MapElementDetail | null {
  if (!target) return null
  if (target.type === 'client') {
    const client = ctx.locations?.clients.find((c) => c.id === target.id)
    return client ? buildClientDetail(client, ctx) : null
  }
  if (target.type === 'onu') {
    const onu = ctx.locations?.onus.find((o) => o.id === target.id)
    return onu ? buildOnuDetail(onu) : null
  }
  if (target.type === 'node') {
    const node = (ctx.nodes ?? []).find((n) => n.id === target.id)
    return node ? buildNodeDetail(node, ctx) : null
  }
  const draft = ctx.drafts.find((d) => d.id === target.id)
  return draft ? buildDraftElementDetail(draft, ctx) : null
}
