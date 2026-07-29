import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthContext'
import { PanelShell } from '../components/PanelShell'
import {
  NetworkMapCanvas,
  type NetworkMapMarker,
  type NetworkMapPath,
  type NetworkMapPolygon,
} from '../components/NetworkMapCanvas'
import { MapElementEditModal } from '../components/MapElementEditModal'
import { MapElementTypeIcon } from '../components/MapElementTypeIcon'
import { MufaViewModal } from '../components/MufaViewModal'
import { apiFetch } from '../lib/api'
import { adoptOrphanMapZones } from '../lib/adopt-map-zones'
import type { TenantModuleCard } from '../lib/modules'
import { formatModulePrice } from '../lib/modules'
import type { NetworkMapLocations } from '../lib/network-map'
import type { NetworkNodeMapMarker } from '../lib/network-nodes'
import {
  DEFAULT_ZONE_COLOR,
  MAP_ELEMENT_TYPES,
  cableFibers,
  cableTubes,
  createDropFibers,
  createMiniTubes,
  createMufaTrays,
  createNapSplitter,
  dropClientId,
  findNapForDrop,
  isFiberPathElement,
  isZoneElement,
  loadMapDrafts,
  mapElementHasIcon,
  mapElementLabel,
  formatPathLength,
  pathLengthMeters,
  saveMapDrafts,
  syncCablePathsToClient,
  syncCablePathsToMufa,
  syncCablePathsToNap,
  syncCablePathsToNode,
  syncCablePathsToPole,
  zoneCentroid,
  type MapDraftElement,
  type MapElementType,
  type MapPathVertex,
} from '../lib/map-elements'
import { NapViewModal } from '../components/NapViewModal'
import { NodeViewModal } from '../components/NodeViewModal'
import { MapElementDetailPanel } from '../components/MapElementDetailPanel'
import {
  resolveInspectedDetail,
  type MapInspectTarget,
} from '../lib/map-element-detail'

type MapTool = 'none' | 'measure'
type SideSection = 'element' | 'edit' | 'tools'

type CrmZone = {
  id: string
  name: string
  description: string
  clientCount: number
}

const TOOLS: { id: MapTool; label: string; hint: string }[] = [
  {
    id: 'measure',
    label: 'Medir',
    hint: 'Clic para poner puntos y ver el largo total del recorrido.',
  },
]

const SIDE_TABS: { id: SideSection; label: string }[] = [
  { id: 'element', label: 'Elemento' },
  { id: 'edit', label: 'Editar' },
  { id: 'tools', label: 'Herramientas' },
]

