import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../auth/AuthContext'
import {
  loadMapDrafts,
  saveMapDrafts,
  type MapDraftElement,
} from '../lib/map-elements'
import {
  flushPendingPoles,
  loadPendingPoles,
  pullServerDrafts,
} from '../lib/mapDraftSync'

/** Borradores del mapa de red (local + sync servidor). */
export function useMobileMapDrafts() {
  const { user } = useAuth()
  const tenantKey = user?.tenantSlug ?? user?.tenantId
  const [drafts, setDrafts] = useState<MapDraftElement[]>([])
  const [ready, setReady] = useState(false)
  const [pendingCount, setPendingCount] = useState(0)
  const [syncing, setSyncing] = useState(false)

  const refreshPending = useCallback(() => {
    setPendingCount(loadPendingPoles(tenantKey).length)
  }, [tenantKey])

  useEffect(() => {
    let cancelled = false
    setReady(false)
    setDrafts(loadMapDrafts(tenantKey))
    refreshPending()

    void pullServerDrafts(tenantKey).then((merged) => {
      if (!cancelled) {
        setDrafts(merged)
        setReady(true)
      }
    })

    return () => {
      cancelled = true
    }
  }, [tenantKey, refreshPending])

  useEffect(() => {
    if (!ready) return
    saveMapDrafts(tenantKey, drafts)
  }, [drafts, ready, tenantKey])

  const runFlush = useCallback(async () => {
    setSyncing(true)
    try {
      await flushPendingPoles(tenantKey)
      refreshPending()
      setDrafts(loadMapDrafts(tenantKey))
    } finally {
      setSyncing(false)
    }
  }, [tenantKey, refreshPending])

  useEffect(() => {
    function onOnline() {
      void runFlush()
    }
    window.addEventListener('online', onOnline)
    if (navigator.onLine) void runFlush()
    return () => window.removeEventListener('online', onOnline)
  }, [runFlush])

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
    pendingCount,
    syncing,
    flushPending: runFlush,
    refreshPending,
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
