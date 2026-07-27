import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'
import {
  DEFAULT_ZONE_COLOR,
  formatPathLength,
  isFiberPathElement,
  isZoneElement,
  mapElementLabel,
  pathLengthMeters,
  type MapDraftElement,
  type MapElementType,
} from '../lib/map-elements'
import type { NetworkMapLocations } from '../lib/network-map'
import type { NetworkNodeMapMarker } from '../lib/network-nodes'
import {
  NetworkMapCanvas,
  type NetworkMapMarker,
  type NetworkMapPath,
  type NetworkMapPolygon,
} from '../components/NetworkMapCanvas'
import { MapElementEditModal } from '../components/MapElementEditModal'
import { NapViewModal } from '../components/NapViewModal'
import { MufaViewModal } from '../components/MufaViewModal'
import { useMobileMapDrafts } from './useMobileMapDrafts'

const LAYER_ITEMS = [
  { id: 'clients', label: 'Clientes' },
  { id: 'onus', label: 'ONUs' },
  { id: 'nodes', label: 'Nodos' },
  { id: 'nap', label: 'NAP' },
  { id: 'pole', label: 'Poste' },
  { id: 'mufa', label: 'Mufa' },
  { id: 'cable', label: 'Cable' },
  { id: 'drop', label: 'Drop' },
  { id: 'zone', label: 'Zona' },
] as const

type LayerId = (typeof LAYER_ITEMS)[number]['id']