function newDraftId() {
  return `draft-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

const LAYER_ITEMS = [
  { id: 'clients', label: 'Clientes', enabled: true, group: 'crm' },
  { id: 'onus', label: 'ONUs', enabled: true, group: 'crm' },
  { id: 'nodes', label: 'Nodos', enabled: true, group: 'crm' },
  { id: 'nap', label: 'NAP', enabled: true, group: 'map' },
  { id: 'pole', label: 'Poste', enabled: true, group: 'map' },
  { id: 'mufa', label: 'Mufa', enabled: true, group: 'map' },
  { id: 'cable', label: 'Cable', enabled: true, group: 'map' },
  { id: 'drop', label: 'Drop', enabled: true, group: 'map' },
  { id: 'zone', label: 'Zona', enabled: true, group: 'map' },
] as const

type LayerId = (typeof LAYER_ITEMS)[number]['id']

function layerCount(
  id: LayerId,
  counts: {
    clients: number
    onus: number
    nodes: number
    byType: Partial<Record<MapElementType, number>>
  },
): number | null {
  if (id === 'clients') return counts.clients
  if (id === 'onus') return counts.onus
  if (id === 'nodes') return counts.nodes
  return counts.byType[id as MapElementType] ?? 0
}

export function NetworkMapPage() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const tenantKey = user?.tenantSlug ?? user?.tenantId
  const modulesQuery = useQuery({
    queryKey: ['app', 'settings', 'modules'],
    queryFn: () => apiFetch<TenantModuleCard[]>('/app/settings/modules'),
    staleTime: 60_000,
  })

  const [tool, setTool] = useState<MapTool>('none')
  const [sideTab, setSideTab] = useState<SideSection>('element')
  const [layers, setLayers] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(LAYER_ITEMS.map((l) => [l.id, l.enabled])),
  )
  const [mapLocked, setMapLocked] = useState(true)
  const [sideOpen, setSideOpen] = useState(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia('(min-width: 1024px)').matches,
  )
  const [fitAllRequest, setFitAllRequest] = useState(0)
  const [inspected, setInspected] = useState<MapInspectTarget | null>(null)
  const [measurePoints, setMeasurePoints] = useState<[number, number][]>([])
  const measuring = tool === 'measure'
  const measureLengthM = useMemo(
    () => pathLengthMeters(measurePoints.map(([lat, lng]) => ({ lat, lng }))),
    [measurePoints],
  )

  // Elementos editables (borradores locales hasta definir cada tipo).
  const [drafts, setDrafts] = useState<MapDraftElement[]>([])
  const [draftsReady, setDraftsReady] = useState(false)
  const [elementType, setElementType] = useState<MapElementType>('nap')
  const [placingType, setPlacingType] = useState<MapElementType | null>(null)
  const [editing, setEditing] = useState<MapDraftElement | null>(null)
  const [viewingMufa, setViewingMufa] = useState<MapDraftElement | null>(null)
  const [viewingNap, setViewingNap] = useState<MapDraftElement | null>(null)
  /** Nodo físico abierto en la vista de cabeceras. */
  const [viewingNodeId, setViewingNodeId] = useState<string | null>(null)
  const [selectedCableId, setSelectedCableId] = useState<string | null>(null)
  /** Cable en modo trazo: clics añaden vértices / enganchan postes. */
  const [routingCableId, setRoutingCableId] = useState<string | null>(null)
  /** Desde qué extremo se continúa el trazo: inicio o fin del path. */
  const [routingFrom, setRoutingFrom] = useState<'start' | 'end'>('end')
  /** Zona en modo dibujo de perímetro. */
  const [drawingZoneId, setDrawingZoneId] = useState<string | null>(null)
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null)
  const [zoneCatalogId, setZoneCatalogId] = useState('')
  const [newZoneName, setNewZoneName] = useState('')
  const [zoneError, setZoneError] = useState<string | null>(null)

  useEffect(() => {
    setDrafts(loadMapDrafts(tenantKey))
    setDraftsReady(true)
  }, [tenantKey])

  useEffect(() => {
    if (!draftsReady) return
    saveMapDrafts(tenantKey, drafts)
  }, [drafts, draftsReady, tenantKey])

  // Salir del modo colocación/trazo al cambiar de pestaña.
  useEffect(() => {
    if (sideTab !== 'edit') {
      setPlacingType(null)
      setRoutingCableId(null)
      setRoutingFrom('end')
      setDrawingZoneId(null)
    }
  }, [sideTab])

  // El mapa inicia en modo visualización para evitar ediciones accidentales.
  useEffect(() => {
    if (!mapLocked) return
    setSideTab((current) => (current === 'edit' ? 'element' : current))
    setPlacingType(null)
    setRoutingCableId(null)
    setRoutingFrom('end')
    setDrawingZoneId(null)
    setSelectedCableId(null)
    setSelectedZoneId(null)
    setEditing(null)
    setViewingMufa(null)
    setViewingNap(null)
    setViewingNodeId(null)
    setInspected((prev) => {
      if (!prev || prev.type !== 'draft') return prev
      const draft = drafts.find((d) => d.id === prev.id)
      return draft?.type === 'zone' ? null : prev
    })
    // Solo al bloquear: drafts se lee en el momento del toggle.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mapLocked gate
  }, [mapLocked])

  function inspectTarget(target: MapInspectTarget) {
    setInspected(target)
    setSideTab('element')
    setSideOpen(true)
    if (target.type === 'draft') {
      const draft = drafts.find((d) => d.id === target.id)
      if (draft?.type === 'cable' || draft?.type === 'drop') {
        setSelectedCableId(target.id)
        setSelectedZoneId(null)
      } else if (draft?.type === 'zone') {
        setSelectedZoneId(target.id)
        setSelectedCableId(null)
      } else {
        setSelectedCableId(null)
        setSelectedZoneId(null)
      }
    } else {
      setSelectedCableId(null)
      setSelectedZoneId(null)
    }
  }

  // Al activar Medir: salir de modos de edición.
  useEffect(() => {
    if (!measuring) return
    setPlacingType(null)
    setRoutingCableId(null)
    setRoutingFrom('end')
    setDrawingZoneId(null)
  }, [measuring])

  useEffect(() => {
    if (!placingType && !routingCableId && !drawingZoneId && !measuring) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (measuring) {
          setMeasurePoints([])
          setTool('none')
          return
        }
        if (drawingZoneId) {
          cancelZoneDrawing()
          return
        }
        setPlacingType(null)
        setRoutingCableId(null)
        setRoutingFrom('end')
      }
      if (e.key === 'Backspace' && measuring) {
        e.preventDefault()
        setMeasurePoints((prev) => prev.slice(0, -1))
        return
      }
      if (e.key === 'Backspace' && drawingZoneId) {
        e.preventDefault()
        undoZoneVertex(drawingZoneId)
        return
      }
      if (e.key === 'Backspace' && routingCableId) {
        e.preventDefault()
        undoRouteVertex(routingCableId)
      }
      if ((e.key === 'Enter' || e.key === ' ') && drawingZoneId) {
        e.preventDefault()
        finishZoneDrawing()
        return
      }
      if ((e.key === 'Enter' || e.key === ' ') && routingCableId) {
        e.preventDefault()
        setRoutingCableId(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- helpers close over latest drafts via state setters
  }, [placingType, routingCableId, drawingZoneId, measuring])

  const mod = modulesQuery.data?.find((m) => m.id === 'mapa_red')
  const contracted = !!mod?.contracted
  const price = formatModulePrice(
    mod?.priceMonthly ?? null,
    mod?.priceCurrency ?? null,
  )

  const locationsQuery = useQuery({
    queryKey: ['app', 'network-map', 'locations'],
    queryFn: () =>
      apiFetch<NetworkMapLocations>('/app/network-map/locations'),
    enabled: contracted,
    staleTime: 30_000,
  })

  const zonesQuery = useQuery({
    queryKey: ['app', 'zones'],
    queryFn: () => apiFetch<CrmZone[]>('/app/zones'),
    enabled: contracted,
    staleTime: 30_000,
  })

  /** Dibujar una zona nueva la da de alta también en Ajustes → Zonas. */
  const createZoneMutation = useMutation({
    mutationFn: (name: string) =>
      apiFetch<CrmZone>('/app/zones', {
        method: 'POST',
        body: JSON.stringify({ name, description: '' }),
      }),
    onSuccess: (zone) => {
      void queryClient.invalidateQueries({ queryKey: ['app', 'zones'] })
      setNewZoneName('')
      setZoneError(null)
      setZoneCatalogId(zone.id)
      setRoutingCableId(null)
      setDrawingZoneId(null)
      setPlacingType('zone')
    },
    onError: (e: Error) => setZoneError(e.message),
  })

  const updateZoneMutation = useMutation({
    mutationFn: (input: {
      id: string
      name: string
      description: string
    }) =>
      apiFetch<CrmZone>(`/app/zones/${input.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: input.name,
          description: input.description,
        }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['app', 'zones'] })
    },
  })

  // Ajustes → Zonas es el catálogo: el mapa solo añade perímetro y color.
  // Polígonos sin zona CRM (o con zoneId inválido) se adoptan al catálogo.
  useEffect(() => {
    if (!draftsReady || !zonesQuery.data) return
    if (updateZoneMutation.isPending) return
    let cancelled = false
    void (async () => {
      // Asegura que storage tenga el estado actual antes de adoptar.
      saveMapDrafts(tenantKey, drafts)
      const catalog = [...zonesQuery.data]
      const { created, drafts: synced } = await adoptOrphanMapZones(
        tenantKey,
        catalog,
      )
      if (cancelled) return

      const byId = new Map(
        (created > 0 ? catalog : zonesQuery.data).map((z) => [z.id, z]),
      )
      setDrafts((prev) => {
        const syncedById = new Map(synced.map((s) => [s.id, s]))
        let changed = false
        const next = prev.map((d) => {
          if (d.type !== 'zone') return d
          const fromSync = syncedById.get(d.id)
          let linked = d
          if (fromSync?.zoneId && fromSync.zoneId !== d.zoneId) {
            linked = {
              ...linked,
              zoneId: fromSync.zoneId,
              name: fromSync.name || linked.name,
              notes: fromSync.notes ?? linked.notes,
            }
            changed = true
          }
          if (linked.zoneId && !byId.has(linked.zoneId)) {
            linked = { ...linked, zoneId: null }
            changed = true
          }
          if (!linked.zoneId) return linked
          const zone = byId.get(linked.zoneId)
          if (
            !zone ||
            (linked.name === zone.name && linked.notes === zone.description)
          ) {
            return linked
          }
          changed = true
          return { ...linked, name: zone.name, notes: zone.description }
        })
        return changed ? next : prev
      })
      if (created > 0) {
        void queryClient.invalidateQueries({ queryKey: ['app', 'zones'] })
      }
    })()
    return () => {
      cancelled = true
    }
    // Solo reaccionar al catálogo / listo; no a cada cambio de drafts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    draftsReady,
    zonesQuery.data,
    updateZoneMutation.isPending,
    tenantKey,
    queryClient,
  ])

  const nodesQuery = useQuery({
    queryKey: ['app', 'network-map', 'nodes'],
    queryFn: () =>
      apiFetch<NetworkNodeMapMarker[]>('/app/network-nodes/map-markers'),
    enabled: contracted,
    refetchInterval: contracted ? 15_000 : false,
  })

  // Si un cliente cambia de coordenadas, reengancha los drops.
  useEffect(() => {
    const clients = locationsQuery.data?.clients ?? []
    if (!clients.length) return
    setDrafts((prev) => {
      let next = prev
      let changed = false
      for (const c of clients) {
        const synced = syncCablePathsToClient(next, c.id, c.lat, c.lng)
        if (synced.some((d, i) => d !== next[i])) {
          next = synced
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [locationsQuery.data])

  // Si un nodo cambia de coordenadas (Ajustes), reengancha los cables.
  useEffect(() => {
    const nodes = nodesQuery.data ?? []
    if (!nodes.length) return
    setDrafts((prev) => {
      let next = prev
      let changed = false
      for (const n of nodes) {
        const synced = syncCablePathsToNode(next, n.id, n.lat, n.lng)
        if (synced.some((d, i) => d !== next[i])) {
          next = synced
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [nodesQuery.data])

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
      // Cables, drops y zonas: sin icono; se dibujan como geometría.
      if (d.type === 'cable' || d.type === 'drop' || d.type === 'zone') continue
      if (layers[d.type] === false) continue
      out.push({
        id: `element:${d.id}`,
        kind: d.type,
        lat: d.lat,
        lng: d.lng,
        label: d.name || mapElementLabel[d.type],
        subtitle: d.notes || null,
        editable: !mapLocked && !measuring,
      })
    }
    // Pin pendiente mientras se edita un elemento recién colocado (aún no guardado).
    if (
      editing &&
      editing.type !== 'cable' &&
      editing.type !== 'drop' &&
      editing.type !== 'zone' &&
      layers[editing.type] !== false &&
      !drafts.some((d) => d.id === editing.id)
    ) {
      out.push({
        id: `element:${editing.id}`,
        kind: editing.type,
        lat: editing.lat,
        lng: editing.lng,
        label: editing.name || mapElementLabel[editing.type],
        subtitle: editing.notes || null,
        editable: !mapLocked && !measuring,
      })
    }
    return out
  }, [
    locationsQuery.data,
    nodesQuery.data,
    drafts,
    editing,
    layers,
    mapLocked,
    measuring,
  ])

  const cablePaths = useMemo((): NetworkMapPath[] => {
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
          points: (d.path ?? []).map((v) => [v.lat, v.lng] as [number, number]),
          selected:
            selectedCableId === d.id ||
            (inspected?.type === 'draft' && inspected.id === d.id),
          active: routingCableId === d.id,
        }
      })
  }, [drafts, routingCableId, selectedCableId, layers, inspected])

  const zonePolygons = useMemo((): NetworkMapPolygon[] => {
    if (layers.zone === false) return []
    return drafts
      .filter((d) => isZoneElement(d) && (d.path?.length ?? 0) >= 1)
      .map((d) => ({
        id: d.id,
        label: d.name || mapElementLabel.zone,
        color: d.color || DEFAULT_ZONE_COLOR,
        points: (d.path ?? []).map((v) => [v.lat, v.lng] as [number, number]),
        selected:
          !mapLocked &&
          (selectedZoneId === d.id ||
            (inspected?.type === 'draft' && inspected.id === d.id)),
        active: drawingZoneId === d.id,
        // Bloqueado: solo visualización, sin capturar clics (cables/markers debajo).
        interactive: !mapLocked,
      }))
  }, [
    drafts,
    drawingZoneId,
    selectedZoneId,
    layers.zone,
    inspected,
    mapLocked,
  ])

  const canFitAll = useMemo(
    () =>
      markers.length > 0 ||
      cablePaths.some((p) => p.points.length > 0) ||
      zonePolygons.some((p) => p.points.length > 0),
    [markers, cablePaths, zonePolygons],
  )

  const inspectedDetail = useMemo(
    () =>
      resolveInspectedDetail(inspected, {
        drafts,
        locations: locationsQuery.data,
        nodes: nodesQuery.data ?? [],
      }),
    [inspected, drafts, locationsQuery.data, nodesQuery.data],
  )

  const clientCount = locationsQuery.data?.clients.length ?? 0
  const onuCount = locationsQuery.data?.onus.length ?? 0
  const nodeCount = nodesQuery.data?.length ?? 0
  const draftCounts = useMemo(() => {
    const byType: Partial<Record<MapElementType, number>> = {}
    for (const d of drafts) {
      byType[d.type] = (byType[d.type] ?? 0) + 1
    }
    return byType
  }, [drafts])
  const routingCable = routingCableId
    ? drafts.find((d) => d.id === routingCableId)
    : null
  const drawingZone = drawingZoneId
    ? drafts.find((d) => d.id === drawingZoneId)
    : null
  const mappedZoneIds = new Set(
    drafts
      .filter((d) => d.type === 'zone' && !!d.zoneId)
      .map((d) => d.zoneId as string),
  )
  const availableZones = (zonesQuery.data ?? []).filter(
    (z) => !mappedZoneIds.has(z.id),
  )

  function toggleLayer(id: string) {
    setLayers((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  function placeElement(lat: number, lng: number) {
    if (measuring) {
      setMeasurePoints((prev) => [...prev, [lat, lng]])
      return
    }
    if (drawingZoneId) {
      appendZoneVertex(drawingZoneId, { lat, lng })
      return
    }
    if (routingCableId) {
      appendRouteVertex(routingCableId, { lat, lng, poleId: null })
      return
    }
    if (placingType === 'zone') {
      const catalogZone = (zonesQuery.data ?? []).find(
        (z) => z.id === zoneCatalogId,
      )
      if (!catalogZone || mappedZoneIds.has(catalogZone.id)) {
        setPlacingType(null)
        return
      }
      const id = `zone-map-${catalogZone.id}`
      const draft: MapDraftElement = {
        id,
        type: 'zone',
        zoneId: catalogZone.id,
        name: catalogZone.name,
        notes: catalogZone.description,
        lat,
        lng,
        color: DEFAULT_ZONE_COLOR,
        path: [{ lat, lng }],
      }
      setDrafts((prev) => [...prev, draft])
      setDrawingZoneId(id)
      setSelectedZoneId(id)
      setSelectedCableId(null)
      setPlacingType(null)
      setZoneCatalogId('')
      setSideTab('edit')
      return
    }
    if (placingType) {
      const id = newDraftId()
      const draft: MapDraftElement = {
        id,
        type: placingType,
        name: '',
        notes: '',
        lat,
        lng,
        ...(placingType === 'cable'
          ? {
              path: [{ lat, lng, poleId: null }],
              tubes: createMiniTubes(1, 12),
              colorNorm: 'tia598',
            }
          : {}),
        ...(placingType === 'drop'
          ? {
              path: [{ lat, lng, poleId: null }],
              fibers: createDropFibers(1),
            }
          : {}),
        ...(placingType === 'mufa'
          ? {
              trays: createMufaTrays(4),
              cableIds: [],
              connections: [],
            }
          : {}),
        ...(placingType === 'nap'
          ? {
              trays: createMufaTrays(2),
              cableIds: [],
              connections: [],
              splitters: [createNapSplitter(8)],
            }
          : {}),
      }
      setEditing(draft)
      setPlacingType(null)
      return
    }
    // Clic en zona vacía: deseleccionar todo
    setSelectedCableId(null)
    setSelectedZoneId(null)
  }

  function appendZoneVertex(zoneId: string, vertex: MapPathVertex) {
    setDrafts((prev) =>
      prev.map((d) => {
        if (d.id !== zoneId || d.type !== 'zone') return d
        const path = [...(d.path ?? []), vertex]
        const center = zoneCentroid(path) ?? { lat: d.lat, lng: d.lng }
        return { ...d, path, lat: center.lat, lng: center.lng }
      }),
    )
  }

  function undoZoneVertex(zoneId: string) {
    setDrafts((prev) =>
      prev.map((d) => {
        if (d.id !== zoneId || d.type !== 'zone' || !d.path?.length) return d
        const path = d.path.slice(0, -1)
        const center = zoneCentroid(path)
        return {
          ...d,
          path: path.length ? path : undefined,
          lat: center?.lat ?? d.lat,
          lng: center?.lng ?? d.lng,
        }
      }),
    )
  }

  function finishZoneDrawing() {
    if (!drawingZoneId) return
    const zone = drafts.find((d) => d.id === drawingZoneId)
    if (!zone || (zone.path?.length ?? 0) < 3) return
    const center = zoneCentroid(zone.path) ?? {
      lat: zone.lat,
      lng: zone.lng,
    }
    const finished: MapDraftElement = {
      ...zone,
      lat: center.lat,
      lng: center.lng,
    }
    setDrafts((prev) => prev.map((d) => (d.id === finished.id ? finished : d)))
    setDrawingZoneId(null)
    setSelectedZoneId(finished.id)
    setEditing(finished)
  }

  function cancelZoneDrawing() {
    if (!drawingZoneId) return
    const id = drawingZoneId
    let removed = false
    setDrawingZoneId(null)
    setDrafts((prev) => {
      const zone = prev.find((d) => d.id === id)
      if (zone && (zone.path?.length ?? 0) < 3) {
        removed = true
        return prev.filter((d) => d.id !== id)
      }
      return prev
    })
    if (removed) setSelectedZoneId(null)
  }

  function startDrawZone(element: MapDraftElement) {
    if (!isZoneElement(element)) return
    setEditing(null)
    setViewingMufa(null)
    setViewingNap(null)
    setRoutingCableId(null)
    setPlacingType(null)
    setSelectedCableId(null)
    setSelectedZoneId(element.id)
    setSideTab('edit')
    setDrafts((prev) => {
      if (prev.some((d) => d.id === element.id)) {
        return prev.map((d) =>
          d.id === element.id
            ? {
                ...d,
                name: element.name || d.name,
                notes: element.notes ?? d.notes,
                color: element.color ?? d.color,
                path: element.path?.length
                  ? element.path
                  : d.path?.length
                    ? d.path
                    : [{ lat: d.lat, lng: d.lng }],
              }
            : d,
        )
      }
      return [...prev, element]
    })
    setDrawingZoneId(element.id)
  }

  function appendRouteVertex(cableId: string, vertex: MapPathVertex) {
    setDrafts((prev) =>
      prev.map((d) => {
        if (d.id !== cableId) return d
        const path = [...(d.path ?? [])]
        const tip =
          routingFrom === 'start' ? path[0] : path[path.length - 1]
        // Evitar duplicar el mismo anclaje consecutivamente en el extremo activo
        if (
          vertex.poleId &&
          tip?.poleId &&
          tip.poleId === vertex.poleId
        ) {
          return d
        }
        if (
          vertex.mufaId &&
          tip?.mufaId &&
          tip.mufaId === vertex.mufaId
        ) {
          return d
        }
        if (
          vertex.napId &&
          tip?.napId &&
          tip.napId === vertex.napId
        ) {
          return d
        }
        if (
          vertex.nodeId &&
          tip?.nodeId &&
          tip.nodeId === vertex.nodeId
        ) {
          return d
        }
        if (
          vertex.clientId &&
          tip?.clientId &&
          tip.clientId === vertex.clientId
        ) {
          return d
        }
        if (routingFrom === 'start') path.unshift(vertex)
        else path.push(vertex)
        const next: MapDraftElement = {
          ...d,
          path,
          lat: path[0]?.lat ?? d.lat,
          lng: path[0]?.lng ?? d.lng,
        }
        // Drop: el cliente del extremo se refleja en drop.clientId
        if (d.type === 'drop' && vertex.clientId) {
          next.clientId = vertex.clientId
        }
        return next
      }),
    )
  }

  function undoRouteVertex(cableId: string) {
    setDrafts((prev) =>
      prev.map((d) => {
        if (d.id !== cableId || !d.path?.length) return d
        const path =
          routingFrom === 'start'
            ? d.path.slice(1)
            : d.path.slice(0, -1)
        const next: MapDraftElement = {
          ...d,
          path: path.length ? path : undefined,
          lat: path[0]?.lat ?? d.lat,
          lng: path[0]?.lng ?? d.lng,
        }
        if (d.type === 'drop') {
          const still =
            path.map((v) => v.clientId).find((id): id is string => !!id) ??
            null
          next.clientId = still
        }
        return next
      }),
    )
  }

  function removeRouteVertex(cableId: string, vertexIndex: number) {
    setDrafts((prev) =>
      prev.map((d) => {
        if (d.id !== cableId || !d.path?.[vertexIndex]) return d
        // Zona: si ya es polígono (≥3), no bajar de 3 vértices.
        if (d.type === 'zone' && (d.path?.length ?? 0) === 3) return d
        const path = d.path.filter((_, i) => i !== vertexIndex)
        if (d.type === 'zone') {
          const center = zoneCentroid(path)
          return {
            ...d,
            path: path.length ? path : undefined,
            lat: center?.lat ?? d.lat,
            lng: center?.lng ?? d.lng,
          }
        }
        return {
          ...d,
          path: path.length ? path : undefined,
          lat: path[0]?.lat ?? d.lat,
          lng: path[0]?.lng ?? d.lng,
        }
      }),
    )
  }

  function moveZoneVertex(
    zoneId: string,
    vertexIndex: number,
    lat: number,
    lng: number,
  ) {
    setDrafts((prev) =>
      prev.map((d) => {
        if (d.id !== zoneId || d.type !== 'zone' || !d.path?.[vertexIndex])
          return d
        const path = d.path.map((v, i) =>
          i === vertexIndex ? { ...v, lat, lng } : v,
        )
        const center = zoneCentroid(path) ?? { lat: d.lat, lng: d.lng }
        return { ...d, path, lat: center.lat, lng: center.lng }
      }),
    )
  }

  function insertZoneVertexOnEdge(
    zoneId: string,
    afterIndex: number,
    lat: number,
    lng: number,
  ) {
    setDrafts((prev) =>
      prev.map((d) => {
        if (d.id !== zoneId || d.type !== 'zone' || !d.path?.length) return d
        const path = [...d.path]
        const insertAt = Math.min(afterIndex + 1, path.length)
        path.splice(insertAt, 0, { lat, lng })
        const center = zoneCentroid(path) ?? { lat: d.lat, lng: d.lng }
        return { ...d, path, lat: center.lat, lng: center.lng }
      }),
    )
    // Al editar una zona ya cerrada, mantenerla seleccionada.
    setSelectedZoneId(zoneId)
  }

  function startTraceRoute(
    element: MapDraftElement,
    from: 'start' | 'end' = 'end',
  ) {
    if (!isFiberPathElement(element)) return
    setEditing(null)
    setViewingMufa(null)
    setViewingNap(null)
    setSelectedCableId(element.id)
    setPlacingType(null)
    setSideTab('edit')
    setRoutingFrom(from)
    setDrafts((prev) => {
      const exists = prev.some((d) => d.id === element.id)
      if (!exists) return [...prev, element]
      return prev.map((d) => {
        if (d.id !== element.id) return d
        const merged: MapDraftElement = {
          ...d,
          name: element.name || d.name,
          notes: element.notes ?? d.notes,
          fibers: element.fibers ?? d.fibers,
          tubes: element.tubes ?? d.tubes,
          colorNorm: element.colorNorm ?? d.colorNorm,
          clientId: element.clientId ?? d.clientId,
          path:
            d.path?.length || element.path?.length
              ? (element.path?.length ? element.path : d.path)
              : [{ lat: d.lat, lng: d.lng, poleId: null }],
        }
        return merged
      })
    })
    setRoutingCableId(element.id)
  }

  /** Crear un drop anclado a NAP o cliente e iniciar el trazo desde el otro extremo. */
  function beginDropFromAnchor(opts: {
    lat: number
    lng: number
    napId?: string
    clientId?: string
    label?: string
  }) {
    const n = drafts.filter((d) => d.type === 'drop').length + 1
    const id = newDraftId()
    const draft: MapDraftElement = {
      id,
      type: 'drop',
      name: opts.label ? `Drop · ${opts.label}` : `Drop ${n}`,
      notes: '',
      lat: opts.lat,
      lng: opts.lng,
      path: [
        {
          lat: opts.lat,
          lng: opts.lng,
          ...(opts.napId ? { napId: opts.napId } : {}),
          ...(opts.clientId ? { clientId: opts.clientId } : {}),
        },
      ],
      fibers: createDropFibers(1),
      clientId: opts.clientId ?? null,
    }
    setDrafts((prev) => [...prev, draft])
    setPlacingType(null)
    setEditing(null)
    setSelectedZoneId(null)
    setSideTab('edit')
    window.setTimeout(() => startTraceRoute(draft, 'end'), 0)
  }

  /** Clic en un vértice del path: en extremos, continuar/iniciar el trazo desde ahí. */
  function handlePathVertexClick(cableId: string, vertexIndex: number) {
    const cable = drafts.find((d) => d.id === cableId)
    if (!cable || !isFiberPathElement(cable)) {
      selectCable(cableId)
      return
    }
    const path = cable.path ?? []
    const isStart = vertexIndex === 0
    const isEnd = path.length > 0 && vertexIndex === path.length - 1
    if (!isStart && !isEnd) {
      selectCable(cableId)
      return
    }
    const from: 'start' | 'end' =
      isStart && isEnd ? 'end' : isStart ? 'start' : 'end'
    if (routingCableId === cableId) {
      setRoutingFrom(from)
      return
    }
    if (routingCableId) return
    startTraceRoute(cable, from)
  }

  function openMarker(marker: NetworkMapMarker) {
    if (measuring) {
      setMeasurePoints((prev) => [...prev, [marker.lat, marker.lng]])
      return
    }
    if (mapLocked) {
      if (marker.kind === 'client') {
        inspectTarget({ type: 'client', id: marker.id.replace(/^client:/, '') })
        return
      }
      if (marker.kind === 'onu') {
        inspectTarget({ type: 'onu', id: marker.id.replace(/^onu:/, '') })
        return
      }
      if (marker.kind === 'node') {
        inspectTarget({ type: 'node', id: marker.id.replace(/^node:/, '') })
        return
      }
      const draftId = marker.id.startsWith('element:')
        ? marker.id.slice('element:'.length)
        : null
      if (draftId) inspectTarget({ type: 'draft', id: draftId })
      return
    }
    const nodeId = marker.id.startsWith('node:')
      ? marker.id.slice('node:'.length)
      : null
    const clientId = marker.id.startsWith('client:')
      ? marker.id.slice('client:'.length)
      : null
    const id = marker.id.startsWith('element:')
      ? marker.id.slice('element:'.length)
      : nodeId
    if (!id && !clientId) return

    // Añadir drop: iniciar anclado a NAP o cliente
    if (placingType === 'drop' && !routingCableId) {
      if (clientId) {
        beginDropFromAnchor({
          lat: marker.lat,
          lng: marker.lng,
          clientId,
          label: marker.label,
        })
        return
      }
      if (id && marker.kind === 'nap') {
        beginDropFromAnchor({
          lat: marker.lat,
          lng: marker.lng,
          napId: id,
          label: marker.label,
        })
        return
      }
    }

    const routingCable = routingCableId
      ? drafts.find((d) => d.id === routingCableId)
      : null

    // Modo trazo de drop: enganchar a cliente
    if (routingCableId && routingCable?.type === 'drop' && clientId) {
      const path = routingCable.path ?? []
      if (path.length > 0) {
        const matches = (v: (typeof path)[0] | undefined) =>
          !!v?.clientId && v.clientId === clientId
        const atStart = matches(path[0])
        const atEnd = matches(path[path.length - 1])
        if (atStart && !atEnd) {
          setRoutingFrom('start')
          return
        }
        if (atEnd && !atStart) {
          setRoutingFrom('end')
          return
        }
      }
      appendRouteVertex(routingCableId, {
        lat: marker.lat,
        lng: marker.lng,
        clientId,
      })
      return
    }

    // Modo trazo: poste / mufa / NAP / nodo
    if (
      routingCableId &&
      id &&
      (marker.kind === 'pole' ||
        marker.kind === 'mufa' ||
        marker.kind === 'nap' ||
        marker.kind === 'node')
    ) {
      const cable = drafts.find((d) => d.id === routingCableId)
      const path = cable?.path ?? []
      if (path.length > 0) {
        const matches = (v: (typeof path)[0] | undefined) => {
          if (!v) return false
          if (marker.kind === 'pole') return !!v.poleId && v.poleId === id
          if (marker.kind === 'mufa') return !!v.mufaId && v.mufaId === id
          if (marker.kind === 'node') return !!v.nodeId && v.nodeId === id
          return !!v.napId && v.napId === id
        }
        const atStart = matches(path[0])
        const atEnd = matches(path[path.length - 1])
        if (atStart && !atEnd) {
          setRoutingFrom('start')
          return
        }
        if (atEnd && !atStart) {
          setRoutingFrom('end')
          return
        }
      }
      appendRouteVertex(routingCableId, {
        lat: marker.lat,
        lng: marker.lng,
        ...(marker.kind === 'pole'
          ? { poleId: id }
          : marker.kind === 'mufa'
            ? { mufaId: id }
            : marker.kind === 'node'
              ? { nodeId: id }
              : { napId: id }),
      })
      return
    }
    if (routingCableId) return

    if (
      selectedCableId &&
      id &&
      (marker.kind === 'pole' ||
        marker.kind === 'mufa' ||
        marker.kind === 'nap' ||
        marker.kind === 'node')
    ) {
      const hooked = drafts.find((d) => d.id === selectedCableId)
      if (hooked && isFiberPathElement(hooked) && hooked.path?.length) {
        const first = hooked.path[0]
        const last = hooked.path[hooked.path.length - 1]
        const hit = (v: typeof first) => {
          if (marker.kind === 'pole') return v.poleId === id
          if (marker.kind === 'mufa') return v.mufaId === id
          if (marker.kind === 'node') return v.nodeId === id
          return v.napId === id
        }
        if (hit(first) || hit(last)) {
          const from: 'start' | 'end' =
            hit(first) && !hit(last)
              ? 'start'
              : hit(last) && !hit(first)
                ? 'end'
                : 'end'
          startTraceRoute(hooked, from)
          return
        }
      }
    }

    // Drop seleccionado: clic en cliente para enganchar el extremo
    if (selectedCableId && clientId && marker.kind === 'client') {
      const hooked = drafts.find((d) => d.id === selectedCableId)
      if (hooked?.type === 'drop') {
        setDrafts((prev) =>
          prev.map((d) => {
            if (d.id !== hooked.id || d.type !== 'drop') return d
            const path = [...(d.path ?? [])]
            const tip = path[path.length - 1]
            if (tip?.clientId && tip.clientId === clientId) {
              return { ...d, clientId }
            }
            path.push({
              lat: marker.lat,
              lng: marker.lng,
              clientId,
            })
            return {
              ...d,
              path,
              clientId,
              lat: path[0]?.lat ?? d.lat,
              lng: path[0]?.lng ?? d.lng,
            }
          }),
        )
        return
      }
    }

    // Nodo físico: vista de cabeceras (drag & drop de pelos)
    if (nodeId) {
      setViewingNodeId(nodeId)
      return
    }

    if (!id) return
    const found = drafts.find((d) => d.id === id)
    if (found?.type === 'mufa') {
      setViewingMufa(found)
      return
    }
    if (found?.type === 'nap') {
      setViewingNap(found)
      return
    }
    if (found) {
      setEditing(found)
      return
    }
    if (editing?.id === id) setEditing(editing)
  }

  function moveMarker(marker: NetworkMapMarker, lat: number, lng: number) {
    const id = marker.id.startsWith('element:')
      ? marker.id.slice('element:'.length)
      : null
    if (!id) return
    setDrafts((prev) => {
      let next = prev.map((d) => (d.id === id ? { ...d, lat, lng } : d))
      if (marker.kind === 'pole') {
        next = syncCablePathsToPole(next, id, lat, lng)
      }
      if (marker.kind === 'mufa') {
        next = syncCablePathsToMufa(next, id, lat, lng)
      }
      if (marker.kind === 'nap') {
        next = syncCablePathsToNap(next, id, lat, lng)
      }
      return next
    })
    setEditing((prev) => (prev?.id === id ? { ...prev, lat, lng } : prev))
    setViewingMufa((prev) =>
      prev?.id === id ? { ...prev, lat, lng } : prev,
    )
    setViewingNap((prev) =>
      prev?.id === id ? { ...prev, lat, lng } : prev,
    )
  }

  function saveElement(next: MapDraftElement) {
    setDrafts((prev) => {
      const exists = prev.some((d) => d.id === next.id)
      return exists
        ? prev.map((d) => (d.id === next.id ? { ...d, ...next } : d))
        : [...prev, next]
    })
    setEditing(null)
    setViewingMufa((prev) =>
      prev?.id === next.id ? { ...prev, ...next } : prev,
    )
    setViewingNap((prev) =>
      prev?.id === next.id ? { ...prev, ...next } : prev,
    )
    if (isFiberPathElement(next) && (next.path?.length ?? 0) < 2) {
      window.setTimeout(() => startTraceRoute(next), 0)
    }
    if (isZoneElement(next) && next.zoneId) {
      const zone = zonesQuery.data?.find((z) => z.id === next.zoneId)
      if (
        zone &&
        (zone.name !== next.name || zone.description !== next.notes)
      ) {
        updateZoneMutation.mutate({
          id: next.zoneId,
          name: next.name,
          description: next.notes,
        })
      }
    }
    if (isZoneElement(next) && (next.path?.length ?? 0) < 3) {
      window.setTimeout(() => startDrawZone(next), 0)
    }
  }

  function deleteElement(id: string) {
    setDrafts((prev) => prev.filter((d) => d.id !== id))
    setEditing(null)
    setViewingMufa((prev) => (prev?.id === id ? null : prev))
    setViewingNap((prev) => (prev?.id === id ? null : prev))
    setSelectedCableId((prev) => (prev === id ? null : prev))
    setSelectedZoneId((prev) => (prev === id ? null : prev))
    if (routingCableId === id) setRoutingCableId(null)
    if (drawingZoneId === id) setDrawingZoneId(null)
  }

  function selectCable(pathId: string) {
    if (measuring) return
    if (mapLocked) {
      inspectTarget({ type: 'draft', id: pathId })
      return
    }
    if (routingCableId || drawingZoneId) return
    setSelectedZoneId(null)
    setSelectedCableId((prev) => (prev === pathId ? null : pathId))
    setInspected({ type: 'draft', id: pathId })
  }

  function selectZone(zoneId: string) {
    if (measuring || mapLocked) return
    if (routingCableId || drawingZoneId) return
    setSelectedCableId(null)
    setEditing(null)
    setSelectedZoneId((prev) => (prev === zoneId ? null : zoneId))
    setInspected({ type: 'draft', id: zoneId })
  }

  function updateEnclosure(next: MapDraftElement) {
    setDrafts((prev) =>
      prev.map((d) => (d.id === next.id ? { ...d, ...next } : d)),
    )
    setViewingMufa((prev) => (prev?.id === next.id ? next : prev))
    setViewingNap((prev) => (prev?.id === next.id ? next : prev))
  }

  return (
    <PanelShell
      title="Mapa de red"
      subtitle={
        contracted
          ? 'Vista geográfica de tu infraestructura'
          : 'Módulo premium'
      }
      variant="tenant"
    >
      {modulesQuery.isLoading && (
        <p className="text-sm text-[var(--text-muted)]">Cargando…</p>
      )}
      {modulesQuery.error && (
        <p className="text-sm text-[var(--danger)]">
          {(modulesQuery.error as Error).message}
        </p>
      )}

      {!modulesQuery.isLoading && !modulesQuery.error && !contracted && (
        <div className="mx-auto max-w-2xl rounded-2xl border border-[var(--border)] bg-[var(--bg-elevated)] p-8 sm:p-10">
          <p className="mb-2 text-xs font-semibold tracking-[0.16em] text-[var(--accent)] uppercase">
            Add-on · Mapa de red
          </p>
          <h2 className="mb-3 text-2xl font-semibold tracking-tight sm:text-3xl">
            Tu red, en el mapa
          </h2>
          <p className="mb-6 text-sm leading-relaxed text-[var(--text-muted)] sm:text-base">
            Ubica clientes, ONUs y nodos sobre OpenStreetMap para planificar
            despliegues, responder fallas en campo y ver la cobertura de un
            vistazo. Actívalo y transforma la operación diaria de tu ISP.
          </p>
          <ul className="mb-8 space-y-2 text-sm text-[var(--text-muted)]">
            <li>· Mapa interactivo con OpenStreetMap</li>
            <li>· Base lista para elementos de red (próximas etapas)</li>
            <li>· Misma contratación flexible que otros add-ons</li>
          </ul>
          <div className="flex flex-wrap items-center gap-3">
            <Link
              to="/app/settings?section=integraciones"
              className="rounded-lg bg-[var(--accent)] px-4 py-2.5 text-sm font-medium text-white hover:bg-[var(--accent-hover)]"
            >
              Contratar en Integraciones
            </Link>
            {price && (
              <span className="text-sm text-[var(--text-muted)]">
                Desde {price}/mes
              </span>
            )}
          </div>
          <p className="mt-6 text-xs text-[var(--text-muted)]">
            Pago único por 1 mes o agrégalo a tu plan de suscripción.
          </p>
        </div>
      )}

      {contracted && (
        <div className="-mx-4 -mb-6 flex min-h-[calc(100dvh-11rem)] flex-col sm:-mx-6">
          <div className="flex shrink-0 flex-col gap-2 border-b border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2 sm:px-4">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setMapLocked((locked) => !locked)}
                aria-pressed={mapLocked}
                title={
                  mapLocked
                    ? 'Mapa bloqueado: solo visualización'
                    : 'Mapa desbloqueado: se permite editar'
                }
                className={[
                  'flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition',
                  mapLocked
                    ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
                    : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
                ].join(' ')}
              >
                <span aria-hidden>{mapLocked ? '🔒' : '🔓'}</span>
                {mapLocked ? 'Bloqueado' : 'Edición'}
              </button>
              <button
                type="button"
                disabled={!canFitAll}
                onClick={() => setFitAllRequest((n) => n + 1)}
                title="Centrar el mapa para ver todos los elementos visibles"
                className="rounded-md border border-[var(--border)] px-3 py-1.5 text-xs hover:bg-[var(--bg)] disabled:cursor-not-allowed disabled:opacity-40 sm:text-sm"
              >
                Centrar
              </button>
              <button
                type="button"
                onClick={() => setSideOpen((v) => !v)}
                className="rounded-md border border-[var(--border)] px-3 py-1.5 text-xs hover:bg-[var(--bg)] sm:text-sm"
              >
                {sideOpen ? 'Ocultar panel' : 'Mostrar panel'}
              </button>
            </div>

            <div className="-mx-1 flex items-center gap-1 overflow-x-auto overscroll-x-contain px-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {LAYER_ITEMS.map((l, idx) => {
                const on = !!layers[l.id]
                const prev = LAYER_ITEMS[idx - 1]
                const showSep = idx > 0 && prev && prev.group !== l.group
                const count = layerCount(l.id, {
                  clients: clientCount,
                  onus: onuCount,
                  nodes: nodeCount,
                  byType: draftCounts,
                })
                return (
                  <span key={l.id} className="contents">
                    {showSep && (
                      <span
                        aria-hidden
                        className="mx-1 hidden h-5 w-px shrink-0 bg-[var(--border)] sm:inline-block"
                      />
                    )}
                    <button
                      type="button"
                      onClick={() => toggleLayer(l.id)}
                      aria-pressed={on}
                      title={
                        l.group === 'crm'
                          ? `${l.label} (inventario / CRM)`
                          : `${l.label} (elemento de mapa)`
                      }
                      className={[
                        'shrink-0 whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs transition sm:px-3 sm:text-sm',
                        on
                          ? l.group === 'crm'
                            ? 'bg-emerald-500/15 font-medium text-emerald-300'
                            : 'bg-[var(--accent)]/15 font-medium text-[var(--accent)]'
                          : 'text-[var(--text-muted)] hover:bg-[var(--bg)] hover:text-[var(--text)]',
                      ].join(' ')}
                    >
                      {l.label}
                      {count != null ? (
                        <span className="ml-1 opacity-70">({count})</span>
                      ) : null}
                    </button>
                  </span>
                )
              })}
            </div>
          </div>

          <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
            <div className="relative min-h-[50vh] min-w-0 flex-1 overflow-hidden lg:min-h-0">
              <NetworkMapCanvas
                className="absolute inset-0 h-full w-full"
                markers={markers}
                paths={cablePaths}
                polygons={zonePolygons}
                fitAllRequest={fitAllRequest}
                placeMode={!!placingType || !!drawingZoneId || measuring}
                routeMode={!!routingCableId}
                dropAnchorMode={placingType === 'drop'}
                measureMode={measuring}
                measurePoints={measurePoints}
                onMapClick={
                  measuring || !mapLocked ? placeElement : undefined
                }
                onMarkerClick={openMarker}
                onMarkerMove={mapLocked || measuring ? undefined : moveMarker}
                onPathClick={measuring ? undefined : selectCable}
                onPathVertexClick={
                  mapLocked || measuring ? undefined : handlePathVertexClick
                }
                onPathVertexRemove={
                  mapLocked || measuring ? undefined : removeRouteVertex
                }
                onPolygonClick={measuring ? undefined : selectZone}
                onPolygonVertexMove={
                  mapLocked || measuring ? undefined : moveZoneVertex
                }
                onPolygonEdgeClick={
                  mapLocked || measuring ? undefined : insertZoneVertexOnEdge
                }
                routingCableId={routingCableId}
                routingFrom={routingFrom}
              />
              {measuring && (
                <div className="absolute left-2 right-2 top-3 z-[500] flex flex-wrap items-center justify-center gap-2 sm:left-1/2 sm:right-auto sm:max-w-[min(40rem,calc(100%-1.5rem))] sm:-translate-x-1/2 rounded-md bg-[var(--bg-elevated)] px-3 py-2 text-xs shadow ring-1 ring-[var(--accent)]">
                  <span className="font-medium text-[var(--accent)]">
                    Medir
                  </span>
                  <span className="text-[var(--text-muted)]">
                    {measurePoints.length === 0
                      ? 'Clic en el mapa para el primer punto'
                      : measurePoints.length === 1
                        ? '1 punto · clic para continuar'
                        : `${measurePoints.length} puntos · ${formatPathLength(measureLengthM)}`}
                    {' · '}
                    Backspace = deshacer · Esc = salir
                  </span>
                  <button
                    type="button"
                    disabled={measurePoints.length === 0}
                    onClick={() =>
                      setMeasurePoints((prev) => prev.slice(0, -1))
                    }
                    className="rounded border border-[var(--border)] px-2 py-0.5 hover:bg-[var(--bg)] disabled:opacity-40"
                  >
                    Deshacer
                  </button>
                  <button
                    type="button"
                    disabled={measurePoints.length === 0}
                    onClick={() => setMeasurePoints([])}
                    className="rounded border border-[var(--border)] px-2 py-0.5 hover:bg-[var(--bg)] disabled:opacity-40"
                  >
                    Limpiar
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setTool('none')
                    }}
                    className="rounded bg-[var(--accent)] px-2 py-0.5 font-medium text-white"
                  >
                    Listo
                  </button>
                </div>
              )}
              {placingType && !drawingZoneId && !measuring && (
                <div className="pointer-events-none absolute left-2 right-2 top-3 z-[500] text-center sm:left-1/2 sm:right-auto sm:max-w-[min(36rem,calc(100%-1.5rem))] sm:-translate-x-1/2 rounded-md bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white shadow">
                  {placingType === 'drop'
                    ? 'Clic en una NAP o un cliente para iniciar el drop (o en el mapa) · Esc cancela'
                    : placingType === 'zone'
                      ? 'Haz clic en el mapa para empezar el perímetro de la zona · Esc cancela'
                      : `Haz clic en el mapa para colocar ${mapElementLabel[placingType].toLowerCase()} · Esc cancela`}
                </div>
              )}
              {drawingZone && (
                <div className="absolute left-2 right-2 top-3 z-[500] flex flex-wrap items-center justify-center gap-2 sm:left-1/2 sm:right-auto sm:max-w-[min(40rem,calc(100%-1.5rem))] sm:-translate-x-1/2 rounded-md bg-[var(--bg-elevated)] px-3 py-2 text-xs shadow ring-1 ring-[var(--accent)]">
                  <span className="font-medium text-[var(--accent)]">
                    Dibujando «{drawingZone.name || 'zona'}»
                  </span>
                  <span className="text-[var(--text-muted)]">
                    {(drawingZone.path?.length ?? 0)} pts · Clic = vértice ·
                    arista = insertar · arrastrar = mover · clic derecho =
                    borrar · Enter = cerrar (≥3)
                  </span>
                  <button
                    type="button"
                    onClick={() => undoZoneVertex(drawingZone.id)}
                    className="rounded border border-[var(--border)] px-2 py-0.5 hover:bg-[var(--bg)]"
                  >
                    Deshacer
                  </button>
                  <button
                    type="button"
                    disabled={(drawingZone.path?.length ?? 0) < 3}
                    onClick={finishZoneDrawing}
                    className="rounded bg-[var(--accent)] px-2 py-0.5 font-medium text-white disabled:opacity-40"
                  >
                    Cerrar perímetro
                  </button>
                  <button
                    type="button"
                    onClick={cancelZoneDrawing}
                    className="rounded border border-[var(--border)] px-2 py-0.5 hover:bg-[var(--bg)]"
                  >
                    Cancelar
                  </button>
                </div>
              )}
              {routingCable && (
                <div className="absolute left-2 right-2 top-3 z-[500] flex flex-wrap items-center justify-center gap-2 sm:left-1/2 sm:right-auto sm:max-w-[min(40rem,calc(100%-1.5rem))] sm:-translate-x-1/2 rounded-md bg-[var(--bg-elevated)] px-3 py-2 text-xs shadow ring-1 ring-[var(--accent)]">
                  <span className="font-medium text-[var(--accent)]">
                    Trazando «{routingCable.name || (routingCable.type === 'drop' ? 'drop' : 'cable')}»
                  </span>
                  <span className="text-[var(--text-muted)]">
                    Extendiendo desde el{' '}
                    <strong className="text-[var(--text)]">
                      {routingFrom === 'start' ? 'inicio' : 'final'}
                    </strong>
                    {' · '}
                    Clic = punto · poste/mufa = enganchar · clic en extremo =
                    cambiar lado · Backspace = deshacer · Enter = listo
                  </span>
                  <button
                    type="button"
                    onClick={() => undoRouteVertex(routingCable.id)}
                    className="rounded border border-[var(--border)] px-2 py-0.5 hover:bg-[var(--bg)]"
                  >
                    Deshacer
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setRoutingCableId(null)
                      setRoutingFrom('end')
                    }}
                    className="rounded bg-[var(--accent)] px-2 py-0.5 font-medium text-white"
                  >
                    Terminar
                  </button>
                </div>
              )}
              {locationsQuery.isLoading && (
                <div className="pointer-events-none absolute left-3 top-3 rounded-md bg-[var(--bg-elevated)]/90 px-3 py-1.5 text-xs text-[var(--text-muted)] shadow">
                  Cargando ubicaciones…
                </div>
              )}
              {locationsQuery.error && (
                <div className="absolute left-3 top-3 rounded-md bg-red-500/15 px-3 py-1.5 text-xs text-red-300 shadow">
                  {(locationsQuery.error as Error).message}
                </div>
              )}
            </div>

            {sideOpen && (
              <aside className="flex max-h-[45vh] w-full shrink-0 flex-col border-t border-[var(--border)] bg-[var(--bg-elevated)] lg:max-h-none lg:w-80 lg:border-t-0 lg:border-l xl:w-96">
                <div className="flex shrink-0 gap-1 border-b border-[var(--border)] px-2 pt-2">
                  {SIDE_TABS.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setSideTab(t.id)}
                      disabled={mapLocked && t.id === 'edit'}
                      title={
                        mapLocked && t.id === 'edit'
                          ? 'Desbloquea el mapa para editar'
                          : undefined
                      }
                      className={[
                        'flex-1 rounded-t-md px-2 py-2 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-40 sm:text-sm',
                        sideTab === t.id
                          ? 'bg-[var(--bg)] text-[var(--accent)]'
                          : 'text-[var(--text-muted)] hover:text-[var(--text)]',
                      ].join(' ')}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">
                  {sideTab === 'element' && (
                    <div className="space-y-3">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-xs text-[var(--text-muted)]">
                          {mapLocked
                            ? 'Mapa bloqueado: haz clic en un elemento para ver su detalle.'
                            : 'Detalle del elemento seleccionado en el mapa.'}
                        </p>
                        {inspected && (
                          <button
                            type="button"
                            onClick={() => {
                              setInspected(null)
                              setSelectedCableId(null)
                              setSelectedZoneId(null)
                            }}
                            className="shrink-0 text-[11px] text-[var(--text-muted)] hover:text-[var(--text)]"
                          >
                            Limpiar
                          </button>
                        )}
                      </div>
                      <MapElementDetailPanel detail={inspectedDetail} />
                    </div>
                  )}

                  {sideTab === 'edit' && (
                    <div className="space-y-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="flex min-w-0 flex-1 items-center gap-2">
                          {mapElementHasIcon(elementType) && (
                            <MapElementTypeIcon type={elementType} size={28} />
                          )}
                          {elementType === 'zone' && (
                            <span
                              className="h-7 w-7 shrink-0 rounded-md border border-white/20"
                              style={{ background: DEFAULT_ZONE_COLOR }}
                              aria-hidden
                            />
                          )}
                          <select
                            value={elementType}
                            onChange={(e) => {
                              setElementType(e.target.value as MapElementType)
                              setPlacingType(null)
                              setZoneCatalogId('')
                            }}
                            className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm outline-none ring-[var(--accent)] focus:ring-2"
                          >
                            {MAP_ELEMENT_TYPES.filter((t) => t !== 'splitter').map(
                              (t) => (
                              <option key={t} value={t}>
                                {mapElementLabel[t]}
                              </option>
                            ),
                            )}
                          </select>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setRoutingCableId(null)
                            setDrawingZoneId(null)
                            if (
                              elementType === 'zone' &&
                              !zoneCatalogId &&
                              availableZones[0]
                            ) {
                              setZoneCatalogId(availableZones[0].id)
                            }
                            setPlacingType((prev) =>
                              prev === elementType ? null : elementType,
                            )
                          }}
                          aria-pressed={placingType === elementType}
                          disabled={
                            !!routingCableId ||
                            !!drawingZoneId ||
                            (elementType === 'zone' && !zoneCatalogId)
                          }
                          className={[
                            'rounded-lg px-3 py-2 text-sm font-medium transition disabled:opacity-50',
                            placingType === elementType
                              ? 'bg-[var(--accent)] text-white'
                              : 'border border-[var(--border)] hover:bg-[var(--bg)]',
                          ].join(' ')}
                        >
                          {placingType === elementType ? 'Cancelar' : 'Añadir'}
                        </button>
                      </div>

                      {elementType === 'zone' && (
                        <div className="space-y-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] p-3">
                          <label className="block text-sm">
                            <span className="mb-1 block text-[var(--text-muted)]">
                              Zona existente
                            </span>
                            <select
                              value={zoneCatalogId}
                              onChange={(e) => {
                                setZoneCatalogId(e.target.value)
                                setPlacingType(null)
                              }}
                              disabled={availableZones.length === 0}
                              className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2 text-sm outline-none ring-[var(--accent)] focus:ring-2 disabled:opacity-50"
                            >
                              <option value="">
                                {availableZones.length
                                  ? 'Selecciona una zona'
                                  : 'Todas las zonas ya están en el mapa'}
                              </option>
                              {availableZones.map((z) => (
                                <option key={z.id} value={z.id}>
                                  {z.name} · {z.clientCount} cliente(s)
                                </option>
                              ))}
                            </select>
                          </label>

                          <div className="text-sm">
                            <span className="mb-1 block text-[var(--text-muted)]">
                              O crear una nueva
                            </span>
                            <div className="flex gap-2">
                              <input
                                value={newZoneName}
                                onChange={(e) => {
                                  setNewZoneName(e.target.value)
                                  setZoneError(null)
                                }}
                                placeholder="Nombre de la zona"
                                className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2 text-sm outline-none ring-[var(--accent)] focus:ring-2"
                              />
                              <button
                                type="button"
                                disabled={
                                  newZoneName.trim().length < 2 ||
                                  createZoneMutation.isPending
                                }
                                onClick={() =>
                                  createZoneMutation.mutate(newZoneName.trim())
                                }
                                className="shrink-0 rounded-lg bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                              >
                                {createZoneMutation.isPending
                                  ? 'Creando…'
                                  : 'Crear'}
                              </button>
                            </div>
                          </div>

                          {zoneError && (
                            <p className="text-[11px] text-[var(--danger)]">
                              {zoneError}
                            </p>
                          )}
                          <p className="text-[11px] text-[var(--text-muted)]">
                            Las zonas viven en Ajustes → Zonas; aquí solo se
                            dibuja su perímetro.
                          </p>
                        </div>
                      )}

                      <p className="text-xs text-[var(--text-muted)]">
                        {drawingZoneId
                          ? 'Dibujando zona: clic en el mapa para marcar el perímetro (≥3 puntos). Enter cierra.'
                          : routingCableId
                            ? routingCable?.type === 'drop'
                              ? 'Trazando drop: clic en NAP (origen) y en un cliente (destino), o en postes.'
                              : 'Trazando cable: clic en el mapa, en un poste, mufa, NAP o nodo para enganchar.'
                            : placingType === 'drop'
                              ? 'Clic en una NAP o un cliente para empezar el drop, o en el mapa. Esc cancela.'
                              : placingType === 'zone'
                              ? 'Haz clic en el mapa para empezar el perímetro. Esc cancela.'
                              : placingType
                                ? 'Haz clic en el mapa para colocar el elemento. Esc cancela.'
                                : 'Elige un tipo y pulsa Añadir. Las zonas se dibujan como polígono; los cables y drops se trazan después de guardar.'}
                      </p>

                      {drafts.filter((d) => layers[d.type] !== false).length ===
                      0 ? (
                        <p className="rounded-lg border border-dashed border-[var(--border)] px-3 py-6 text-center text-xs text-[var(--text-muted)]">
                          {drafts.length === 0
                            ? 'Aún no hay elementos en el mapa.'
                            : 'No hay elementos visibles: activa capas de red arriba.'}
                        </p>
                      ) : (
                        <ul className="space-y-1.5">
                          {drafts
                            .filter((d) => layers[d.type] !== false)
                            .map((d) => (
                            <li key={d.id}>
                              <div className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm">
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (routingCableId || drawingZoneId) return
                                    if (d.type === 'mufa') {
                                      setViewingMufa(d)
                                      return
                                    }
                                    if (d.type === 'nap') {
                                      setViewingNap(d)
                                      return
                                    }
                                    setEditing(d)
                                  }}
                                  className="flex w-full items-start gap-2.5 text-left hover:opacity-90"
                                >
                                  {mapElementHasIcon(d.type) ? (
                                    <MapElementTypeIcon
                                      type={d.type}
                                      size={28}
                                      className="mt-0.5"
                                    />
                                  ) : d.type === 'zone' ? (
                                    <span
                                      className="mt-1 h-7 w-7 shrink-0 rounded-md border border-white/20"
                                      style={{
                                        background:
                                          d.color || DEFAULT_ZONE_COLOR,
                                        opacity: 0.85,
                                      }}
                                      aria-hidden
                                    />
                                  ) : (
                                    <span
                                      className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center"
                                      aria-hidden
                                    >
                                      <span
                                        className="h-0.5 w-5 rounded-full"
                                        style={{
                                          background:
                                            d.type === 'drop'
                                              ? '#94a3b8'
                                              : '#0f172a',
                                        }}
                                      />
                                    </span>
                                  )}
                                  <span className="min-w-0 flex-1">
                                    <span className="flex items-center justify-between gap-2">
                                      <span className="truncate font-medium">
                                        {d.name || mapElementLabel[d.type]}
                                      </span>
                                      <span className="shrink-0 text-[10px] uppercase text-[var(--text-muted)]">
                                        {mapElementLabel[d.type]}
                                      </span>
                                    </span>
                                    <span className="mt-0.5 block text-[11px] text-[var(--text-muted)]">
                                      {d.type === 'cable'
                                        ? `${cableTubes(d).length} tubos · ${cableFibers(d).length} pelos · ${
                                            (d.path?.length ?? 0) >= 2
                                              ? `${formatPathLength(pathLengthMeters(d.path))} · ${d.path!.length} pts`
                                              : 'sin ruta'
                                          }`
                                        : d.type === 'drop'
                                          ? (() => {
                                              const nap = findNapForDrop(
                                                d,
                                                drafts,
                                              )
                                              const cid = dropClientId(d)
                                              const client = cid
                                                ? (
                                                    locationsQuery.data
                                                      ?.clients ?? []
                                                  ).find((c) => c.id === cid)
                                                : null
                                              const bits = [
                                                `${(d.fibers ?? []).length} pelo(s)`,
                                                (d.path?.length ?? 0) >= 2
                                                  ? `${formatPathLength(pathLengthMeters(d.path))} · ${d.path!.length} pts`
                                                  : 'sin ruta',
                                              ]
                                              if (nap)
                                                bits.push(
                                                  `NAP ${nap.name || ''}`.trim(),
                                                )
                                              if (client)
                                                bits.push(client.label)
                                              else if (cid)
                                                bits.push('cliente')
                                              return bits.join(' · ')
                                            })()
                                          : d.type === 'zone'
                                            ? `${d.path?.length ?? 0} vértices · perímetro`
                                            : d.type === 'mufa'
                                              ? `${d.trays?.length ?? 0} bandejas · ${(d.connections ?? []).length} uniones`
                                              : d.type === 'nap'
                                                ? `${d.splitters?.length ?? 0} splitters · ${d.trays?.length ?? 0} bandejas`
                                                : `${d.lat.toFixed(5)}, ${d.lng.toFixed(5)}`}
                                    </span>
                                  </span>
                                </button>
                                {(d.type === 'mufa' || d.type === 'nap') && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      if (routingCableId || drawingZoneId)
                                        return
                                      setViewingMufa(null)
                                      setViewingNap(null)
                                      setEditing(d)
                                    }}
                                    className="mt-2 w-full rounded-md border border-[var(--border)] px-2 py-1.5 text-xs font-medium text-[var(--accent)] hover:bg-[var(--accent)]/10"
                                  >
                                    Editar
                                  </button>
                                )}
                                {d.type === 'zone' && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      drawingZoneId === d.id
                                        ? cancelZoneDrawing()
                                        : startDrawZone(d)
                                    }
                                    className={[
                                      'mt-2 w-full rounded-md px-2 py-1.5 text-xs font-medium',
                                      drawingZoneId === d.id
                                        ? 'bg-[var(--accent)] text-white'
                                        : 'border border-[var(--accent)]/50 text-[var(--accent)] hover:bg-[var(--accent)]/10',
                                    ].join(' ')}
                                  >
                                    {drawingZoneId === d.id
                                      ? 'Dibujando…'
                                      : (d.path?.length ?? 0) >= 3
                                        ? 'Editar perímetro'
                                        : 'Dibujar perímetro'}
                                  </button>
                                )}
                                {(d.type === 'cable' || d.type === 'drop') && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      routingCableId === d.id
                                        ? setRoutingCableId(null)
                                        : startTraceRoute(d)
                                    }
                                    className={[
                                      'mt-2 w-full rounded-md px-2 py-1.5 text-xs font-medium',
                                      routingCableId === d.id
                                        ? 'bg-[var(--accent)] text-white'
                                        : 'border border-[var(--border)] text-[var(--accent)] hover:bg-[var(--accent)]/10',
                                    ].join(' ')}
                                  >
                                    {routingCableId === d.id
                                      ? 'Terminar trazo'
                                      : (d.path?.length ?? 0) >= 2
                                        ? 'Editar ruta'
                                        : 'Trazar ruta'}
                                  </button>
                                )}
                              </div>
                            </li>
                          ))}
                        </ul>
                      )}

                      <p className="text-[11px] text-[var(--text-muted)]">
                        Borradores locales de esta sesión. La persistencia por
                        tipo llega en la próxima etapa.
                      </p>
                    </div>
                  )}

                  {sideTab === 'tools' && (
                    <div className="space-y-3 text-sm">
                      <p className="text-xs text-[var(--text-muted)]">
                        Herramientas de medición del mapa.
                      </p>
                      <div className="space-y-1">
                        {TOOLS.map((t) => {
                          const active = tool === t.id
                          return (
                            <button
                              key={t.id}
                              type="button"
                              onClick={() =>
                                setTool((prev) =>
                                  prev === t.id ? 'none' : t.id,
                                )
                              }
                              className={[
                                'w-full rounded-lg border px-3 py-2 text-left transition',
                                active
                                  ? 'border-[var(--accent)] bg-[var(--accent)]/10'
                                  : 'border-[var(--border)] hover:bg-[var(--bg)]',
                              ].join(' ')}
                            >
                              <span
                                className={[
                                  'block text-sm font-medium',
                                  active ? 'text-[var(--accent)]' : '',
                                ].join(' ')}
                              >
                                {t.label}
                              </span>
                              <span className="block text-xs text-[var(--text-muted)]">
                                {t.hint}
                              </span>
                            </button>
                          )
                        })}
                      </div>

                      {(measuring || measurePoints.length > 0) && (
                        <div className="space-y-3 rounded-lg border border-[var(--border)] bg-[var(--bg)] p-3">
                          <div>
                            <p className="text-[11px] font-semibold tracking-wide text-[var(--text-muted)] uppercase">
                              Recorrido
                            </p>
                            <p className="mt-1 text-2xl font-semibold text-[var(--accent)]">
                              {measurePoints.length >= 2
                                ? formatPathLength(measureLengthM)
                                : '—'}
                            </p>
                            <p className="mt-1 text-xs text-[var(--text-muted)]">
                              {measurePoints.length} punto
                              {measurePoints.length === 1 ? '' : 's'}
                              {measurePoints.length >= 2
                                ? ` · ${measurePoints.length - 1} tramo${measurePoints.length - 1 === 1 ? '' : 's'}`
                                : ''}
                            </p>
                          </div>
                          {measurePoints.length >= 2 && (
                            <ul className="max-h-40 space-y-1 overflow-y-auto text-xs text-[var(--text-muted)]">
                              {measurePoints.slice(1).map((pt, i) => {
                                const prev = measurePoints[i]
                                const seg = pathLengthMeters([
                                  { lat: prev[0], lng: prev[1] },
                                  { lat: pt[0], lng: pt[1] },
                                ])
                                return (
                                  <li
                                    key={`${pt[0]}:${pt[1]}:${i}`}
                                    className="flex justify-between gap-2"
                                  >
                                    <span>
                                      Tramo {i + 1}
                                    </span>
                                    <span className="text-[var(--text)]">
                                      {formatPathLength(seg)}
                                    </span>
                                  </li>
                                )
                              })}
                            </ul>
                          )}
                          <div className="flex gap-2">
                            {!measuring && (
                              <button
                                type="button"
                                onClick={() => setTool('measure')}
                                className="flex-1 rounded-lg border border-[var(--accent)]/40 bg-[var(--accent)]/10 px-2 py-1.5 text-xs font-medium text-[var(--accent)]"
                              >
                                Continuar
                              </button>
                            )}
                            <button
                              type="button"
                              disabled={measurePoints.length === 0}
                              onClick={() =>
                                setMeasurePoints((prev) => prev.slice(0, -1))
                              }
                              className="flex-1 rounded-lg border border-[var(--border)] px-2 py-1.5 text-xs hover:bg-[var(--bg-elevated)] disabled:opacity-40"
                            >
                              Deshacer
                            </button>
                            <button
                              type="button"
                              disabled={measurePoints.length === 0}
                              onClick={() => setMeasurePoints([])}
                              className="flex-1 rounded-lg border border-[var(--border)] px-2 py-1.5 text-xs hover:bg-[var(--bg-elevated)] disabled:opacity-40"
                            >
                              Limpiar
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </aside>
            )}
          </div>

          <MapElementEditModal
            open={!!editing && !routingCableId && !drawingZoneId}
            element={editing}
            type={editing?.type ?? elementType}
            isNew={!!editing && !drafts.some((d) => d.id === editing.id)}
            allDrafts={drafts}
            clients={locationsQuery.data?.clients ?? []}
            onClose={() => setEditing(null)}
            onSave={saveElement}
            onDelete={deleteElement}
            onTraceRoute={(el) => {
              if (el.type === 'zone') startDrawZone(el)
              else startTraceRoute(el)
            }}
          />

          <MufaViewModal
            open={!!viewingMufa && !routingCableId}
            mufa={
              viewingMufa
                ? (drafts.find((d) => d.id === viewingMufa.id) ?? viewingMufa)
                : null
            }
            drafts={drafts}
            onClose={() => setViewingMufa(null)}
            onChange={updateEnclosure}
            onEdit={(m) => {
              setViewingMufa(null)
              setEditing(m)
            }}
          />

          <NapViewModal
            open={!!viewingNap && !routingCableId}
            nap={
              viewingNap
                ? (drafts.find((d) => d.id === viewingNap.id) ?? viewingNap)
                : null
            }
            drafts={drafts}
            clients={locationsQuery.data?.clients ?? []}
            onClose={() => setViewingNap(null)}
            onChange={updateEnclosure}
            onEdit={(m) => {
              setViewingNap(null)
              setEditing(m)
            }}
          />

          <NodeViewModal
            open={!!viewingNodeId && !routingCableId}
            nodeId={viewingNodeId}
            nodeLabel={
              nodesQuery.data?.find((n) => n.id === viewingNodeId)?.label ??
              'Nodo'
            }
            drafts={drafts}
            canWrite
            onClose={() => setViewingNodeId(null)}
          />
        </div>
      )}
    </PanelShell>
  )
}
