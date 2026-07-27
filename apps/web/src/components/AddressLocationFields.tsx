import { useEffect, useRef, useState } from 'react'
import {
  LocationPickerMap,
  type LocationPickerMapHandle,
} from './LocationPickerMap'

const inputClass =
  'w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm outline-none ring-[var(--accent)] focus:ring-2'

type NominatimResult = {
  place_id: number
  display_name: string
  lat: string
  lon: string
  address?: {
    road?: string
    house_number?: string
    city?: string
    town?: string
    village?: string
    municipality?: string
    postcode?: string
  }
}

export type AddressLocationValue = {
  street: string
  city: string
  zipCode: string
  latitude: number | null
  longitude: number | null
}

type LocationInputMode = 'address' | 'pin'

function initialMode(value: AddressLocationValue): LocationInputMode {
  const hasPin = value.latitude != null && value.longitude != null
  const hasStreet = value.street.trim().length > 0
  if (hasPin && !hasStreet) return 'pin'
  return 'address'
}

/**
 * Dirección unificada con búsqueda OpenStreetMap + mapa (mismo patrón que el alta de servicio).
 * Si se usa GPS / pin, el campo de dirección se sustituye por las coordenadas.
 */
export function AddressLocationFields({
  value,
  onChange,
  mapClassName = 'h-56 w-full rounded-lg',
  /** Si cambia (p.ej. al abrir otra ficha), reinicia dirección vs coordenadas. */
  seedKey,
}: {
  value: AddressLocationValue
  onChange: (next: AddressLocationValue) => void
  mapClassName?: string
  seedKey?: string
}) {
  const [geoResults, setGeoResults] = useState<NominatimResult[]>([])
  const [geoBusy, setGeoBusy] = useState(false)
  const [geoMsg, setGeoMsg] = useState<string | null>(null)
  const [mode, setMode] = useState<LocationInputMode>(() => initialMode(value))
  const suppressSearchRef = useRef(false)
  const valueRef = useRef(value)
  valueRef.current = value
  const mapRef = useRef<LocationPickerMapHandle>(null)

  useEffect(() => {
    if (seedKey === undefined) return
    setMode(initialMode(valueRef.current))
    setGeoResults([])
    setGeoMsg(null)
  }, [seedKey])

  function patch(partial: Partial<AddressLocationValue>) {
    onChange({ ...valueRef.current, ...partial })
  }

  function enterPinMode(
    coords?: { latitude: number; longitude: number },
    msg?: string,
  ) {
    setMode('pin')
    setGeoResults([])
    setGeoBusy(false)
    if (coords) {
      patch({
        ...coords,
        street: '',
      })
    }
    if (msg) setGeoMsg(msg)
  }

  function enterAddressMode() {
    setMode('address')
    setGeoMsg(null)
  }

  async function searchAddress(q: string, signal?: AbortSignal) {
    const query = q.trim()
    if (query.length < 3) {
      setGeoResults([])
      setGeoMsg(null)
      setGeoBusy(false)
      return
    }
    setGeoBusy(true)
    setGeoMsg(null)
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=8&q=${encodeURIComponent(query)}`,
        {
          headers: {
            Accept: 'application/json',
            'Accept-Language': 'es',
          },
          signal,
        },
      )
      if (!res.ok) throw new Error(`Buscador respondió ${res.status}`)
      const data = (await res.json()) as NominatimResult[]
      if (signal?.aborted) return
      setGeoResults(data)
      if (data.length === 0) setGeoMsg('Sin resultados para esa dirección.')
    } catch (e) {
      if (
        signal?.aborted ||
        (e instanceof DOMException && e.name === 'AbortError')
      ) {
        return
      }
      setGeoMsg(
        e instanceof Error ? e.message : 'No se pudo buscar la dirección',
      )
      setGeoResults([])
    } finally {
      if (!signal?.aborted) setGeoBusy(false)
    }
  }

  useEffect(() => {
    if (mode !== 'address') {
      setGeoResults([])
      setGeoBusy(false)
      return
    }
    if (suppressSearchRef.current) {
      suppressSearchRef.current = false
      return
    }
    const q = value.street.trim()
    if (q.length < 3) {
      setGeoResults([])
      setGeoMsg(null)
      setGeoBusy(false)
      return
    }
    setGeoBusy(true)
    const ac = new AbortController()
    const t = window.setTimeout(() => {
      void searchAddress(q, ac.signal)
    }, 400)
    return () => {
      window.clearTimeout(t)
      ac.abort()
    }
  }, [value.street, mode])

  function applyGeoResult(r: NominatimResult) {
    suppressSearchRef.current = true
    setMode('address')
    const a = r.address
    const road = a ? [a.road, a.house_number].filter(Boolean).join(' ') : ''
    const street = (road || r.display_name).slice(0, 180)
    const cityName = a
      ? a.city || a.town || a.village || a.municipality || ''
      : ''
    patch({
      street,
      city: cityName || valueRef.current.city,
      zipCode: a?.postcode || valueRef.current.zipCode,
      latitude: Number(r.lat),
      longitude: Number(r.lon),
    })
    setGeoResults([])
    setGeoMsg(null)
  }

  function useGps() {
    if (!navigator.geolocation) {
      setGeoMsg('Este navegador no soporta GPS.')
      return
    }
    setGeoBusy(true)
    setGeoMsg(null)
    setGeoResults([])
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        enterPinMode(
          {
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
          },
          'Posición GPS aplicada. Arrastra el pin para ajustar.',
        )
        setGeoBusy(false)
      },
      (err) => {
        setGeoMsg(`GPS: ${err.message}`)
        setGeoBusy(false)
      },
      { enableHighAccuracy: true, timeout: 15_000 },
    )
  }

  function placeOnMap() {
    const placed = mapRef.current?.placePinAtCenter()
    if (!placed) {
      setGeoMsg('El mapa aún no está listo. Espera un segundo e inténtalo.')
      return
    }
    enterPinMode(
      { latitude: placed.lat, longitude: placed.lng },
      'Pin colocado en el centro del mapa. Arrástralo o haz clic para ajustar.',
    )
  }

  const hasCoords = value.latitude != null && value.longitude != null

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <div className="flex flex-wrap items-end gap-2">
          {mode === 'pin' ? (
            <label className="min-w-[12rem] flex-1 text-sm">
              <span className="mb-1 block text-[var(--text-muted)]">
                Coordenadas
              </span>
              <div
                className={`${inputClass} flex items-center justify-between gap-2 font-mono text-xs`}
              >
                <span className="truncate">
                  {hasCoords
                    ? `${value.latitude!.toFixed(6)}, ${value.longitude!.toFixed(6)}`
                    : 'Sin posición'}
                </span>
                <button
                  type="button"
                  onClick={enterAddressMode}
                  className="shrink-0 text-[11px] font-sans text-[var(--accent)] hover:underline"
                >
                  Usar dirección
                </button>
              </div>
            </label>
          ) : (
            <label className="min-w-[12rem] flex-1 text-sm">
              <span className="mb-1 block text-[var(--text-muted)]">
                Dirección
              </span>
              <div className="relative">
                <input
                  className={inputClass}
                  placeholder="Escribe la dirección para buscarla…"
                  value={value.street}
                  onChange={(e) => patch({ street: e.target.value })}
                  autoComplete="off"
                  role="combobox"
                  aria-expanded={geoResults.length > 0}
                  aria-autocomplete="list"
                />
                {geoBusy && (
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[var(--text-muted)]">
                    Buscando…
                  </span>
                )}
              </div>
            </label>
          )}
          <button
            type="button"
            disabled={geoBusy}
            onClick={useGps}
            className="rounded-lg border border-[var(--border)] px-3 py-2.5 text-sm hover:bg-[var(--bg)] disabled:opacity-60"
          >
            Usar GPS
          </button>
          <button
            type="button"
            onClick={placeOnMap}
            className="rounded-lg border border-[var(--border)] px-3 py-2.5 text-sm hover:bg-[var(--bg)]"
          >
            Posicionar en mapa
          </button>
        </div>

        {mode === 'address' &&
          value.street.trim().length > 0 &&
          value.street.trim().length < 3 && (
            <p className="text-xs text-[var(--text-muted)]">
              Escribe al menos 3 caracteres para buscar sugerencias.
            </p>
          )}
        {geoMsg && <p className="text-xs text-amber-400">{geoMsg}</p>}

        {mode === 'address' && geoResults.length > 0 && (
          <ul
            role="listbox"
            className="max-h-48 overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--bg)] shadow-md"
          >
            {geoResults.map((r) => (
              <li key={r.place_id} role="option">
                <button
                  type="button"
                  onClick={() => applyGeoResult(r)}
                  className="w-full border-b border-[var(--border)] px-3 py-2.5 text-left text-sm last:border-b-0 hover:bg-[var(--bg-elevated)]"
                >
                  {r.display_name}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <LocationPickerMap
        ref={mapRef}
        lat={value.latitude}
        lng={value.longitude}
        className={mapClassName}
        onChange={(la, lo) =>
          enterPinMode(
            { latitude: la, longitude: lo },
            'Posición actualizada. Arrastra el pin para ajustar.',
          )
        }
      />
      <p className="text-xs text-[var(--text-muted)]">
        {mode === 'pin'
          ? 'Ubicación por GPS / pin. Usa «Usar dirección» si prefieres buscar por calle.'
          : 'Usa «Posicionar en mapa» o GPS para marcar sin dirección, o busca por calle.'}
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="mb-1 block text-[var(--text-muted)]">Ciudad</span>
          <input
            className={inputClass}
            value={value.city}
            onChange={(e) => patch({ city: e.target.value })}
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-[var(--text-muted)]">
            Código postal
          </span>
          <input
            className={inputClass}
            value={value.zipCode}
            onChange={(e) => patch({ zipCode: e.target.value })}
          />
        </label>
      </div>
    </div>
  )
}
