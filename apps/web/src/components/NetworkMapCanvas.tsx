import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import {
  mapElementColor,
  mapElementLabel,
  mapElementSvgInner,
  mapElementBareIcon,
  type MapElementType,
} from '../lib/map-elements'

const FALLBACK_CENTER: [number, number] = [-33.4489, -70.6693]

type BaseLayerId = 'map' | 'satellite'

const BASE_LAYERS: {
  id: BaseLayerId
  label: string
  url: string
  attribution: string
  /** Zoom máximo permitido en el control (puede ampliar el tile nativo). */
  maxZoom: number
  /** Último nivel con tiles reales del proveedor. */
  maxNativeZoom: number
}[] = [
  {
    id: 'map',
    label: 'Mapa',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '© OpenStreetMap',
    maxZoom: 21,
    maxNativeZoom: 19,
  },
  {
    id: 'satellite',
    label: 'Satélite',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: '© Esri, Maxar, Earthstar Geographics',
    maxZoom: 21,
    maxNativeZoom: 19,
  },
]

export type NetworkMapMarkerKind = 'client' | 'onu' | 'node' | MapElementType

export type NetworkMapMarker = {
  id: string
  kind: NetworkMapMarkerKind
  lat: number
  lng: number
  label: string
  subtitle?: string | null
  /** Solo nodos: salud agregada de activos (mapa de calor). */
  health?: 'ok' | 'degraded' | 'down' | 'unknown'
  onlineCount?: number
  offlineCount?: number
  assetCount?: number
  /** Elementos de edición: el clic abre la modal en vez del popup. */
  editable?: boolean
  /** HTML del popup de solo lectura (mapa bloqueado). */
  popupHtml?: string
}

function pinIcon(color: string) {
  return L.divIcon({
    className: '',
    html: `<svg width="28" height="40" viewBox="0 0 30 42" xmlns="http://www.w3.org/2000/svg">
      <path d="M15 0C6.7 0 0 6.7 0 15c0 11.2 15 27 15 27s15-15.8 15-27C30 6.7 23.3 0 15 0z" fill="${color}"/>
      <circle cx="15" cy="15" r="6" fill="#fff"/>
    </svg>`,
    iconSize: [28, 40],
    iconAnchor: [14, 40],
    popupAnchor: [0, -36],
  })
}

function nodeHeatIcon(health: NetworkMapMarker['health']) {
  const color =
    health === 'ok'
      ? '#22c55e'
      : health === 'degraded'
        ? '#f59e0b'
        : health === 'down'
          ? '#ef4444'
          : '#94a3b8'
  const glow =
    health === 'down'
      ? '0 0 0 10px rgba(239,68,68,0.28)'
      : health === 'degraded'
        ? '0 0 0 8px rgba(245,158,11,0.22)'
        : health === 'ok'
          ? '0 0 0 6px rgba(34,197,94,0.18)'
          : '0 0 0 4px rgba(148,163,184,0.15)'
  return L.divIcon({
    className: '',
    html: `<div style="width:22px;height:22px;border-radius:999px;background:${color};border:2px solid #fff;box-shadow:${glow}"></div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
    popupAnchor: [0, -12],
  })
}

function elementIcon(type: MapElementType) {
  const color = mapElementColor[type] ?? '#64748b'
  const bare = mapElementBareIcon(type)
  const stroke = bare ? color : '#fff'
  const inner = mapElementSvgInner(type, stroke)
  if (bare) {
    return L.divIcon({
      className: 'isp-map-element-icon',
      html: `<div style="width:28px;height:36px;display:flex;align-items:center;justify-content:center;background:transparent">
        <svg width="26" height="34" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${inner}</svg>
      </div>`,
      iconSize: [28, 36],
      iconAnchor: [14, 34],
      popupAnchor: [0, -30],
    })
  }
  return L.divIcon({
    className: 'isp-map-element-icon',
    html: `<div style="width:34px;height:34px;display:flex;align-items:center;justify-content:center;border-radius:10px;background:${color};border:2px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.4)">
      <svg width="22" height="22" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${inner}</svg>
    </div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
    popupAnchor: [0, -18],
  })
}

const CLIENT_ICON = pinIcon('#2563eb')
const ONU_ICON = pinIcon('#d97706')

export type NetworkMapPath = {
  id: string
  label: string
  /** Color del cable en mapa (una sola línea; pelos van por dentro). */
  color: string
  points: [number, number][]
  /** Cable seleccionado: todos sus segmentos se resaltan juntos. */
  selected?: boolean
  active?: boolean
  /** Popup de detalle (mapa bloqueado). */
  popupHtml?: string
}

