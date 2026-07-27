import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  mapElementLabel,
  type MapDraftElement,
} from '../lib/map-elements'
import {
  NetworkMapCanvas,
  type NetworkMapMarker,
} from '../components/NetworkMapCanvas'
import {
  useGeolocationCoords,
  useMobileMapDrafts,
} from './useMobileMapDrafts'

function newDraftId() {
  return `draft-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Siguiente número para postes con la misma etiqueta: "Calle 3". */
function nextPoleName(
  drafts: MapDraftElement[],
  label: string,
): { name: string; number: number } {
  const base = label.trim() || 'Poste'
  const re = new RegExp(`^${escapeRegExp(base)}\\s+(\\d+)$`, 'i')
  let max = 0
  for (const d of drafts) {
    if (d.type !== 'pole') continue
    const m = d.name.trim().match(re)
    if (m) max = Math.max(max, Number(m[1]))
  }
  const number = max + 1
  return { name: `${base} ${number}`, number }
}

export function MobileNetworkMapPolesPage() {
  const { coords, error: geoError, loading: geoLoading } =
    useGeolocationCoords()
  const { drafts, ready, saveElement } = useMobileMapDrafts()
  const [label, setLabel] = useState('Poste')
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const poles = useMemo(
    () => drafts.filter((d) => d.type === 'pole'),
    [drafts],
  )

  const next = useMemo(
    () => nextPoleName(drafts, label),
    [drafts, label],
  )

  const markers = useMemo((): NetworkMapMarker[] => {
    return poles.map((d) => ({
      id: `element:${d.id}`,
      kind: 'pole' as const,
      lat: d.lat,
      lng: d.lng,
      label: d.name || mapElementLabel.pole,
      subtitle: d.notes || null,
    }))
  }, [poles])

  function addPole() {
    setMessage(null)
    setError(null)
    if (!coords) {
      setError('Esperá a tener señal GPS para añadir el poste.')
      return
    }
    const { name } = nextPoleName(drafts, label)
    const pole: MapDraftElement = {
      id: newDraftId(),
      type: 'pole',
      name,
      notes: '',
      lat: coords.lat,
      lng: coords.lng,
    }
    saveElement(pole)
    setMessage(`Añadido: ${name}`)
  }

  return (
    <div className="flex flex-1 flex-col">
      <div className="mb-3 flex items-center gap-3">
        <Link
          to="/movil/mapa-red"
          className="rounded-xl border border-[var(--border)] px-3 py-2 text-sm text-[var(--text-muted)]"
        >
          ←
        </Link>
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight">Postes</h1>
          <p className="text-xs text-[var(--text-muted)]">
            Crear postes en tu ubicación GPS
          </p>
        </div>
      </div>

      <label className="mb-3 block">
        <span className="mb-1 block text-xs font-medium text-[var(--text-muted)]">
          Etiqueta
        </span>
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Ej. Poste, Calle Sur…"
          className="w-full rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-3 text-base outline-none ring-[var(--accent)] focus:ring-2"
        />
        <span className="mt-1 block text-xs text-[var(--text-muted)]">
          Próximo: <span className="font-medium text-[var(--text)]">{next.name}</span>
        </span>
      </label>

      <div className="relative mb-3 min-h-[45dvh] flex-1 overflow-hidden rounded-2xl border border-[var(--border)]">
        <NetworkMapCanvas
          className="absolute inset-0 h-full w-full"
          markers={markers}
          paths={[]}
          polygons={[]}
          fitToMarkers
          center={
            coords
              ? [coords.lat, coords.lng]
              : markers[0]
                ? [markers[0].lat, markers[0].lng]
                : null
          }
          zoom={17}
          userLocation={coords}
          followUserLocation
        />
        {(geoLoading || geoError) && (
          <div className="pointer-events-none absolute inset-x-0 top-2 flex justify-center px-3">
            <p className="rounded-lg bg-black/70 px-3 py-1.5 text-xs text-white">
              {geoLoading
                ? 'Obteniendo GPS…'
                : `GPS: ${geoError}`}
            </p>
          </div>
        )}
      </div>

      {error && (
        <p className="mb-2 text-sm text-[var(--danger)]">{error}</p>
      )}
      {message && (
        <p className="mb-2 text-sm text-emerald-400">{message}</p>
      )}

      <button
        type="button"
        onClick={addPole}
        disabled={!ready || !coords}
        className="w-full rounded-xl bg-[var(--accent)] py-5 text-base font-semibold text-white disabled:opacity-50"
      >
        Añadir {next.name}
      </button>

      <p className="mt-2 text-center text-xs text-[var(--text-muted)]">
        {poles.length} poste{poles.length === 1 ? '' : 's'} en el mapa
      </p>
    </div>
  )
}
