import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'
import {
  formatPathLength,
  haversineMeters,
  mapElementLabel,
  type MapDraftElement,
} from '../lib/map-elements'
import { googleMapsNavUrl } from '../lib/maps'
import type { NetworkMapLocations } from '../lib/network-map'
import { MapElementTypeIcon } from '../components/MapElementTypeIcon'
import { MapElementEditModal } from '../components/MapElementEditModal'
import { NapViewModal } from '../components/NapViewModal'
import { MufaViewModal } from '../components/MufaViewModal'
import {
  useGeolocationCoords,
  useMobileMapDrafts,
} from './useMobileMapDrafts'

export function MobileNetworkMapTechPage() {
  const { coords, error: geoError, loading: geoLoading } =
    useGeolocationCoords()
  const {
    drafts,
    ready,
    updateEnclosure,
    saveElement,
    deleteElement,
  } = useMobileMapDrafts()
  const [search, setSearch] = useState('')
  const [viewing, setViewing] = useState<MapDraftElement | null>(null)
  const [editing, setEditing] = useState<MapDraftElement | null>(null)

  const locationsQuery = useQuery({
    queryKey: ['app', 'network-map', 'locations'],
    queryFn: () =>
      apiFetch<NetworkMapLocations>('/app/network-map/locations'),
    staleTime: 60_000,
  })

  const items = useMemo(() => {
    const q = search.trim().toLowerCase()
    const list = drafts.filter(
      (d) =>
        (d.type === 'nap' || d.type === 'mufa') &&
        Number.isFinite(d.lat) &&
        Number.isFinite(d.lng) &&
        (!q ||
          (d.name || '').toLowerCase().includes(q) ||
          (d.notes || '').toLowerCase().includes(q) ||
          mapElementLabel[d.type].toLowerCase().includes(q)),
    )
    return list
      .map((d) => ({
        el: d,
        distanceM:
          coords != null
            ? haversineMeters(coords, { lat: d.lat, lng: d.lng })
            : null,
      }))
      .sort((a, b) => {
        if (a.distanceM == null && b.distanceM == null) {
          return (a.el.name || '').localeCompare(b.el.name || '')
        }
        if (a.distanceM == null) return 1
        if (b.distanceM == null) return -1
        return a.distanceM - b.distanceM
      })
  }, [drafts, search, coords])

  const liveViewing = viewing
    ? (drafts.find((d) => d.id === viewing.id) ?? viewing)
    : null

  return (
    <div className="flex flex-1 flex-col">
      <div className="mb-4 flex items-center gap-3">
        <Link
          to="/movil/mapa-red"
          className="rounded-xl border border-[var(--border)] px-3 py-2 text-sm text-[var(--text-muted)]"
        >
          ←
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold tracking-tight">Técnico</h1>
          <p className="text-xs text-[var(--text-muted)]">
            NAP y mufas · más cercanas primero
          </p>
        </div>
        <Link
          to="/movil/mapa-red/mapa"
          className="shrink-0 rounded-xl bg-[var(--accent)] px-3.5 py-2.5 text-sm font-semibold text-white"
        >
          Mapa
        </Link>
      </div>

      <label className="mb-3 block">
        <span className="sr-only">Buscar</span>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar NAP o mufa…"
          className="w-full rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-3 text-base outline-none ring-[var(--accent)] focus:ring-2"
        />
      </label>

      {geoLoading && (
        <p className="mb-2 text-xs text-[var(--text-muted)]">
          Obteniendo GPS…
        </p>
      )}
      {geoError && (
        <p className="mb-2 text-xs text-amber-400">
          GPS: {geoError}. Se listan sin orden por distancia.
        </p>
      )}
      {coords && (
        <p className="mb-3 text-xs text-[var(--text-muted)]">
          Tu posición: {coords.lat.toFixed(5)}, {coords.lng.toFixed(5)}
        </p>
      )}

      {!ready ? (
        <p className="text-sm text-[var(--text-muted)]">Cargando…</p>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[var(--border)] px-4 py-10 text-center text-sm text-[var(--text-muted)]">
          No hay NAP ni mufas en el mapa de esta empresa.
          <p className="mt-2 text-xs">
            Créalas en la vista web del Mapa de red.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {items.map(({ el, distanceM }) => (
            <li
              key={el.id}
              className="rounded-2xl border border-[var(--border)] bg-[var(--bg-elevated)] p-3"
            >
              <div className="flex items-start gap-3">
                <MapElementTypeIcon type={el.type} size={40} />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold leading-tight">
                    {el.name || mapElementLabel[el.type]}
                  </p>
                  <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                    {mapElementLabel[el.type]}
                    {distanceM != null
                      ? ` · ${formatPathLength(distanceM)}`
                      : ''}
                  </p>
                  {el.notes ? (
                    <p className="mt-1 line-clamp-2 text-xs text-[var(--text-muted)]">
                      {el.notes}
                    </p>
                  ) : null}
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <a
                  href={googleMapsNavUrl(el.lat, el.lng)}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-center rounded-xl bg-[var(--accent)] py-2.5 text-sm font-semibold text-white"
                >
                  Ir
                </a>
                <button
                  type="button"
                  onClick={() => setViewing(el)}
                  className="rounded-xl border border-[var(--border)] py-2.5 text-sm font-semibold"
                >
                  Ver
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <NapViewModal
        open={!!liveViewing && liveViewing.type === 'nap'}
        nap={liveViewing?.type === 'nap' ? liveViewing : null}
        drafts={drafts}
        clients={locationsQuery.data?.clients ?? []}
        mobile
        onClose={() => setViewing(null)}
        onChange={updateEnclosure}
        onEdit={(n) => {
          setViewing(null)
          setEditing(n)
        }}
      />

      <MufaViewModal
        open={!!liveViewing && liveViewing.type === 'mufa'}
        mufa={liveViewing?.type === 'mufa' ? liveViewing : null}
        drafts={drafts}
        mobile
        onClose={() => setViewing(null)}
        onChange={updateEnclosure}
        onEdit={(m) => {
          setViewing(null)
          setEditing(m)
        }}
      />

      <MapElementEditModal
        open={!!editing}
        element={editing}
        type={editing?.type ?? 'nap'}
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