export type NetworkMapPolygon = {
  id: string
  label: string
  color: string
  points: [number, number][]
  selected?: boolean
  active?: boolean
  /** Si false, la zona no captura clics (pasa a cables/markers debajo). */
  interactive?: boolean
  /** Popup de detalle (mapa bloqueado). */
  popupHtml?: string
}

function collectMapBounds(
  markers: NetworkMapMarker[],
  paths: NetworkMapPath[],
  polygons: NetworkMapPolygon[],
): L.LatLngBounds | null {
  const points: [number, number][] = []
  for (const m of markers) points.push([m.lat, m.lng])
  for (const p of paths) {
    for (const pt of p.points) points.push(pt)
  }
  for (const poly of polygons) {
    for (const pt of poly.points) points.push(pt)
  }
  if (points.length === 0) return null
  return L.latLngBounds(points)
}

function fitMapToContent(
  map: L.Map,
  markers: NetworkMapMarker[],
  paths: NetworkMapPath[],
  polygons: NetworkMapPolygon[],
) {
  const bounds = collectMapBounds(markers, paths, polygons)
  if (!bounds) return
  map.invalidateSize()
  const ne = bounds.getNorthEast()
  const sw = bounds.getSouthWest()
  if (ne.lat === sw.lat && ne.lng === sw.lng) {
    map.setView(bounds.getCenter(), Math.min(map.getZoom(), 16), {
      animate: true,
    })
    return
  }
  map.fitBounds(bounds.pad(0.12), { maxZoom: 18, animate: true })
}

/**
 * Mapa base OpenStreetMap (módulo Mapa de red) con markers de clientes / ONUs.
 */