export function MobileNetworkMapViewPage() {
  const { drafts, updateEnclosure, saveElement, deleteElement } =
    useMobileMapDrafts()
  const [layers, setLayers] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(LAYER_ITEMS.map((l) => [l.id, true])),
  )
  const [layersOpen, setLayersOpen] = useState(false)
  const [fitAllRequest, setFitAllRequest] = useState(0)
  const [viewingNap, setViewingNap] = useState<MapDraftElement | null>(null)
  const [viewingMufa, setViewingMufa] = useState<MapDraftElement | null>(null)
  const [editing, setEditing] = useState<MapDraftElement | null>(null)

  const locationsQuery = useQuery({
    queryKey: ['app', 'network-map', 'locations'],
    queryFn: () =>
      apiFetch<NetworkMapLocations>('/app/network-map/locations'),
    staleTime: 60_000,
  })

  const nodesQuery = useQuery({
    queryKey: ['app', 'network-nodes', 'map-markers'],
    queryFn: () =>
      apiFetch<NetworkNodeMapMarker[]>('/app/network-nodes/map-markers'),
    staleTime: 30_000,
  })

  const markers = useMemo((): NetworkMapMarker[] => {
    const data = locationsQuery.data
    const out: NetworkMapMarker[] = []
    if (layers.clients && data) {
      for (const c of data.clients) {
        out.push({
          id: `client:${c.id}`,
          kind: 'client',
          lat: c.lat,
          lng: c.lng,
          label: c.label,
          subtitle: c.subtitle,
        })
      }
    }
    if (layers.onus && data) {
      for (const o of data.onus) {
        out.push({
          id: `onu:${o.id}`,
          kind: 'onu',
          lat: o.lat,
          lng: o.lng,
          label: o.label,
          subtitle: o.subtitle,
        })
      }
    }
    if (layers.nodes) {
      for (const n of nodesQuery.data ?? []) {
        out.push({
          id: `node:${n.id}`,
          kind: 'node',
          lat: n.lat,
          lng: n.lng,
          label: n.label,
          subtitle: n.subtitle,
          health: n.health,
          onlineCount: n.onlineCount,
          offlineCount: n.offlineCount,
          assetCount: n.assetCount,
        })
      }
    }
    for (const d of drafts) {
      if (d.type === 'cable' || d.type === 'drop' || d.type === 'zone') continue
      if (layers[d.type] === false) continue
      out.push({
        id: `element:${d.id}`,
        kind: d.type,
        lat: d.lat,
        lng: d.lng,
        label: d.name || mapElementLabel[d.type],
        subtitle: d.notes || null,
      })
    }
    return out
  }, [drafts, layers, locationsQuery.data, nodesQuery.data])

  const paths = useMemo((): NetworkMapPath[] => {
    return drafts
      .filter(
        (d) =>
          isFiberPathElement(d) &&
          (d.path?.length ?? 0) >= 1 &&
          layers[d.type] !== false,
      )
      .map((d) => {
        const lengthLabel =
          (d.path?.length ?? 0) >= 2
            ? ` · ${formatPathLength(pathLengthMeters(d.path))}`
            : ''
        return {
          id: d.id,
          label: `${d.name || mapElementLabel[d.type]}${lengthLabel}`,
          color: d.type === 'drop' ? '#94a3b8' : '#0f172a',
          points: (d.path ?? []).map(
            (v) => [v.lat, v.lng] as [number, number],
          ),
        }
      })
  }, [drafts, layers])

  const polygons = useMemo((): NetworkMapPolygon[] => {
    if (layers.zone === false) return []
    return drafts
      .filter((d) => isZoneElement(d) && (d.path?.length ?? 0) >= 1)
      .map((d) => ({
        id: d.id,
        label: d.name || mapElementLabel.zone,
        color: d.color || DEFAULT_ZONE_COLOR,
        points: (d.path ?? []).map((v) => [v.lat, v.lng] as [number, number]),
        interactive: false,
      }))
  }, [drafts, layers.zone])

  function toggleLayer(id: LayerId) {
    setLayers((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  function onMarkerClick(marker: NetworkMapMarker) {
    if (!marker.id.startsWith('element:')) return
    const id = marker.id.slice('element:'.length)
    const el = drafts.find((d) => d.id === id)
    if (!el) return
    if (el.type === 'nap') setViewingNap(el)
    else if (el.type === 'mufa') setViewingMufa(el)
  }

  const liveNap = viewingNap
    ? (drafts.find((d) => d.id === viewingNap.id) ?? viewingNap)
    : null
  const liveMufa = viewingMufa
    ? (drafts.find((d) => d.id === viewingMufa.id) ?? viewingMufa)
    : null

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-3 flex items-center gap-3">
        <Link
          to="/movil/mapa-red/tecnico"
          className="rounded-xl border border-[var(--border)] px-3 py-2 text-sm text-[var(--text-muted)]"
        >
          ←
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold tracking-tight">Mapa</h1>
          <p className="text-xs text-[var(--text-muted)]">
            Tocá NAP o mufa para ver
          </p>
        </div>
        <button
          type="button"
          onClick={() => setLayersOpen((v) => !v)}
          className="rounded-xl border border-[var(--border)] px-3 py-2 text-sm font-medium"
        >
          Capas
        </button>
        <button
          type="button"
          onClick={() => setFitAllRequest((n) => n + 1)}
          className="rounded-xl border border-[var(--border)] px-3 py-2 text-sm"
          title="Centrar todo"
        >
          ⊡
        </button>
      </div>

      {layersOpen && (
        <div className="mb-3 rounded-2xl border border-[var(--border)] bg-[var(--bg-elevated)] p-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
            Capas visibles
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {LAYER_ITEMS.map((l) => (
              <label
                key={l.id}
                className="flex items-center gap-2 rounded-lg border border-[var(--border)] px-2.5 py-2 text-sm"
              >
                <input
                  type="checkbox"
                  checked={layers[l.id] !== false}
                  onChange={() => toggleLayer(l.id)}
                />
                {l.label}
              </label>
            ))}
          </div>
        </div>
      )}

      <div className="relative min-h-[60dvh] flex-1 overflow-hidden rounded-2xl border border-[var(--border)]">
        <NetworkMapCanvas
          className="absolute inset-0 h-full w-full"
          markers={markers}
          paths={paths}
          polygons={polygons}
          fitToMarkers
          fitAllRequest={fitAllRequest}
          onMarkerClick={onMarkerClick}
        />
      </div>

      <NapViewModal
        open={!!liveNap}
        nap={liveNap}
        drafts={drafts}
        clients={locationsQuery.data?.clients ?? []}
        mobile
        onClose={() => setViewingNap(null)}
        onChange={updateEnclosure}
        onEdit={(n) => {
          setViewingNap(null)
          setEditing(n)
        }}
      />

      <MufaViewModal
        open={!!liveMufa}
        mufa={liveMufa}
        drafts={drafts}
        mobile
        onClose={() => setViewingMufa(null)}
        onChange={updateEnclosure}
        onEdit={(m) => {
          setViewingMufa(null)
          setEditing(m)
        }}
      />

      <MapElementEditModal
        open={!!editing}
        element={editing}
        type={(editing?.type ?? 'nap') as MapElementType}
        isNew={false}
        allDrafts={drafts}
        clients={locationsQuery.data?.clients ?? []}
        onClose={() => setEditing(null)}
        onSave={(next) => {
          saveElement(next)
          setEditing(null)
        }}
        onDelete={(id) => {
          deleteElement(id)
          setEditing(null)
        }}
      />
    </div>
  )
}
