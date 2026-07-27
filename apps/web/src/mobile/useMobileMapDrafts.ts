import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../auth/AuthContext'
import {
  loadMapDrafts,
  saveMapDrafts,
  type MapDraftElement,
} from '../lib/map-elements'

/** Borradores del mapa de red (mismo localStorage que la vista web). */
export function useMobileMapDrafts() {
  const { user } = useAuth()
  const tenantKey = user?.tenantSlug ?? user?.tenantId
  const [drafts, setDrafts] = useState<MapDraftElement[]>([])
  const [ready, setReady] = useState(false)

  useEffect(() => {
    setDrafts(loadMapDrafts(tenantKey))
    setReady(true)
  }, [tenantKey])

  useEffect(() => {
    if (!ready) return
    saveMapDrafts(tenantKey, drafts)
  }, [drafts, ready, tenantKey])

  const updateEnclosure = useCallback((next: MapDraftElement) => {
    setDrafts((prev) =>
      prev.map((d) => (d.id === next.id ? { ...d, ...next } : d)),
    )
  }, [])

  const saveElement = useCallback((next: MapDraftElement) => {
    setDrafts((prev) => {
      const exists = prev.some((d) => d.id === next.id)
      return exists
        ? prev.map((d) => (d.id === next.id ? { ...d, ...next } : d))
        : [...prev, next]
    })
  }, [])

  const deleteElement = useCallback((id: string) => {
    setDrafts((prev) => prev.filter((d) => d.id !== id))
  }, [])

  return {
    tenantKey,
    drafts,
    setDrafts,
    ready,
    updateEnclosure,
    saveElement,
    deleteElement,
  }
}

export function useGeolocationCoords() {
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(
    null,
  )
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!navigator.geolocation) {
      setError('GPS no disponible en este dispositivo')
      setLoading(false)
      return
    }
    const watch = navigator.geolocation.watchPosition(
      (pos) => {
        setCoords({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        })
        setError(null)
        setLoading(false)
      },
      (err) => {
        setError(err.message || 'No se pudo obtener la ubicación')
        setLoading(false)
      },
      { enableHighAccuracy: true, maximumAge: 15_000, timeout: 20_000 },
    )
    return () => navigator.geolocation.clearWatch(watch)
  }, [])

  return { coords, error, loading }
}
