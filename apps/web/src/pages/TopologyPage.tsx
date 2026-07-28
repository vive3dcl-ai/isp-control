import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthContext'
import { apiFetch } from '../lib/api'
import {
  canWriteTopology,
  deviceTypeLabel,
  layoutTopology,
  type NetworkDeviceType,
  type TopologyDevice,
  type TopologyGraph,
} from '../lib/topology'
import { PanelShell } from '../components/PanelShell'
import { DeviceFormModal } from '../components/DeviceFormModal'
import { DeviceDetailModal } from '../components/DeviceDetailModal'
import { VpnModal } from '../components/VpnModal'
import { OnuDetailModal } from '../components/OnuDetailModal'
import {
  formatSignal,
  signalBand,
  type ConnectedOnu,
  type ConnectedOnusResponse,
} from '../lib/onu-connected'

const TYPE_COLOR: Record<NetworkDeviceType, string> = {
  internet: '#7dd3fc',
  router: '#2f9cff',
  switch: '#22c55e',
  olt: '#f59e0b',
  server: '#a78bfa',
  onu: '#94a3b8',
  ont: '#64748b',
  cpe_router: '#38bdf8',
}

const NODE_W = 100
const NODE_H = 56
const CLOUD_W = 120
const CLOUD_H = 72
const MIN_SCALE = 0.25
const MAX_SCALE = 4

// PON / ONU expansion (a la derecha de cada OLT)
const PON_W = 58
const PON_H = 20
const PON_OFFSET_X = 60
const PON_BLOCK_GAP = 12
const ONU_COLS = 10
const DOT_GAP = 15
const DOT_R = 5

type ViewTransform = { x: number; y: number; scale: number }

type Bounds = { minX: number; minY: number; maxX: number; maxY: number }

type PonBlock = {
  id: string
  oltId: string
  label: string
  x: number
  y: number
  h: number
  lineFrom: { x: number; y: number }
  online: number
  total: number
  dots: Array<{ onu: ConnectedOnu; cx: number; cy: number; color: string }>
}

/** Heat-map por señal: verde buena, ámbar media, rojo baja, gris offline. */
function onuHeatColor(o: ConnectedOnu): string {
  if (!o.online) return '#64748b'
  const band = signalBand(o.signalDbm)
  if (band === 'good') return '#22c55e'
  if (band === 'fair') return '#f59e0b'
  if (band === 'poor') return '#ef4444'
  return '#38bdf8'
}

/** `gpon-onu_1/2/6:1` → `1/2/6` (fallback board/port). */
function ponPortKey(o: ConnectedOnu): string {
  const m = o.onuIf?.match(/_(\d+\/\d+\/\d+):/)
  if (m) return m[1]
  return `${o.board || '?'}/${o.port || '?'}`
}