export function NetworkMapCanvas({
  center,
  zoom = 13,
  markers = [],
  paths = [],
  polygons = [],
  className = 'h-full w-full',
  fitToMarkers = true,
  fitAllRequest = 0,
  placeMode = false,
  routeMode = false,
  dropAnchorMode = false,
  measureMode = false,
  measurePoints = [],
  onMarkerClick,
  onMarkerMove,
  onPathClick,
  onPathVertexClick,
  onPathVertexRemove,
  onPolygonClick,
  onPolygonVertexMove,
  onPolygonEdgeClick,
  onMapClick,
  routingCableId = null,
  routingFrom = 'end',
  userLocation = null,
  followUserLocation = false,
}: {
  center?: [number, number] | null
  zoom?: number
  markers?: NetworkMapMarker[]
  paths?: NetworkMapPath[]
  polygons?: NetworkMapPolygon[]
  className?: string
  /** Ajusta la vista una sola vez cuando llegan los primeros markers. */
  fitToMarkers?: boolean
  /** Incrementar para centrar la vista en markers, cables y zonas visibles. */
  fitAllRequest?: number
  /** El próximo clic en el mapa coloca un elemento nuevo. */
  placeMode?: boolean
  /** Modo trazar tendido: clic en mapa o en postes. */
  routeMode?: boolean
  /** Añadiendo drop: clic en NAP/cliente inicia el drop anclado. */
  dropAnchorMode?: boolean
  /** Modo medir: clics añaden vértices al recorrido. */
  measureMode?: boolean
  measurePoints?: [number, number][]
  onMarkerClick?: (marker: NetworkMapMarker) => void
  /** Solo markers `editable`: nueva posición tras arrastrar. */
  onMarkerMove?: (marker: NetworkMapMarker, lat: number, lng: number) => void
  /** Clic en cualquier segmento: selecciona el cable completo. */
  onPathClick?: (pathId: string) => void
  /** Clic en un vértice (inicio/fin → continuar trazo). */
  onPathVertexClick?: (pathId: string, vertexIndex: number) => void
  /** Clic derecho sobre un vértice del tendido. */
  onPathVertexRemove?: (pathId: string, vertexIndex: number) => void
  onPolygonClick?: (polygonId: string) => void
  /** Arrastrar un vértice de zona (al soltar). */
  onPolygonVertexMove?: (
    polygonId: string,
    vertexIndex: number,
    lat: number,
    lng: number,
  ) => void
  /** Clic en una arista del perímetro → insertar vértice. */
  onPolygonEdgeClick?: (
    polygonId: string,
    afterIndex: number,
    lat: number,
    lng: number,
  ) => void
  onMapClick?: (lat: number, lng: number) => void
  /** Cable en modo trazo (para resaltar el extremo activo). */
  routingCableId?: string | null
  routingFrom?: 'start' | 'end'
  /** Puntero GPS del dispositivo. */
  userLocation?: { lat: number; lng: number } | null
  /** Si true, centra el mapa cuando cambia la ubicación GPS. */
  followUserLocation?: boolean
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<L.Map | null>(null)
  const layerRef = useRef<L.LayerGroup | null>(null)
  const pathLayerRef = useRef<L.LayerGroup | null>(null)
  const polygonLayerRef = useRef<L.LayerGroup | null>(null)
  const measureLayerRef = useRef<L.LayerGroup | null>(null)
  const userLocationLayerRef = useRef<L.LayerGroup | null>(null)
  const tileRef = useRef<L.TileLayer | null>(null)
  const didFitRef = useRef(false)
  const didFollowUserRef = useRef(false)
  const [baseLayer, setBaseLayer] = useState<BaseLayerId>('map')
  const onMarkerClickRef = useRef(onMarkerClick)
  onMarkerClickRef.current = onMarkerClick
  const onMarkerMoveRef = useRef(onMarkerMove)
  onMarkerMoveRef.current = onMarkerMove
  const onPathClickRef = useRef(onPathClick)
  onPathClickRef.current = onPathClick
  const onPathVertexClickRef = useRef(onPathVertexClick)
  onPathVertexClickRef.current = onPathVertexClick
  const onPathVertexRemoveRef = useRef(onPathVertexRemove)
  onPathVertexRemoveRef.current = onPathVertexRemove
  const onPolygonClickRef = useRef(onPolygonClick)
  onPolygonClickRef.current = onPolygonClick
  const onPolygonVertexMoveRef = useRef(onPolygonVertexMove)
  onPolygonVertexMoveRef.current = onPolygonVertexMove
  const onPolygonEdgeClickRef = useRef(onPolygonEdgeClick)
  onPolygonEdgeClickRef.current = onPolygonEdgeClick
  const onMapClickRef = useRef(onMapClick)
  onMapClickRef.current = onMapClick
  const placeModeRef = useRef(placeMode)
  placeModeRef.current = placeMode
  const routeModeRef = useRef(routeMode)
  routeModeRef.current = routeMode
  const dropAnchorModeRef = useRef(dropAnchorMode)
  dropAnchorModeRef.current = dropAnchorMode
  const measureModeRef = useRef(measureMode)
  measureModeRef.current = measureMode
  const routingCableIdRef = useRef(routingCableId)
  routingCableIdRef.current = routingCableId
  const routingFromRef = useRef(routingFrom)
  routingFromRef.current = routingFrom

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    const map = L.map(containerRef.current, {
      center: center ?? FALLBACK_CENTER,
      zoom,
      maxZoom: 21,
    })
    const base = BASE_LAYERS[0]
    tileRef.current = L.tileLayer(base.url, {
      maxZoom: base.maxZoom,
      maxNativeZoom: base.maxNativeZoom,
      attribution: base.attribution,
    }).addTo(map)

    layerRef.current = L.layerGroup().addTo(map)
    polygonLayerRef.current = L.layerGroup().addTo(map)
    pathLayerRef.current = L.layerGroup().addTo(map)
    measureLayerRef.current = L.layerGroup().addTo(map)
    userLocationLayerRef.current = L.layerGroup().addTo(map)
    // Capas SVG (overlayPane=400). Zonas al fondo; cables/drops encima
    // para poder seleccionarlos; asas de zona editada por encima de cables.
    if (!map.getPane('zones')) {
      map.createPane('zones')
      const pane = map.getPane('zones')
      if (pane) pane.style.zIndex = '350'
    }
    if (!map.getPane('cables')) {
      map.createPane('cables')
      const pane = map.getPane('cables')
      if (pane) pane.style.zIndex = '450'
    }
    if (!map.getPane('zoneHandles')) {
      map.createPane('zoneHandles')
      const pane = map.getPane('zoneHandles')
      if (pane) pane.style.zIndex = '470'
    }
    // Extremos de cable por encima de postes/mufas (markerPane=600)
    // para que el clic cambie la dirección de continuación.
    if (!map.getPane('cableEndpoints')) {
      map.createPane('cableEndpoints')
      const pane = map.getPane('cableEndpoints')
      if (pane) pane.style.zIndex = '650'
    }
    if (!map.getPane('measure')) {
      map.createPane('measure')
      const pane = map.getPane('measure')
      if (pane) pane.style.zIndex = '660'
    }
    if (!map.getPane('userLocation')) {
      map.createPane('userLocation')
      const pane = map.getPane('userLocation')
      if (pane) pane.style.zIndex = '670'
    }
    mapRef.current = map
    didFitRef.current = false
    window.setTimeout(() => map.invalidateSize(), 50)

    map.on('click', (e: L.LeafletMouseEvent) => {
      onMapClickRef.current?.(e.latlng.lat, e.latlng.lng)
    })

    let ro: ResizeObserver | null = null
    if (typeof ResizeObserver !== 'undefined' && containerRef.current) {
      ro = new ResizeObserver(() => map.invalidateSize())
      ro.observe(containerRef.current)
    }

    return () => {
      ro?.disconnect()
      map.remove()
      mapRef.current = null
      layerRef.current = null
      polygonLayerRef.current = null
      pathLayerRef.current = null
      measureLayerRef.current = null
      userLocationLayerRef.current = null
      tileRef.current = null
      didFitRef.current = false
      didFollowUserRef.current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- map once on mount
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const def = BASE_LAYERS.find((b) => b.id === baseLayer) ?? BASE_LAYERS[0]
    if (tileRef.current) {
      map.removeLayer(tileRef.current)
    }
    tileRef.current = L.tileLayer(def.url, {
      maxZoom: def.maxZoom,
      maxNativeZoom: def.maxNativeZoom,
      attribution: def.attribution,
    }).addTo(map)
  }, [baseLayer])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const el = map.getContainer()
    el.style.cursor = placeMode || routeMode || measureMode ? 'crosshair' : ''
    return () => {
      el.style.cursor = ''
    }
  }, [placeMode, routeMode, measureMode])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !center || markers.length > 0 || didFitRef.current) return
    map.setView(center, map.getZoom(), { animate: false })
  }, [center, markers.length])

  useEffect(() => {
    if (!fitAllRequest) return
    const map = mapRef.current
    if (!map) return
    fitMapToContent(map, markers, paths, polygons)
  }, [fitAllRequest, markers, paths, polygons])

  useEffect(() => {
    const map = mapRef.current
    const group = polygonLayerRef.current
    if (!map || !group) return
    group.clearLayers()

    for (const poly of polygons) {
      if (poly.points.length < 1) continue
      const highlighted = poly.active || poly.selected
      const color = poly.color || '#3b82f6'
      const editable =
        highlighted &&
        !!(onPolygonVertexMoveRef.current || onPolygonEdgeClickRef.current)

      if (poly.points.length >= 3) {
        const clickable = poly.interactive !== false
        const layer = L.polygon(poly.points, {
          pane: 'zones',
          interactive: clickable,
          color: highlighted ? '#22d3ee' : color,
          weight: highlighted ? 3 : 2,
          opacity: 0.95,
          fillColor: color,
          fillOpacity: highlighted ? 0.35 : 0.22,
        })
        if (clickable) {
          layer.bindTooltip(
            editable
              ? `${poly.label} · arrastra vértices · clic en arista = nuevo punto · clic derecho = borrar`
              : poly.label,
            { sticky: true },
          )
          if (poly.popupHtml) {
            layer.bindPopup(poly.popupHtml, {
              maxWidth: 320,
              className: 'isp-map-detail-popup',
            })
          }
          layer.on('click', (event: L.LeafletMouseEvent) => {
            L.DomEvent.stopPropagation(event)
            // Colocando / trazando / midiendo / dibujando: el clic pasa al mapa.
            if (
              placeModeRef.current ||
              routeModeRef.current ||
              measureModeRef.current
            ) {
              onMapClickRef.current?.(event.latlng.lat, event.latlng.lng)
              return
            }
            if (poly.popupHtml) {
              layer.openPopup(event.latlng)
              return
            }
            onPolygonClickRef.current?.(poly.id)
          })
        }
        group.addLayer(layer)
      } else if (poly.points.length === 2) {
        const line = L.polyline(poly.points, {
          pane: 'zones',
          interactive: poly.interactive !== false,
          color: highlighted ? '#22d3ee' : color,
          weight: highlighted ? 3 : 2,
          dashArray: '6 4',
        })
        if (poly.interactive !== false) {
          line.bindTooltip(poly.label, { sticky: true })
        }
        group.addLayer(line)
      }

      if (!editable) continue

      // Aristas clicables para insertar vértices (hit area ancha).
      // Pane por encima de cables para poder editar la zona seleccionada.
      const edgeCount =
        poly.points.length >= 3 ? poly.points.length : Math.max(0, poly.points.length - 1)
      for (let i = 0; i < edgeCount; i++) {
        const a = poly.points[i]
        const b = poly.points[(i + 1) % poly.points.length]
        const edge = L.polyline([a, b], {
          pane: 'zoneHandles',
          color: '#22d3ee',
          weight: 14,
          opacity: 0,
          interactive: true,
          bubblingMouseEvents: false,
        })
        edge.bindTooltip('Clic para añadir punto', {
          sticky: true,
          direction: 'top',
        })
        edge.on('click', (event: L.LeafletMouseEvent) => {
          L.DomEvent.stopPropagation(event)
          // Colocando otro elemento o trazando: pasar el clic al mapa
          // (salvo que esta misma zona esté en modo dibujo).
          if (
            (placeModeRef.current || routeModeRef.current) &&
            !poly.active
          ) {
            onMapClickRef.current?.(event.latlng.lat, event.latlng.lng)
            return
          }
          onPolygonEdgeClickRef.current?.(
            poly.id,
            i,
            event.latlng.lat,
            event.latlng.lng,
          )
        })
        group.addLayer(edge)
      }

      poly.points.forEach(([la, lo], vertexIndex) => {
        const isLast = vertexIndex === poly.points.length - 1
        const dot = L.circleMarker([la, lo], {
          pane: 'zoneHandles',
          radius: isLast && poly.active ? 8 : 6,
          color: '#fff',
          weight: 2,
          fillColor: isLast && poly.active ? '#22d3ee' : color,
          fillOpacity: 1,
          bubblingMouseEvents: false,
        })
        dot.bindTooltip(
          `Vértice ${vertexIndex + 1} · arrastrar · clic derecho borrar`,
          { direction: 'top' },
        )
        dot.on('mousedown', (event: L.LeafletMouseEvent) => {
          L.DomEvent.stopPropagation(event)
          L.DomEvent.preventDefault(event.originalEvent)
          map.dragging.disable()
          let done = false
          const onMove = (ev: L.LeafletMouseEvent) => {
            dot.setLatLng(ev.latlng)
          }
          const finish = (lat: number, lng: number) => {
            if (done) return
            done = true
            map.off('mousemove', onMove)
            map.off('mouseup', onUp)
            document.removeEventListener('mouseup', onDocUp)
            map.dragging.enable()
            onPolygonVertexMoveRef.current?.(
              poly.id,
              vertexIndex,
              lat,
              lng,
            )
          }
          const onUp = (ev: L.LeafletMouseEvent) => {
            finish(ev.latlng.lat, ev.latlng.lng)
          }
          const onDocUp = () => {
            const ll = dot.getLatLng()
            finish(ll.lat, ll.lng)
          }
          map.on('mousemove', onMove)
          map.on('mouseup', onUp)
          document.addEventListener('mouseup', onDocUp)
        })
        dot.on('contextmenu', (event: L.LeafletMouseEvent) => {
          L.DomEvent.preventDefault(event.originalEvent)
          L.DomEvent.stopPropagation(event)
          onPathVertexRemoveRef.current?.(poly.id, vertexIndex)
        })
        group.addLayer(dot)
      })
    }
  }, [polygons])

  useEffect(() => {
    const group = pathLayerRef.current
    if (!group) return
    group.clearLayers()

    // Cables que comparten un mismo segmento de ruta (mismos dos puntos,
    // p. ej. enganchados a los mismos postes) se separan lado a lado.
    // Es por segmento, no por calle: aceras distintas = rutas distintas.
    const segmentCables = new Map<string, string[]>()
    for (const p of paths) {
      if (p.points.length < 2) continue
      for (let i = 0; i < p.points.length - 1; i++) {
        const key = segmentKey(p.points[i], p.points[i + 1])
        const list = segmentCables.get(key) ?? []
        if (!list.includes(p.id)) list.push(p.id)
        segmentCables.set(key, list)
      }
    }

    for (const p of paths) {
      if (p.points.length < 1) continue
      const highlighted = p.active || p.selected
      const style = {
        color: highlighted ? '#22d3ee' : p.color || '#0f172a',
        weight: highlighted ? 5 : 3,
        opacity: highlighted ? 1 : 0.9,
        lineCap: 'round' as const,
        lineJoin: 'round' as const,
      }

      if (p.points.length >= 2) {
        for (let i = 0; i < p.points.length - 1; i++) {
          const a = p.points[i]
          const b = p.points[i + 1]
          const sharedBy = segmentCables.get(segmentKey(a, b)) ?? [p.id]
          const line = L.polyline(
            offsetSegment(a, b, sharedBy.indexOf(p.id), sharedBy.length),
            { ...style, pane: 'cables' },
          )
          line.bindTooltip(p.label, { sticky: true })
          if (p.popupHtml) {
            line.bindPopup(p.popupHtml, {
              maxWidth: 320,
              className: 'isp-map-detail-popup',
            })
          }
          line.on('click', (event: L.LeafletMouseEvent) => {
            L.DomEvent.stopPropagation(event)
            if (measureModeRef.current || placeModeRef.current) {
              onMapClickRef.current?.(event.latlng.lat, event.latlng.lng)
              return
            }
            if (p.popupHtml) {
              line.openPopup(event.latlng)
              return
            }
            onPathClickRef.current?.(p.id)
          })
          group.addLayer(line)
        }
      }

      // Vértices solo al seleccionar/trazar en modo edición.
      if (
        !highlighted ||
        (!onPathVertexClickRef.current && !onPathVertexRemoveRef.current)
      ) {
        continue
      }

      p.points.forEach(([la, lo], vertexIndex) => {
        const isStart = vertexIndex === 0
        const isEnd = vertexIndex === p.points.length - 1
        const isEndpoint = isStart || isEnd
        const isActiveCable = routingCableId === p.id
        const isActiveTip =
          isActiveCable &&
          ((routingFrom === 'start' && isStart) ||
            (routingFrom === 'end' && isEnd))
        // Extremos clicables por encima de postes/mufas, salvo extremos de
        // OTROS cables mientras trazamos (para poder enganchar postes).
        const raiseEndpoint =
          isEndpoint && (!routingCableId || isActiveCable)
        const dot = L.circleMarker([la, lo], {
          radius: isActiveTip ? 9 : isEndpoint ? 7 : 5,
          color: isActiveTip ? '#22d3ee' : '#fff',
          weight: isActiveTip ? 3 : 1.5,
          fillColor: isActiveTip
            ? '#0891b2'
            : isEndpoint
              ? '#67e8f9'
              : '#22d3ee',
          fillOpacity: 1,
          pane: raiseEndpoint ? 'cableEndpoints' : 'cables',
          bubblingMouseEvents: false,
        })
        const tipLabel = isStart
          ? 'Inicio'
          : isEnd
            ? 'Final'
            : `Punto ${vertexIndex + 1}`
        dot.bindTooltip(
          isEndpoint
            ? `${tipLabel} · clic para continuar el trazado desde aquí · clic derecho para eliminar`
            : `${tipLabel} · clic derecho para eliminar`,
          { direction: 'top' },
        )
        dot.on('click', (event: L.LeafletMouseEvent) => {
          L.DomEvent.stopPropagation(event)
          if (isEndpoint && onPathVertexClickRef.current) {
            onPathVertexClickRef.current(p.id, vertexIndex)
          } else {
            onPathClickRef.current?.(p.id)
          }
        })
        dot.on('contextmenu', (event: L.LeafletMouseEvent) => {
          L.DomEvent.preventDefault(event.originalEvent)
          L.DomEvent.stopPropagation(event)
          onPathVertexRemoveRef.current?.(p.id, vertexIndex)
        })
        group.addLayer(dot)
      })
    }
  }, [paths, routingCableId, routingFrom])

  useEffect(() => {
    const group = measureLayerRef.current
    if (!group) return
    group.clearLayers()
    if (measurePoints.length === 0) return

    if (measurePoints.length >= 2) {
      const line = L.polyline(measurePoints, {
        pane: 'measure',
        color: '#f59e0b',
        weight: 3,
        dashArray: '8 6',
        opacity: 0.95,
        interactive: false,
      })
      group.addLayer(line)

      for (let i = 1; i < measurePoints.length; i++) {
        const a = measurePoints[i - 1]
        const b = measurePoints[i]
        const mid: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
        const segM =
          L.latLng(a[0], a[1]).distanceTo(L.latLng(b[0], b[1]))
        const label = L.marker(mid, {
          pane: 'measure',
          interactive: false,
          icon: L.divIcon({
            className: '',
            html: `<div style="transform:translate(-50%,-50%);white-space:nowrap;background:rgba(15,23,42,.9);color:#fbbf24;border:1px solid rgba(245,158,11,.5);border-radius:6px;padding:2px 6px;font-size:11px;font-weight:600;box-shadow:0 2px 8px rgba(0,0,0,.35)">${Math.round(segM)} m</div>`,
            iconSize: [0, 0],
            iconAnchor: [0, 0],
          }),
        })
        group.addLayer(label)
      }
    }

    measurePoints.forEach(([la, lo], i) => {
      const isLast = i === measurePoints.length - 1
      const dot = L.circleMarker([la, lo], {
        pane: 'measure',
        radius: isLast ? 7 : 5,
        color: '#fff',
        weight: 2,
        fillColor: isLast ? '#f59e0b' : '#fbbf24',
        fillOpacity: 1,
        interactive: false,
      })
      const totalSoFar =
        i === 0
          ? 0
          : measurePoints
              .slice(0, i + 1)
              .reduce((acc, pt, idx, arr) => {
                if (idx === 0) return 0
                const prev = arr[idx - 1]
                return (
                  acc +
                  L.latLng(prev[0], prev[1]).distanceTo(L.latLng(pt[0], pt[1]))
                )
              }, 0)
      dot.bindTooltip(
        i === 0
          ? 'Inicio'
          : isLast
            ? `Punto ${i + 1} · total ${Math.round(totalSoFar)} m`
            : `Punto ${i + 1} · ${Math.round(totalSoFar)} m`,
        { direction: 'top', opacity: 0.95 },
      )
      group.addLayer(dot)
    })
  }, [measurePoints])

  useEffect(() => {
    const map = mapRef.current
    const group = userLocationLayerRef.current
    if (!map || !group) return
    group.clearLayers()
    if (
      !userLocation ||
      !Number.isFinite(userLocation.lat) ||
      !Number.isFinite(userLocation.lng)
    ) {
      return
    }
    const accuracy = L.circle([userLocation.lat, userLocation.lng], {
      pane: 'userLocation',
      radius: 18,
      color: '#3b82f6',
      weight: 1,
      fillColor: '#3b82f6',
      fillOpacity: 0.18,
      interactive: false,
    })
    const dot = L.circleMarker([userLocation.lat, userLocation.lng], {
      pane: 'userLocation',
      radius: 8,
      color: '#fff',
      weight: 2,
      fillColor: '#2563eb',
      fillOpacity: 1,
      interactive: false,
    })
    group.addLayer(accuracy)
    group.addLayer(dot)

    if (followUserLocation && !didFollowUserRef.current) {
      map.setView([userLocation.lat, userLocation.lng], Math.max(map.getZoom(), 17), {
        animate: true,
      })
      didFollowUserRef.current = true
    }
  }, [userLocation, followUserLocation])

  useEffect(() => {
    const map = mapRef.current
    const group = layerRef.current
    if (!map || !group) return

    group.clearLayers()

    for (const m of markers) {
      if (!Number.isFinite(m.lat) || !Number.isFinite(m.lng)) continue
      const icon =
        m.kind === 'client'
          ? CLIENT_ICON
          : m.kind === 'onu'
            ? ONU_ICON
            : m.kind === 'node'
              ? nodeHeatIcon(m.health)
              : elementIcon(m.kind)
      const marker = L.marker([m.lat, m.lng], {
        icon,
        draggable: !!m.editable && m.kind !== 'cable',
        // En modo ruta / anclar drop, postes, mufas, NAPs, nodos y clientes arriba
        zIndexOffset:
          (routeMode || dropAnchorMode) &&
          (m.kind === 'pole' ||
            m.kind === 'mufa' ||
            m.kind === 'nap' ||
            m.kind === 'node' ||
            m.kind === 'client')
            ? 800
            : 0,
      })
      const title =
        m.kind === 'client'
          ? 'Cliente'
          : m.kind === 'onu'
            ? 'ONU · servicio'
            : m.kind === 'node'
              ? 'Nodo'
              : mapElementLabel[m.kind]

      // Solo lectura: popup HTML opcional.
      if (m.popupHtml && !m.editable) {
        marker.bindPopup(m.popupHtml, {
          maxWidth: 320,
          className: 'isp-map-detail-popup',
        })
        marker.bindTooltip(`${title} · ${m.label}`, { direction: 'top' })
        group.addLayer(marker)
        continue
      }

      // Vista / inspección: clic externo, sin popup por defecto.
      if (!m.editable && onMarkerClickRef.current) {
        marker.on('click', (e: L.LeafletMouseEvent) => {
          L.DomEvent.stopPropagation(e)
          onMarkerClickRef.current?.(m)
        })
        marker.bindTooltip(`${title} · ${m.label}`, { direction: 'top' })
        group.addLayer(marker)
        continue
      }

      if (m.editable) {
        marker.on('click', (e: L.LeafletMouseEvent) => {
          L.DomEvent.stopPropagation(e)
          onMarkerClickRef.current?.(m)
        })
        marker.on('dragend', () => {
          const p = marker.getLatLng()
          onMarkerMoveRef.current?.(m, p.lat, p.lng)
        })
        marker.bindTooltip(
          dropAnchorMode && m.kind === 'nap'
            ? `Iniciar drop · ${m.label}`
            : routeMode &&
                (m.kind === 'pole' ||
                  m.kind === 'mufa' ||
                  m.kind === 'nap' ||
                  m.kind === 'client')
              ? `Enganchar · ${m.label}`
              : `${title} · ${m.label}`,
          { direction: 'top' },
        )
        group.addLayer(marker)
        continue
      }

      // Nodo físico: clic abre la vista de cabeceras (o engancha el tendido)
      if (m.kind === 'node') {
        const health =
          m.health === 'ok'
            ? 'Operativo'
            : m.health === 'degraded'
              ? 'Degradado'
              : m.health === 'down'
                ? 'Caído'
                : 'Sin datos'
        marker.on('click', (e: L.LeafletMouseEvent) => {
          L.DomEvent.stopPropagation(e)
          onMarkerClickRef.current?.(m)
        })
        marker.bindTooltip(
          routeMode
            ? `Enganchar · ${m.label}`
            : `${title} · ${m.label} · ${health}`,
          { direction: 'top' },
        )
        group.addLayer(marker)
        continue
      }

      // Cliente: iniciar/enganchar drop, o popup
      if (m.kind === 'client') {
        marker.on('click', (e: L.LeafletMouseEvent) => {
          L.DomEvent.stopPropagation(e)
          onMarkerClickRef.current?.(m)
        })
        marker.bindTooltip(
          dropAnchorMode
            ? `Iniciar drop · ${m.label}`
            : routeMode
              ? `Enganchar drop · ${m.label}`
              : `${title} · ${m.label}`,
          { direction: 'top' },
        )
        if (!routeMode && !dropAnchorMode) {
          const sub = m.subtitle
            ? `<div style="margin-top:2px;opacity:.75;font-size:12px">${escapeHtml(m.subtitle)}</div>`
            : ''
          marker.bindPopup(
            `<div style="min-width:140px">
              <div style="font-size:11px;text-transform:uppercase;opacity:.65;margin-bottom:2px">${title}</div>
              <strong>${escapeHtml(m.label)}</strong>
              ${sub}
            </div>`,
          )
        }
        group.addLayer(marker)
        continue
      }

      const sub = m.subtitle
        ? `<div style="margin-top:2px;opacity:.75;font-size:12px">${escapeHtml(m.subtitle)}</div>`
        : ''
      marker.bindPopup(
        `<div style="min-width:140px">
          <div style="font-size:11px;text-transform:uppercase;opacity:.65;margin-bottom:2px">${title}</div>
          <strong>${escapeHtml(m.label)}</strong>
          ${sub}
        </div>`,
      )
      group.addLayer(marker)
    }

    if (fitToMarkers && !didFitRef.current && markers.length > 0) {
      const bounds = L.latLngBounds(
        markers.map((m) => [m.lat, m.lng] as [number, number]),
      )
      if (bounds.isValid()) {
        map.fitBounds(bounds.pad(0.18), { maxZoom: 18, animate: false })
        didFitRef.current = true
      }
    }
  }, [markers, fitToMarkers, routeMode, dropAnchorMode])

  return (
    <div className={className}>
      <div className="relative h-full w-full">
        {/* className estático: React no debe reescribir las clases que Leaflet pone en este nodo. */}
        <div ref={containerRef} className="absolute inset-0 h-full w-full" />
        <div className="absolute right-3 top-3 z-[500] flex overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] shadow">
        {BASE_LAYERS.map((b) => {
          const active = baseLayer === b.id
          return (
            <button
              key={b.id}
              type="button"
              onClick={() => setBaseLayer(b.id)}
              aria-pressed={active}
              className={[
                'px-3 py-1.5 text-xs font-medium transition',
                active
                  ? 'bg-[var(--accent)] text-white'
                  : 'text-[var(--text-muted)] hover:bg-[var(--bg)] hover:text-[var(--text)]',
              ].join(' ')}
            >
              {b.label}
            </button>
          )
          })}
        </div>
      </div>
    </div>
  )
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function pointKey(p: [number, number]) {
  return `${p[0].toFixed(6)},${p[1].toFixed(6)}`
}

