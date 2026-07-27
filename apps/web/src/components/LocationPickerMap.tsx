import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

/** Inline pin so we don't depend on leaflet's image assets. */
const pinIcon = L.divIcon({
  className: '',
  html: `<svg width="30" height="42" viewBox="0 0 30 42" xmlns="http://www.w3.org/2000/svg">
    <path d="M15 0C6.7 0 0 6.7 0 15c0 11.2 15 27 15 27s15-15.8 15-27C30 6.7 23.3 0 15 0z" fill="#e11d48"/>
    <circle cx="15" cy="15" r="6" fill="#fff"/>
  </svg>`,
  iconSize: [30, 42],
  iconAnchor: [15, 42],
})

const FALLBACK_CENTER: [number, number] = [-33.4489, -70.6693]

export type LocationPickerMapHandle = {
  /** Coloca (o mueve) el pin al centro actual del mapa y devuelve esas coords. */
  placePinAtCenter: () => { lat: number; lng: number } | null
  /** Centro visible del mapa. */
  getCenter: () => { lat: number; lng: number } | null
}

export const LocationPickerMap = forwardRef<
  LocationPickerMapHandle,
  {
    lat: number | null
    lng: number | null
    onChange?: (lat: number, lng: number) => void
    /** Solo visualización: sin clic ni arrastre. */
    readOnly?: boolean
    className?: string
  }
>(function LocationPickerMap(
  { lat, lng, onChange, readOnly = false, className = 'h-72 w-full rounded-lg' },
  ref,
) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<L.Map | null>(null)
  const markerRef = useRef<L.Marker | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const readOnlyRef = useRef(readOnly)
  readOnlyRef.current = readOnly
  /** Evita recentrar el mapa cuando el cambio viene del drag del propio pin. */
  const skipViewRef = useRef(false)

  function ensureMarker(la: number, lo: number) {
    const map = mapRef.current
    if (!map) return null
    if (!markerRef.current) {
      const marker = L.marker([la, lo], {
        icon: pinIcon,
        draggable: !readOnlyRef.current,
      })
      marker.on('dragend', () => {
        if (readOnlyRef.current) return
        const p = marker.getLatLng()
        skipViewRef.current = true
        onChangeRef.current?.(p.lat, p.lng)
      })
      marker.addTo(map)
      markerRef.current = marker
    } else {
      markerRef.current.setLatLng([la, lo])
      if (markerRef.current.dragging) {
        if (readOnlyRef.current) markerRef.current.dragging.disable()
        else markerRef.current.dragging.enable()
      }
    }
    return markerRef.current
  }

  useImperativeHandle(ref, () => ({
    getCenter: () => {
      const map = mapRef.current
      if (!map) return null
      const c = map.getCenter()
      return { lat: c.lat, lng: c.lng }
    },
    placePinAtCenter: () => {
      const map = mapRef.current
      if (!map || readOnlyRef.current) return null
      const c = map.getCenter()
      ensureMarker(c.lat, c.lng)
      map.setView([c.lat, c.lng], Math.max(map.getZoom(), 16))
      onChangeRef.current?.(c.lat, c.lng)
      return { lat: c.lat, lng: c.lng }
    },
  }))

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    const hasPos = lat != null && lng != null
    const map = L.map(containerRef.current, {
      center: hasPos ? [lat!, lng!] : FALLBACK_CENTER,
      zoom: hasPos ? 17 : 12,
      dragging: !readOnly,
      scrollWheelZoom: !readOnly,
      doubleClickZoom: !readOnly,
      boxZoom: !readOnly,
      keyboard: !readOnly,
    })
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap',
    }).addTo(map)

    map.on('click', (e: L.LeafletMouseEvent) => {
      if (readOnlyRef.current) return
      skipViewRef.current = true
      ensureMarker(e.latlng.lat, e.latlng.lng)
      onChangeRef.current?.(e.latlng.lat, e.latlng.lng)
    })

    mapRef.current = map

    /** Evita crash `_leaflet_pos` si el mapa ya se destruyó o el pane no está listo. */
    const safeInvalidate = () => {
      try {
        if (mapRef.current !== map) return
        const container = map.getContainer()
        if (!container?.isConnected) return
        map.invalidateSize({ animate: false })
      } catch {
        /* mapa desmontado a medias */
      }
    }

    const sizeTimer = window.setTimeout(safeInvalidate, 50)

    let ro: ResizeObserver | null = null
    if (typeof ResizeObserver !== 'undefined' && containerRef.current) {
      ro = new ResizeObserver(() => safeInvalidate())
      ro.observe(containerRef.current)
    }

    return () => {
      window.clearTimeout(sizeTimer)
      ro?.disconnect()
      map.remove()
      mapRef.current = null
      markerRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (lat == null || lng == null) {
      if (markerRef.current) {
        markerRef.current.remove()
        markerRef.current = null
      }
      return
    }
    ensureMarker(lat, lng)
    if (skipViewRef.current) {
      skipViewRef.current = false
      return
    }
    map.setView([lat, lng], Math.max(map.getZoom(), 16))
  }, [lat, lng, readOnly])

  return <div ref={containerRef} className={className} />
})