function comparePortKeys(a: string, b: string): number {
  const pa = a.split('/').map(Number)
  const pb = b.split('/').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

/** Layout de puertos PON + ONUs colgando de cada OLT (coords mundo). */
function layoutPonExpansion(
  onus: ConnectedOnu[],
  positions: Map<string, { x: number; y: number }>,
  devices: TopologyDevice[],
): { blocks: PonBlock[]; bounds: Bounds | null } {
  const oltIds = new Set(
    devices.filter((d) => d.type === 'olt').map((d) => d.id),
  )
  const byOlt = new Map<string, Map<string, ConnectedOnu[]>>()
  for (const o of onus) {
    if (!oltIds.has(o.oltId) || !positions.has(o.oltId)) continue
    const ports = byOlt.get(o.oltId) ?? new Map<string, ConnectedOnu[]>()
    const key = ponPortKey(o)
    const list = ports.get(key) ?? []
    list.push(o)
    ports.set(key, list)
    byOlt.set(o.oltId, ports)
  }

  const blocks: PonBlock[] = []
  let bounds: Bounds | null = null
  const extend = (x: number, y: number) => {
    if (!bounds) bounds = { minX: x, minY: y, maxX: x, maxY: y }
    else {
      bounds.minX = Math.min(bounds.minX, x)
      bounds.minY = Math.min(bounds.minY, y)
      bounds.maxX = Math.max(bounds.maxX, x)
      bounds.maxY = Math.max(bounds.maxY, y)
    }
  }

  for (const [oltId, ports] of byOlt) {
    const oltPos = positions.get(oltId)!
    const keys = [...ports.keys()].sort(comparePortKeys)

    const blockHeights = keys.map((k) => {
      const n = ports.get(k)!.length
      const rows = Math.ceil(n / ONU_COLS)
      return Math.max(PON_H, rows * DOT_GAP)
    })
    const totalH =
      blockHeights.reduce((s, h) => s + h, 0) +
      PON_BLOCK_GAP * Math.max(0, keys.length - 1)

    const portX = oltPos.x + NODE_W + PON_OFFSET_X
    let cursorY = oltPos.y + NODE_H / 2 - totalH / 2

    keys.forEach((key, idx) => {
      const list = ports
        .get(key)!
        .slice()
        .sort((a, b) => a.onuIf.localeCompare(b.onuIf))
      const h = blockHeights[idx]
      const portY = cursorY + h / 2 - PON_H / 2
      const dotsX = portX + PON_W + 18

      const dots = list.map((onu, i) => {
        const col = i % ONU_COLS
        const row = Math.floor(i / ONU_COLS)
        const cx = dotsX + col * DOT_GAP + DOT_R
        const cy = cursorY + row * DOT_GAP + DOT_R + 2
        extend(cx + DOT_R, cy + DOT_R)
        return { onu, cx, cy, color: onuHeatColor(onu) }
      })

      extend(portX, cursorY)
      extend(portX + PON_W, cursorY + h)

      blocks.push({
        id: `${oltId}:${key}`,
        oltId,
        label: key,
        x: portX,
        y: portY,
        h,
        lineFrom: { x: oltPos.x + NODE_W, y: oltPos.y + NODE_H / 2 },
        online: list.filter((o) => o.online).length,
        total: list.length,
        dots,
      })
      cursorY += h + PON_BLOCK_GAP
    })
  }

  return { blocks, bounds }
}

function nodeSize(type: NetworkDeviceType) {
  return type === 'internet'
    ? { w: CLOUD_W, h: CLOUD_H }
    : { w: NODE_W, h: NODE_H }
}

function contentBounds(
  positions: Map<string, { x: number; y: number }>,
  devices: TopologyDevice[],
  extra?: Bounds | null,
) {
  const byId = new Map(devices.map((d) => [d.id, d]))
  const vals = [...positions.entries()]
  if (vals.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0 }
  }
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const [id, p] of vals) {
    const size = nodeSize(byId.get(id)?.type ?? 'router')
    minX = Math.min(minX, p.x)
    minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x + size.w)
    maxY = Math.max(maxY, p.y + size.h)
  }
  if (extra) {
    minX = Math.min(minX, extra.minX)
    minY = Math.min(minY, extra.minY)
    maxX = Math.max(maxX, extra.maxX)
    maxY = Math.max(maxY, extra.maxY)
  }
  return { minX, minY, maxX, maxY }
}

function fitView(
  positions: Map<string, { x: number; y: number }>,
  devices: TopologyDevice[],
  vw: number,
  vh: number,
  extra?: Bounds | null,
): ViewTransform {
  if (positions.size === 0 || vw <= 0 || vh <= 0) {
    return { x: 0, y: 0, scale: 1 }
  }
  const { minX, minY, maxX, maxY } = contentBounds(positions, devices, extra)
  const pad = 48
  const contentW = Math.max(maxX - minX, 1)
  const contentH = Math.max(maxY - minY, 1)
  const scale = Math.min(
    (vw - pad * 2) / contentW,
    (vh - pad * 2) / contentH,
    1.25,
  )
  const cx = (minX + maxX) / 2
  const cy = (minY + maxY) / 2
  return {
    scale,
    x: vw / 2 - cx * scale,
    y: vh / 2 - cy * scale,
  }
}