/** Clave de segmento independiente del sentido de recorrido. */
function segmentKey(a: [number, number], b: [number, number]) {
  const ka = pointKey(a)
  const kb = pointKey(b)
  return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`
}

/** Separación mínima entre cables que comparten segmento (~2 m). */
const SHARED_SEGMENT_SPACING = 0.00002

/**
 * Desplaza un segmento perpendicularmente según su posición entre los
 * cables que lo comparten. La normal se calcula con los extremos en orden
 * canónico para que todos los cables se separen hacia el mismo lado
 * aunque lo recorran en sentidos opuestos.
 */
function offsetSegment(
  a: [number, number],
  b: [number, number],
  index: number,
  count: number,
): [number, number][] {
  if (count <= 1 || index < 0) return [a, b]
  const off = (index - (count - 1) / 2) * SHARED_SEGMENT_SPACING
  const [p1, p2] = pointKey(a) < pointKey(b) ? [a, b] : [b, a]
  const dLat = p2[0] - p1[0]
  const dLng = p2[1] - p1[1]
  const len = Math.hypot(dLat, dLng) || 1
  const nLat = -dLng / len
  const nLng = dLat / len
  return [
    [a[0] + nLat * off, a[1] + nLng * off],
    [b[0] + nLat * off, b[1] + nLng * off],
  ]
}