export function TopologyPage() {
  const { user } = useAuth()
  const canWrite = canWriteTopology(user?.tenantRole)
  const [createOpen, setCreateOpen] = useState(false)
  const [vpnOpen, setVpnOpen] = useState(false)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [editDevice, setEditDevice] = useState<TopologyDevice | null>(null)
  const [onuSel, setOnuSel] = useState<{
    oltId: string
    onuIf: string
  } | null>(null)

  const viewportRef = useRef<HTMLDivElement>(null)
  const [view, setView] = useState<ViewTransform>({ x: 0, y: 0, scale: 1 })
  const viewRef = useRef(view)
  viewRef.current = view
  const [size, setSize] = useState({ w: 800, h: 480 })
  const [isPanning, setIsPanning] = useState(false)
  const panRef = useRef<{
    active: boolean
    lastX: number
    lastY: number
    moved: boolean
  } | null>(null)
  const pointersRef = useRef(
    new Map<number, { x: number; y: number }>(),
  )
  const pinchRef = useRef<{
    dist: number
    scale: number
    midX: number
    midY: number
    viewX: number
    viewY: number
  } | null>(null)
  /** Tras pan/zoom del usuario no auto-centramos hasta recargar. */
  const userMovedRef = useRef(false)
  /** Auto-fit solo una vez por carga de página. */
  const fittedOnceRef = useRef(false)

  const graphQuery = useQuery({
    queryKey: ['app', 'topology'],
    queryFn: () => apiFetch<TopologyGraph>('/app/topology'),
    refetchInterval: 15_000,
  })

  const onusQuery = useQuery({
    queryKey: ['app', 'onus', 'topology'],
    queryFn: () => apiFetch<ConnectedOnusResponse>('/app/onus'),
    refetchInterval: 30_000,
  })

  const devices = graphQuery.data?.devices ?? []
  const links = graphQuery.data?.links ?? []

  const positions = useMemo(
    () => layoutTopology(devices, links),
    [devices, links],
  )

  const ponExpansion = useMemo(
    () =>
      layoutPonExpansion(onusQuery.data?.onus ?? [], positions, devices),
    [onusQuery.data?.onus, positions, devices],
  )

  const layoutRef = useRef<{
    positions: Map<string, { x: number; y: number }>
    devices: TopologyDevice[]
    bounds: Bounds | null
  }>({
    positions: new Map(),
    devices: [],
    bounds: null,
  })
  layoutRef.current = {
    positions,
    devices,
    bounds: ponExpansion.bounds,
  }

  const portToDevice = useMemo(() => {
    const map = new Map<string, string>()
    for (const d of devices) {
      for (const p of d.ports) map.set(p.id, d.id)
    }
    return map
  }, [devices])

  const deviceById = useMemo(
    () => new Map(devices.map((d) => [d.id, d])),
    [devices],
  )

  const detailDevice = detailId
    ? (deviceById.get(detailId) ?? null)
    : null

  const centerView = useCallback(() => {
    const el = viewportRef.current
    if (!el) return
    const { positions: pos, devices: devs, bounds } = layoutRef.current
    const rect = el.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return
    setSize({ w: rect.width, h: rect.height })
    setView(fitView(pos, devs, rect.width, rect.height, bounds))
    fittedOnceRef.current = true
  }, [])

  function markUserMoved() {
    userMovedRef.current = true
  }

  // Auto-fit una sola vez al cargar (espera datos + viewport medible).
  // No se resetea en refetch; si el usuario movió, no se vuelve a centrar.
  useEffect(() => {
    if (userMovedRef.current || fittedOnceRef.current) return
    if (positions.size === 0) return
    if (graphQuery.isLoading || onusQuery.isLoading) return
    centerView()
  }, [positions.size, graphQuery.isLoading, onusQuery.isLoading, centerView])

  // Resize: tamaño del SVG; primer fit si aún no hubo interacción.
  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      const rect = el.getBoundingClientRect()
      setSize({ w: rect.width, h: rect.height })
      if (
        !userMovedRef.current &&
        !fittedOnceRef.current &&
        layoutRef.current.positions.size > 0 &&
        rect.width > 0 &&
        rect.height > 0
      ) {
        centerView()
      }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [centerView])

  useEffect(() => {
    const el = viewportRef.current
    if (!el) return

    function onWheel(e: WheelEvent) {
      e.preventDefault()
      markUserMoved()
      const rect = el!.getBoundingClientRect()
      const mx = e.clientX - rect.left
      const my = e.clientY - rect.top
      setView((prev) => {
        const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12
        const nextScale = Math.min(
          MAX_SCALE,
          Math.max(MIN_SCALE, prev.scale * factor),
        )
        if (nextScale === prev.scale) return prev
        const worldX = (mx - prev.x) / prev.scale
        const worldY = (my - prev.y) / prev.scale
        return {
          scale: nextScale,
          x: mx - worldX * nextScale,
          y: my - worldY * nextScale,
        }
      })
    }

    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  function syncPinch(
    el: HTMLDivElement,
    a: { x: number; y: number },
    b: { x: number; y: number },
  ) {
    const dist = Math.hypot(b.x - a.x, b.y - a.y)
    if (dist < 1) return
    const rect = el.getBoundingClientRect()
    const midX = (a.x + b.x) / 2 - rect.left
    const midY = (a.y + b.y) / 2 - rect.top
    const pinch = pinchRef.current
    if (!pinch) {
      const prev = viewRef.current
      pinchRef.current = {
        dist,
        scale: prev.scale,
        midX,
        midY,
        viewX: prev.x,
        viewY: prev.y,
      }
      return
    }
    markUserMoved()
    const nextScale = Math.min(
      MAX_SCALE,
      Math.max(MIN_SCALE, pinch.scale * (dist / pinch.dist)),
    )
    const worldX = (pinch.midX - pinch.viewX) / pinch.scale
    const worldY = (pinch.midY - pinch.viewY) / pinch.scale
    setView({
      scale: nextScale,
      x: midX - worldX * nextScale,
      y: midY - worldY * nextScale,
    })
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0 && e.button !== 1) return
    // No preventDefault en mouse: si capturamos el pointer, el click SVG se pierde.
    // En touch evitamos scroll del navegador.
    if (e.pointerType !== 'mouse') e.preventDefault()
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // ignore
    }
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })

    if (pointersRef.current.size >= 2) {
      panRef.current = null
      setIsPanning(false)
      const [a, b] = [...pointersRef.current.values()]
      pinchRef.current = null
      syncPinch(e.currentTarget, a, b)
      return
    }

    pinchRef.current = null
    panRef.current = {
      active: true,
      lastX: e.clientX,
      lastY: e.clientY,
      moved: false,
    }
    setIsPanning(true)
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!pointersRef.current.has(e.pointerId)) return
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })

    if (pointersRef.current.size >= 2) {
      const [a, b] = [...pointersRef.current.values()]
      syncPinch(e.currentTarget, a, b)
      return
    }

    const pan = panRef.current
    if (!pan?.active) return
    const dx = e.clientX - pan.lastX
    const dy = e.clientY - pan.lastY
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
      pan.moved = true
      markUserMoved()
    }
    pan.lastX = e.clientX
    pan.lastY = e.clientY
    setView((prev) => ({ ...prev, x: prev.x + dx, y: prev.y + dy }))
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    const wasMoved = Boolean(panRef.current?.moved || pinchRef.current)
    const clientX = e.clientX
    const clientY = e.clientY
    const button = e.button

    pointersRef.current.delete(e.pointerId)
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      // ignore
    }

    if (pointersRef.current.size >= 2) {
      const [a, b] = [...pointersRef.current.values()]
      pinchRef.current = null
      syncPinch(e.currentTarget, a, b)
      return
    }

    if (pointersRef.current.size === 1) {
      pinchRef.current = null
      const only = [...pointersRef.current.values()][0]
      panRef.current = {
        active: true,
        lastX: only.x,
        lastY: only.y,
        moved: false,
      }
      setIsPanning(true)
      return
    }

    panRef.current = null
    pinchRef.current = null
    setIsPanning(false)

    // Pointer capture en el viewport cancela el click de los nodos SVG.
    // Abrimos la modal en pointerup si no hubo pan/pinch.
    if (wasMoved || button !== 0) return
    const hit = document.elementFromPoint(clientX, clientY)
    if (!(hit instanceof Element)) return
    const onuEl = hit.closest('[data-topology-onu]')
    if (onuEl) {
      const oltId = onuEl.getAttribute('data-olt-id')
      const onuIf = onuEl.getAttribute('data-onu-if')
      if (oltId && onuIf) setOnuSel({ oltId, onuIf })
      return
    }
    const deviceEl = hit.closest('[data-topology-device]')
    const id = deviceEl?.getAttribute('data-topology-device')
    if (id) setDetailId(id)
  }
  return (
    <PanelShell
      title="Topología"
      subtitle="Activos de red y conexiones"
      variant="tenant"
    >
      <div className="mb-4 flex flex-wrap items-center justify-end gap-3">
        <div className="flex shrink-0 flex-wrap gap-2">
          <button
            type="button"
            onClick={centerView}
            className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm hover:border-[var(--accent)] hover:text-[var(--accent)]"
          >
            Centrar
          </button>
          {canWrite && (
            <>
              <button
                type="button"
                onClick={() => setVpnOpen(true)}
                className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm hover:border-[var(--accent)] hover:text-[var(--accent)] sm:px-4"
                title="OpenVPN / WireGuard al concentrador"
              >
                VPN
              </button>
              <button
                type="button"
                onClick={() => setCreateOpen(true)}
                className="rounded-lg bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)] sm:px-4"
              >
                Agregar activo
              </button>
            </>
          )}
        </div>
      </div>

      {graphQuery.error && (
        <p className="mb-4 text-sm text-[var(--danger)]">
          {graphQuery.error.message}
        </p>
      )}

      <div
        ref={viewportRef}
        className="relative h-[min(70vh,560px)] overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg)] select-none"
        style={{
          cursor: isPanning ? 'grabbing' : 'grab',
          touchAction: 'none',
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onAuxClick={(e) => e.preventDefault()}
      >
        {graphQuery.isLoading && (
          <p className="absolute inset-0 flex items-center justify-center text-[var(--text-muted)]">
            Cargando…
          </p>
        )}
        {!graphQuery.isLoading && devices.length === 0 && (
          <p className="absolute inset-0 flex items-center justify-center p-6 text-center text-[var(--text-muted)]">
            No hay activos. Agrega un router, switch u OLT para empezar.
          </p>
        )}
        {devices.length > 0 && (
          <svg
            width={size.w}
            height={size.h}
            className="block h-full w-full"
            role="img"
            aria-label="Plano topológico"
          >
            <g
              transform={`translate(${view.x}, ${view.y}) scale(${view.scale})`}
            >
              {links.map((link) => {
                const aDev = portToDevice.get(link.portAId)
                const bDev = portToDevice.get(link.portBId)
                if (!aDev || !bDev) return null
                const a = positions.get(aDev)
                const b = positions.get(bDev)
                if (!a || !b) return null
                const aDevice = deviceById.get(aDev)
                const bDevice = deviceById.get(bDev)
                const aSize = nodeSize(aDevice?.type ?? 'router')
                const bSize = nodeSize(bDevice?.type ?? 'router')
                const aPort = aDevice?.ports.find((p) => p.id === link.portAId)
                const bPort = bDevice?.ports.find((p) => p.id === link.portBId)
                const title = `${aDevice?.name}/${aPort?.name} ↔ ${bDevice?.name}/${bPort?.name}`
                return (
                  <g key={link.id}>
                    <title>{title}</title>
                    <line
                      x1={a.x + aSize.w / 2}
                      y1={a.y + aSize.h / 2}
                      x2={b.x + bSize.w / 2}
                      y2={b.y + bSize.h / 2}
                      stroke="var(--border)"
                      strokeWidth={2 / view.scale}
                    />
                  </g>
                )
              })}
              {ponExpansion.blocks.map((b) => (
                <g key={b.id}>
                  <line
                    x1={b.lineFrom.x}
                    y1={b.lineFrom.y}
                    x2={b.x}
                    y2={b.y + PON_H / 2}
                    stroke="var(--border)"
                    strokeWidth={1.5 / view.scale}
                    strokeDasharray="4 3"
                  />
                  <g>
                    <title>
                      PON {b.label} · {b.online}/{b.total} ONUs online
                    </title>
                    <rect
                      x={b.x}
                      y={b.y}
                      width={PON_W}
                      height={PON_H}
                      rx={4}
                      fill="var(--bg-elevated)"
                      stroke="#f59e0b"
                      strokeWidth={1.5 / view.scale}
                    />
                    <text
                      x={b.x + PON_W / 2}
                      y={b.y + PON_H / 2 + 3.5}
                      textAnchor="middle"
                      fill="var(--text)"
                      fontSize={9.5}
                      fontWeight={600}
                    >
                      {b.label}
                    </text>
                  </g>
                  {b.dots.map((dot) => (
                    <circle
                      key={dot.onu.id}
                      cx={dot.cx}
                      cy={dot.cy}
                      r={DOT_R}
                      fill={dot.color}
                      opacity={dot.onu.online ? 1 : 0.55}
                      className="cursor-pointer"
                      data-topology-onu=""
                      data-olt-id={dot.onu.oltId}
                      data-onu-if={dot.onu.onuIf}
                    >
                      <title>
                        {`${dot.onu.name || dot.onu.sn || dot.onu.onuIf}\n${dot.onu.onuIf}\n${
                          dot.onu.online
                            ? `Online · ${formatSignal(dot.onu.signalDbm)}`
                            : 'Offline'
                        }`}
                      </title>
                    </circle>
                  ))}
                </g>
              ))}
              {devices.map((d) => {
                const pos = positions.get(d.id)
                if (!pos) return null
                const baseColor = TYPE_COLOR[d.type] ?? '#2f9cff'
                const offline =
                  d.type === 'router' &&
                  !!d.mgmtHost &&
                  (d.connectionStatus === 'disconnected' ||
                    d.connectionStatus === 'error')
                const color = offline ? 'var(--danger)' : baseColor
                const isCloud = d.type === 'internet'
                return (
                  <g
                    key={d.id}
                    transform={`translate(${pos.x}, ${pos.y})`}
                    className="cursor-pointer"
                    data-topology-device={d.id}
                  >
                    <title>
                      {d.name} ({deviceTypeLabel[d.type]}
                      {d.connectionStatus && d.mgmtHost
                        ? ` · ${d.connectionStatus}`
                        : ''}
                      )
                    </title>
                    {isCloud ? (
                      <>
                        <path
                          d="M30 52 C12 52 8 40 16 32 C10 18 28 8 42 14 C48 4 72 4 80 16 C96 12 112 22 108 38 C118 40 118 52 100 52 Z"
                          fill="var(--bg-elevated)"
                          stroke={color}
                          strokeWidth={2 / view.scale}
                          opacity={d.isActive ? 1 : 0.5}
                        />
                        <text
                          x={CLOUD_W / 2}
                          y={42}
                          textAnchor="middle"
                          fill="var(--text)"
                          fontSize={13}
                          fontWeight={600}
                        >
                          Internet
                        </text>
                      </>
                    ) : (
                      <>
                        <rect
                          width={NODE_W}
                          height={NODE_H}
                          rx={8}
                          fill="var(--bg-elevated)"
                          stroke={color}
                          strokeWidth={2 / view.scale}
                          opacity={d.isActive ? 1 : 0.5}
                        />
                        <circle cx={14} cy={16} r={5} fill={color} />
                        <text
                          x={24}
                          y={20}
                          fill="var(--text)"
                          fontSize={12}
                          fontWeight={600}
                        >
                          {d.name.length > 12
                            ? `${d.name.slice(0, 11)}…`
                            : d.name}
                        </text>
                        <text
                          x={12}
                          y={40}
                          fill="var(--text-muted)"
                          fontSize={10}
                        >
                          {deviceTypeLabel[d.type]} · {d.ports.length}p
                        </text>
                      </>
                    )}
                  </g>
                )
              })}
            </g>
          </svg>
        )}
        {devices.length > 0 && (
          <div className="pointer-events-none absolute right-3 bottom-3 rounded-md border border-[var(--border)] bg-[var(--bg-elevated)]/90 px-2 py-1 text-xs text-[var(--text-muted)]">
            {Math.round(view.scale * 100)}%
          </div>
        )}
      </div>

      {devices.length > 0 && (
        <>
          <ul className="mt-4 flex flex-wrap gap-3 text-xs text-[var(--text-muted)]">
            {(Object.keys(TYPE_COLOR) as NetworkDeviceType[]).map((t) => (
              <li key={t} className="inline-flex items-center gap-1.5">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full"
                  style={{ background: TYPE_COLOR[t] }}
                />
                {deviceTypeLabel[t]}
              </li>
            ))}
          </ul>
          {ponExpansion.blocks.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-3 text-xs text-[var(--text-muted)]">
              <li className="font-medium text-[var(--text)]">Señal ONUs:</li>
              <li className="inline-flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-2.5 rounded-full bg-[#22c55e]" />
                Buena (≥ −25 dBm)
              </li>
              <li className="inline-flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-2.5 rounded-full bg-[#f59e0b]" />
                Media (−25 a −28)
              </li>
              <li className="inline-flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-2.5 rounded-full bg-[#ef4444]" />
                Baja (&lt; −28)
              </li>
              <li className="inline-flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-2.5 rounded-full bg-[#38bdf8]" />
                Online sin señal
              </li>
              <li className="inline-flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-2.5 rounded-full bg-[#64748b] opacity-60" />
                Offline
              </li>
            </ul>
          )}
        </>
      )}

      <DeviceFormModal open={createOpen} onClose={() => setCreateOpen(false)} />
      <DeviceFormModal
        open={!!editDevice}
        device={editDevice}
        onClose={() => setEditDevice(null)}
      />
      <DeviceDetailModal
        open={!!detailId}
        deviceId={detailId}
        canWrite={canWrite}
        onClose={() => setDetailId(null)}
        onEditDevice={() => {
          if (detailDevice) setEditDevice(detailDevice)
        }}
      />
      <VpnModal
        open={vpnOpen}
        onClose={() => setVpnOpen(false)}
        canWrite={canWrite}
      />
      {onuSel && (
        <OnuDetailModal
          oltId={onuSel.oltId}
          onuIf={onuSel.onuIf}
          canWrite={canWrite}
          onClose={() => setOnuSel(null)}
          onRebooted={() => {
            void onusQuery.refetch()
          }}
        />
      )}
    </PanelShell>
  )
}
