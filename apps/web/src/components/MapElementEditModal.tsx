import { useEffect, useState, type FormEvent } from 'react'
import { useNotify } from './NotifyProvider'
import {
  DEFAULT_FIBER_COLOR_NORM,
  DEFAULT_ZONE_COLOR,
  FIBERS_PER_TUBE_OPTIONS,
  FIBER_COLOR_NORMS,
  FIBER_COLOR_PALETTE,
  MAX_CABLE_FIBERS,
  MAX_FIBERS_PER_TUBE,
  MAX_TUBES,
  SPLITTER_RATIOS,
  STANDARD_FIBER_COUNTS,
  ZONE_COLOR_PRESETS,
  appendFiberToTube,
  appendMiniTube,
  applyNormColorsToTubes,
  buildCableTubes,
  cableFibers,
  cableTubes,
  clampFiberCount,
  clampFibersPerTube,
  colorCodeAt,
  createDropFibers,
  createMiniTubes,
  createMufaTrays,
  createNapSplitter,
  dropClientId,
  findNapForDrop,
  formatPathLength,
  getFiberColorNorm,
  isFiberColorNormId,
  mapElementHasIcon,
  mapElementLabel,
  pathLengthMeters,
  resizeMufaTrays,
  strandBackground,
  type FiberColorNormId,
  type FiberStrand,
  type MapDraftElement,
  type MapElementType,
  type MiniTube,
  type MufaTray,
  type NapSplitter,
  type SplitterRatio,
} from '../lib/map-elements'
import type { NetworkMapClientMarker } from '../lib/network-map'
import { GoogleMapsCoords } from './GoogleMapsCoords'
import { MapElementTypeIcon } from './MapElementTypeIcon'

const inputClass =
  'w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm outline-none ring-[var(--accent)] focus:ring-2'

/**
 * Modal genérica de elemento del mapa.
 * Cables: minitubos + pelos. Mufa: bandejas + cables entrantes.
 */
export function MapElementEditModal({
  open,
  element,
  type,
  isNew = false,
  allDrafts = [],
  clients = [],
  onClose,
  onSave,
  onDelete,
  onTraceRoute,
}: {
  open: boolean
  element: MapDraftElement | null
  type: MapElementType
  isNew?: boolean
  allDrafts?: MapDraftElement[]
  clients?: NetworkMapClientMarker[]
  onClose: () => void
  onSave: (next: MapDraftElement) => void
  onDelete: (id: string) => void
  onTraceRoute?: (element: MapDraftElement) => void
}) {
  const { confirm } = useNotify()
  const [name, setName] = useState('')
  const [notes, setNotes] = useState('')
  const [tubes, setTubes] = useState<MiniTube[]>([])
  const [fibersPerTube, setFibersPerTube] = useState(12)
  const [colorNorm, setColorNorm] = useState<FiberColorNormId>(
    DEFAULT_FIBER_COLOR_NORM,
  )
  const [trays, setTrays] = useState<MufaTray[]>([])
  const [trayCount, setTrayCount] = useState(4)
  const [cableIds, setCableIds] = useState<string[]>([])
  const [splitters, setSplitters] = useState<NapSplitter[]>([])
  const [dropFiberCount, setDropFiberCount] = useState<1 | 2>(1)
  const [dropFibers, setDropFibers] = useState<FiberStrand[]>([])
  const [dropClient, setDropClient] = useState('')
  const [zoneColor, setZoneColor] = useState(DEFAULT_ZONE_COLOR)
  const [error, setError] = useState<string | null>(null)

  const elementType = element?.type ?? type
  const typeLabel = mapElementLabel[elementType]
  const isCable = elementType === 'cable'
  const isDrop = elementType === 'drop'
  const isMufa = elementType === 'mufa'
  const isNap = elementType === 'nap'
  const isZone = elementType === 'zone'
  const isEnclosure = isMufa || isNap
  const pathLen = element?.path?.length ?? 0
  const showIcon = mapElementHasIcon(elementType)
  const availableCables = allDrafts.filter(
    (d) =>
      (d.type === 'cable' || d.type === 'drop') && d.id !== element?.id,
  )
  const totalFibers = tubes.reduce((n, t) => n + t.fibers.length, 0)
  const tubeCount = tubes.length
  const activeNorm = getFiberColorNorm(colorNorm)

  useEffect(() => {
    if (!open) return
    setName(element?.name ?? '')
    setNotes(element?.notes ?? '')
    if (isCable) {
      const existing = cableTubes(element)
      const next = existing.length > 0 ? existing : createMiniTubes(1, 12)
      setTubes(next)
      setFibersPerTube(next[0]?.fibers.length || 12)
      setColorNorm(
        isFiberColorNormId(String(element?.colorNorm ?? ''))
          ? (element!.colorNorm as FiberColorNormId)
          : DEFAULT_FIBER_COLOR_NORM,
      )
    } else {
      setTubes([])
      setFibersPerTube(12)
      setColorNorm(DEFAULT_FIBER_COLOR_NORM)
    }
    if (isDrop) {
      const existing = element?.fibers?.length
        ? element.fibers.slice(0, 2)
        : createDropFibers(1)
      setDropFibers(existing)
      setDropFiberCount(existing.length >= 2 ? 2 : 1)
      setDropClient(dropClientId(element) ?? '')
    } else {
      setDropFibers([])
      setDropFiberCount(1)
      setDropClient('')
    }
    if (isEnclosure) {
      const existingTrays = element?.trays?.length
        ? element.trays
        : createMufaTrays(isNap ? 2 : 4)
      setTrays(existingTrays)
      setTrayCount(existingTrays.length)
      setCableIds(element?.cableIds ?? [])
      setSplitters(
        isNap
          ? element?.splitters?.length
            ? element.splitters
            : [createNapSplitter(8)]
          : [],
      )
    } else {
      setTrays([])
      setTrayCount(4)
      setCableIds([])
      setSplitters([])
    }
    if (isZone) {
      const c = element?.color
      setZoneColor(
        typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c)
          ? c
          : DEFAULT_ZONE_COLOR,
      )
    } else {
      setZoneColor(DEFAULT_ZONE_COLOR)
    }
    setError(null)
  }, [open, element, isCable, isDrop, isEnclosure, isNap, isZone])

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open || !element) return null

  function applyCapacity(total: number, perTube = fibersPerTube) {
    const nextTotal = clampFiberCount(total)
    const nextPer = Math.min(clampFibersPerTube(perTube), nextTotal)
    setFibersPerTube(nextPer)
    setTubes(buildCableTubes(nextTotal, nextPer, colorNorm))
  }

  function changeColorNorm(next: FiberColorNormId) {
    setColorNorm(next)
    setTubes((prev) => applyNormColorsToTubes(prev, next))
  }

  function resetNormColors() {
    setTubes((prev) => applyNormColorsToTubes(prev, colorNorm))
  }

  function addTube() {
    setTubes((prev) => {
      if (prev.length >= MAX_TUBES) return prev
      return appendMiniTube(
        prev,
        Math.min(fibersPerTube, MAX_FIBERS_PER_TUBE),
        colorNorm,
      )
    })
  }

  async function removeTube(tube: MiniTube) {
    if (tubes.length <= 1) {
      setError('Debe quedar al menos 1 minitubo.')
      return
    }
    const ok = await confirm(
      `¿Eliminar «${tube.name}» y sus ${tube.fibers.length} pelo${tube.fibers.length === 1 ? '' : 's'}?`,
      {
        title: 'Eliminar minitubo',
        danger: true,
        confirmLabel: 'Eliminar',
      },
    )
    if (!ok) return
    setTubes((prev) => prev.filter((t) => t.id !== tube.id))
    setError(null)
  }

  function addFiber(tubeId: string) {
    setTubes((prev) =>
      prev.map((t) => {
        if (t.id !== tubeId) return t
        if (t.fibers.length >= MAX_FIBERS_PER_TUBE) return t
        return appendFiberToTube(t, colorNorm)
      }),
    )
  }

  async function removeFiber(tube: MiniTube, fiber: FiberStrand) {
    if (tube.fibers.length <= 1) {
      setError('Cada minitubo debe tener al menos 1 pelo.')
      return
    }
    const ok = await confirm(`¿Eliminar «${fiber.name}»?`, {
      title: 'Eliminar pelo',
      danger: true,
      confirmLabel: 'Eliminar',
    })
    if (!ok) return
    setTubes((prev) =>
      prev.map((t) =>
        t.id !== tube.id
          ? t
          : {
              ...t,
              fibers: t.fibers
                .filter((f) => f.id !== fiber.id)
                .map((f, i) => {
                  const code = colorCodeAt(i, false, colorNorm)
                  const looksNorm = /^Pelo \d+/.test(f.name)
                  return looksNorm
                    ? {
                        ...f,
                        name: `Pelo ${i + 1} · ${code.name}`,
                      }
                    : f
                }),
            },
      ),
    )
    setError(null)
  }

  function applyTrayCount(n: number) {
    const next = Math.max(1, Math.min(48, n || 1))
    setTrayCount(next)
    setTrays((prev) => resizeMufaTrays(prev, next))
  }

  function patchTube(id: string, partial: Partial<MiniTube>) {
    setTubes((prev) =>
      prev.map((t) => (t.id === id ? { ...t, ...partial } : t)),
    )
  }

  function patchFiber(
    tubeId: string,
    fiberId: string,
    partial: Partial<FiberStrand>,
  ) {
    setTubes((prev) =>
      prev.map((t) =>
        t.id !== tubeId
          ? t
          : {
              ...t,
              fibers: t.fibers.map((f) =>
                f.id === fiberId ? { ...f, ...partial } : f,
              ),
            },
      ),
    )
  }

  function toggleCable(id: string) {
    setCableIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    )
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!element) return
    const trimmed = name.trim()
    if (trimmed.length < 2) {
      setError('Ponle un nombre (mínimo 2 caracteres).')
      return
    }
    if (isCable && (tubes.length < 1 || totalFibers < 1)) {
      setError('Define al menos 1 minitubo con pelos.')
      return
    }
    if (isDrop && dropFibers.length < 1) {
      setError('El drop necesita 1 o 2 pelos.')
      return
    }
    const trayIds = new Set(trays.map((t) => t.id))
    onSave({
      ...element,
      type: elementType,
      name: trimmed,
      notes: notes.trim(),
      ...(isCable
        ? {
            tubes,
            colorNorm,
            fibers: undefined,
            trays: undefined,
            cableIds: undefined,
            connections: undefined,
            splitters: undefined,
          }
        : {}),
      ...(isDrop
        ? {
            fibers: dropFibers.slice(0, dropFiberCount),
            tubes: undefined,
            colorNorm: undefined,
            trays: undefined,
            cableIds: undefined,
            connections: undefined,
            splitters: undefined,
            clientId: dropClient || null,
            path: (() => {
              const path = [...(element.path ?? [])]
              const client = clients.find((c) => c.id === dropClient)
              if (!dropClient) {
                // Quitar anclajes a cliente del path
                return path.map((v) =>
                  v.clientId ? { ...v, clientId: null } : v,
                )
              }
              if (!client) return path
              const tip = path[path.length - 1]
              if (tip?.clientId === dropClient) {
                return path.map((v, i) =>
                  i === path.length - 1
                    ? {
                        ...v,
                        lat: client.lat,
                        lng: client.lng,
                        clientId: dropClient,
                      }
                    : v,
                )
              }
              // Sustituir cliente previo o añadir extremo
              const withoutOld = path.filter((v) => !v.clientId)
              withoutOld.push({
                lat: client.lat,
                lng: client.lng,
                clientId: dropClient,
              })
              return withoutOld.length
                ? withoutOld
                : [
                    {
                      lat: element.lat,
                      lng: element.lng,
                    },
                    {
                      lat: client.lat,
                      lng: client.lng,
                      clientId: dropClient,
                    },
                  ]
            })(),
          }
        : {}),
      ...(isZone
        ? {
            color: zoneColor,
            path: element?.path ?? [],
            tubes: undefined,
            fibers: undefined,
            colorNorm: undefined,
            trays: undefined,
            cableIds: undefined,
            connections: undefined,
            splitters: undefined,
          }
        : {}),
      ...(isEnclosure
        ? {
            trays,
            cableIds,
            connections: (element.connections ?? []).filter((c) =>
              trayIds.has(c.trayId),
            ),
            fibers: undefined,
            tubes: undefined,
            colorNorm: undefined,
            path: undefined,
            ...(isNap ? { splitters } : { splitters: undefined }),
          }
        : {}),
      ...(!isCable && !isDrop && !isEnclosure && !isZone
        ? {
            fibers: undefined,
            tubes: undefined,
            colorNorm: undefined,
            trays: undefined,
            cableIds: undefined,
            connections: undefined,
            splitters: undefined,
            path: undefined,
          }
        : {}),
    })
  }

  async function remove() {
    if (!element) return
    const ok = await confirm(
      `¿Eliminar «${element.name || typeLabel}» del mapa? Esta acción no se puede deshacer.`,
      {
        title: `Eliminar ${typeLabel.toLowerCase()}`,
        danger: true,
        confirmLabel: 'Eliminar',
      },
    )
    if (ok) onDelete(element.id)
  }

  return (
    <div className="fixed inset-0 z-[600] flex items-start justify-center overflow-y-auto bg-black/60 p-3 sm:items-center sm:p-4">
      <div
        role="dialog"
        aria-modal="true"
        className={`flex max-h-[min(92vh,100dvh)] w-full flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] shadow-xl ${
          isCable || isDrop || isEnclosure ? 'max-w-xl' : 'max-w-md'
        }`}
      >
          <div className="flex shrink-0 items-center justify-between border-b border-[var(--border)] px-5 py-4">
          <div className="flex items-center gap-3">
            {showIcon && <MapElementTypeIcon type={elementType} size={36} />}
            {isZone && (
              <span
                className="inline-flex h-9 w-9 shrink-0 rounded-md border border-white/20"
                style={{ background: zoneColor }}
                aria-hidden
              />
            )}
            <div>
              <h2 className="text-lg font-semibold">
                {isNew
                  ? `Nuevo ${typeLabel.toLowerCase()}`
                  : `Editar ${typeLabel.toLowerCase()}`}
              </h2>
              <p className="text-xs text-[var(--text-muted)]">
                {isCable
                  ? 'Cable de fibra · minitubos y pelos con colores'
                  : isDrop
                    ? 'Drop · 1 o 2 pelos hacia cliente / splitter'
                    : isZone
                      ? 'Zona · perímetro en el mapa con nombre y color'
                      : isNap
                        ? 'NAP · bandejas, splitters y clientes'
                        : isMufa
                          ? 'Cierre de empalme · bandejas y cables entrantes'
                          : typeLabel}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2 py-1 text-[var(--text-muted)] hover:bg-[var(--bg)]"
          >
            ✕
          </button>
        </div>

        <form
          onSubmit={submit}
          className="flex min-h-0 flex-1 flex-col overflow-hidden"
        >
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <label className="block text-sm">
            <span className="mb-1 block text-[var(--text-muted)]">Nombre</span>
            <input
              className={inputClass}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={typeLabel}
              autoFocus
            />
          </label>

          <label className="block text-sm">
            <span className="mb-1 block text-[var(--text-muted)]">
              {isZone ? 'Descripción' : 'Notas'}
            </span>
            <textarea
              className={inputClass}
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={
                isZone
                  ? 'Área de cobertura, sector, observaciones…'
                  : 'Detalles para el técnico en campo'
              }
            />
            {isZone && (
              <span className="mt-1 block text-[11px] text-[var(--text-muted)]">
                Nombre y descripción se guardan también en Ajustes → Zonas.
              </span>
            )}
          </label>

          {isZone && (
            <div className="space-y-3 rounded-lg border border-[var(--border)] bg-[var(--bg)] p-3">
              <label className="block text-sm">
                <span className="mb-1 block text-[var(--text-muted)]">
                  Color de la zona
                </span>
                <div className="flex flex-wrap items-center gap-2">
                  {ZONE_COLOR_PRESETS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      title={c}
                      onClick={() => setZoneColor(c)}
                      className={`h-8 w-8 rounded-md border-2 transition ${
                        zoneColor === c
                          ? 'border-white scale-110'
                          : 'border-transparent opacity-80 hover:opacity-100'
                      }`}
                      style={{ background: c }}
                    />
                  ))}
                  <input
                    type="color"
                    value={zoneColor}
                    onChange={(e) => setZoneColor(e.target.value)}
                    className="h-8 w-10 cursor-pointer rounded border border-[var(--border)] bg-transparent p-0.5"
                    title="Color personalizado"
                  />
                </div>
              </label>
            </div>
          )}

          {isEnclosure && (
            <div className="space-y-3 rounded-lg border border-[var(--border)] bg-[var(--bg)] p-3">
              <div className="flex flex-wrap items-end gap-3">
                <label className="block text-sm">
                  <span className="mb-1 block text-[var(--text-muted)]">
                    Cantidad de bandejas
                  </span>
                  <input
                    type="number"
                    min={1}
                    max={48}
                    className={`${inputClass} w-28`}
                    value={trayCount}
                    onChange={(e) => applyTrayCount(Number(e.target.value))}
                  />
                </label>
                <div className="flex flex-wrap gap-1 pb-1">
                  {[2, 4, 6, 8, 12].map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => applyTrayCount(n)}
                      className={[
                        'rounded-md px-2 py-1 text-[11px] font-medium',
                        trayCount === n
                          ? 'bg-[var(--accent)] text-white'
                          : 'border border-[var(--border)] hover:bg-[var(--bg-elevated)]',
                      ].join(' ')}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {trays.map((t, i) => (
                  <div
                    key={t.id}
                    className="flex h-16 w-20 flex-col items-center justify-center rounded-md border-2 border-[var(--border)] bg-[var(--bg-elevated)]"
                    style={{
                      boxShadow: `inset 0 -6px 0 ${colorCodeAt(i, true).color}55`,
                    }}
                  >
                    <span className="text-[10px] font-semibold text-[var(--text-muted)]">
                      B{i + 1}
                    </span>
                    <input
                      className="w-[90%] bg-transparent text-center text-[11px] outline-none"
                      value={t.name}
                      onChange={(e) =>
                        setTrays((prev) =>
                          prev.map((x) =>
                            x.id === t.id
                              ? { ...x, name: e.target.value }
                              : x,
                          ),
                        )
                      }
                    />
                  </div>
                ))}
              </div>

              <div>
                <span className="mb-1.5 block text-xs text-[var(--text-muted)]">
                  Cables que entran (además de los enganchados en el mapa)
                </span>
                {availableCables.length === 0 ? (
                  <p className="text-[11px] text-[var(--text-muted)]">
                    Aún no hay cables. Créalos y trázalos hasta esta mufa.
                  </p>
                ) : (
                  <ul className="max-h-36 space-y-1 overflow-y-auto">
                    {availableCables.map((c) => {
                      const checked = cableIds.includes(c.id)
                      const tubesOf = cableTubes(c)
                      return (
                        <li key={c.id}>
                          <label className="flex cursor-pointer items-center gap-2 rounded-md border border-[var(--border)] px-2.5 py-2 text-sm hover:bg-[var(--bg-elevated)]">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleCable(c.id)}
                            />
                            <span className="min-w-0 flex-1 truncate font-medium">
                              {c.name ||
                                (c.type === 'drop' ? 'Drop' : 'Cable')}
                            </span>
                            <span className="inline-flex gap-0.5">
                              {tubesOf.slice(0, 6).map((t) => (
                                <span
                                  key={t.id}
                                  className="inline-block h-3 w-3 rounded-full border border-black/20"
                                  style={{
                                    background: strandBackground(
                                      t.color,
                                      t.tracer,
                                    ),
                                  }}
                                  title={t.name}
                                />
                              ))}
                            </span>
                            <span className="text-[11px] text-[var(--text-muted)]">
                              {tubesOf.length}t · {cableFibers(c).length}p
                            </span>
                          </label>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>

              {isNap && (
                <div className="space-y-2 border-t border-[var(--border)] pt-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-semibold text-[var(--text-muted)] uppercase">
                      Splitters
                    </span>
                    {SPLITTER_RATIOS.map((r) => (
                      <button
                        key={r}
                        type="button"
                        onClick={() =>
                          setSplitters((prev) => [
                            ...prev,
                            createNapSplitter(r as SplitterRatio),
                          ])
                        }
                        className="rounded-md border border-[var(--border)] px-2 py-0.5 text-[11px] hover:bg-[var(--bg-elevated)]"
                      >
                        + 1:{r}
                      </button>
                    ))}
                  </div>
                  <ul className="space-y-1.5">
                    {splitters.map((s) => (
                      <li
                        key={s.id}
                        className="flex items-center gap-2 rounded-md border border-cyan-500/40 bg-[var(--bg-elevated)] px-2.5 py-2 text-sm"
                      >
                        <input
                          className="min-w-0 flex-1 bg-transparent outline-none"
                          value={s.name}
                          onChange={(e) =>
                            setSplitters((prev) =>
                              prev.map((x) =>
                                x.id === s.id
                                  ? { ...x, name: e.target.value }
                                  : x,
                              ),
                            )
                          }
                        />
                        <span className="text-[11px] text-cyan-300">
                          1:{s.ratio}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            setSplitters((prev) =>
                              prev.filter((x) => x.id !== s.id),
                            )
                          }
                          className="text-[11px] text-red-300 hover:underline"
                        >
                          Quitar
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {isDrop && (
            <div className="space-y-3 rounded-lg border border-[var(--border)] bg-[var(--bg)] p-3">
              <span className="text-xs font-semibold text-[var(--text-muted)] uppercase">
                Conexiones del drop
              </span>
              {(() => {
                const nap = element
                  ? findNapForDrop(element, allDrafts)
                  : null
                return (
                  <p className="text-xs text-[var(--text-muted)]">
                    {nap
                      ? `NAP: ${nap.name || 'NAP'} (enganchada en la ruta)`
                      : 'Sin NAP aún: traza el drop hasta una NAP del mapa.'}
                  </p>
                )
              })()}
              <label className="block text-sm">
                <span className="mb-1 block text-[var(--text-muted)]">
                  Cliente
                </span>
                <select
                  className={inputClass}
                  value={dropClient}
                  onChange={(e) => setDropClient(e.target.value)}
                >
                  <option value="">— Sin cliente —</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                      {c.subtitle ? ` · ${c.subtitle}` : ''}
                    </option>
                  ))}
                </select>
                <span className="mt-1 block text-xs text-[var(--text-muted)]">
                  También puedes engancharlo en el mapa haciendo clic en el
                  cliente mientras trazas el drop.
                </span>
              </label>
              <span className="text-xs font-semibold text-[var(--text-muted)] uppercase">
                Pelos del drop
              </span>
              <div className="flex gap-2">
                {([1, 2] as const).map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => {
                      setDropFiberCount(n)
                      setDropFibers(createDropFibers(n))
                    }}
                    className={[
                      'rounded-md px-3 py-1.5 text-sm font-medium',
                      dropFiberCount === n
                        ? 'bg-[var(--accent)] text-white'
                        : 'border border-[var(--border)] hover:bg-[var(--bg-elevated)]',
                    ].join(' ')}
                  >
                    {n}F
                  </button>
                ))}
              </div>
              <ul className="space-y-1">
                {dropFibers.map((f) => (
                  <li
                    key={f.id}
                    className="flex items-center gap-2 rounded-md border border-[var(--border)] px-2 py-1.5 text-sm"
                  >
                    <span
                      className="h-3 w-3 rounded-full border border-black/20"
                      style={{
                        background: strandBackground(f.color, f.tracer),
                      }}
                    />
                    {f.name}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {isCable && (
            <div className="space-y-3 rounded-lg border border-[var(--border)] bg-[var(--bg)] p-3">
              <div className="space-y-2">
                <label className="block text-sm">
                  <span className="mb-1 block text-[var(--text-muted)]">
                    Norma de colores del cable
                  </span>
                  <select
                    className={inputClass}
                    value={colorNorm}
                    onChange={(e) =>
                      changeColorNorm(e.target.value as FiberColorNormId)
                    }
                  >
                    {FIBER_COLOR_NORMS.map((n) => (
                      <option key={n.id} value={n.id}>
                        {n.label} · {n.region}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] px-2.5 py-2">
                  <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[11px] text-[var(--text-muted)]">
                      Distribución {activeNorm.shortLabel} (1–12). Cada
                      minitubo repite esta secuencia.
                    </span>
                    <button
                      type="button"
                      onClick={resetNormColors}
                      className="shrink-0 rounded-md border border-[var(--border)] px-2 py-0.5 text-[11px] font-medium hover:bg-[var(--bg)]"
                    >
                      Aplicar norma
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {activeNorm.sequence.map((key, i) => {
                      const c = FIBER_COLOR_PALETTE[key]
                      return (
                        <span
                          key={`${key}-${i}`}
                          className="inline-flex items-center gap-1 rounded border border-black/15 px-1.5 py-0.5 text-[10px]"
                          title={`${i + 1}. ${c.name}`}
                        >
                          <span
                            className="inline-block h-3 w-3 rounded-full border border-black/20"
                            style={{ background: c.color }}
                          />
                          {i + 1}
                        </span>
                      )
                    })}
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex flex-wrap items-end justify-between gap-2">
                  <span className="block text-sm text-[var(--text-muted)]">
                    Capacidad del cable
                  </span>
                  <label className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
                    Otra
                    <input
                      type="number"
                      min={1}
                      max={MAX_CABLE_FIBERS}
                      className={`${inputClass} w-20 py-1 text-sm`}
                      value={totalFibers}
                      onChange={(e) =>
                        applyCapacity(Number(e.target.value) || 1)
                      }
                    />
                    <span>F</span>
                  </label>
                </div>
                <div className="flex flex-wrap gap-1">
                  {STANDARD_FIBER_COUNTS.map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => applyCapacity(n)}
                      className={[
                        'rounded-md px-2.5 py-1 text-xs font-medium',
                        totalFibers === n
                          ? 'bg-[var(--accent)] text-white'
                          : 'border border-[var(--border)] hover:bg-[var(--bg-elevated)]',
                      ].join(' ')}
                    >
                      {n}F
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <span className="block text-sm text-[var(--text-muted)]">
                  Pelos por minitubo
                </span>
                <div className="flex flex-wrap gap-1">
                  {FIBERS_PER_TUBE_OPTIONS.map((n) => (
                    <button
                      key={n}
                      type="button"
                      disabled={n > totalFibers && totalFibers > 0}
                      onClick={() => applyCapacity(totalFibers || n, n)}
                      className={[
                        'rounded-md px-2.5 py-1 text-xs font-medium disabled:opacity-40',
                        fibersPerTube === n
                          ? 'bg-[var(--accent)] text-white'
                          : 'border border-[var(--border)] hover:bg-[var(--bg-elevated)]',
                      ].join(' ')}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-[var(--bg-elevated)] px-2.5 py-2">
                <p className="text-[11px] text-[var(--text-muted)]">
                  {tubeCount} minitubo{tubeCount === 1 ? '' : 's'} ·{' '}
                  <strong>{totalFibers}F</strong> · {activeNorm.shortLabel}.
                  Colores editables; excepciones con + / ✕.
                </p>
                <button
                  type="button"
                  onClick={addTube}
                  disabled={tubes.length >= MAX_TUBES}
                  className="rounded-md border border-[var(--accent)]/40 bg-[var(--accent)]/10 px-2 py-1 text-[11px] font-medium text-[var(--accent)] hover:bg-[var(--accent)]/20 disabled:opacity-40"
                >
                  + Minitubo
                </button>
              </div>

              <ul className="space-y-3 pr-1">
                {tubes.map((tube, ti) => (
                  <li
                    key={tube.id}
                    className="rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] p-2.5"
                  >
                    <div className="mb-2 flex items-center gap-2">
                      <span
                        className="h-8 w-5 shrink-0 rounded-full border border-black/25 shadow-inner"
                        style={{
                          background: strandBackground(
                            tube.color,
                            tube.tracer,
                          ),
                        }}
                        title={tube.name}
                      />
                      <span className="w-6 shrink-0 text-[11px] text-[var(--text-muted)]">
                        T{ti + 1}
                      </span>
                      <input
                        type="color"
                        value={
                          /^#[0-9a-fA-F]{6}$/.test(tube.color)
                            ? tube.color
                            : colorCodeAt(ti, true, colorNorm).color
                        }
                        onChange={(e) =>
                          patchTube(tube.id, {
                            color: e.target.value,
                            tracer: null,
                          })
                        }
                        title="Color del minitubo"
                        className="h-8 w-9 shrink-0 cursor-pointer rounded border border-[var(--border)] bg-transparent p-0.5"
                      />
                      <input
                        className={`${inputClass} flex-1 py-1.5`}
                        value={tube.name}
                        onChange={(e) =>
                          patchTube(tube.id, { name: e.target.value })
                        }
                        placeholder="Nombre del minitubo"
                      />
                      <button
                        type="button"
                        onClick={() => void removeTube(tube)}
                        disabled={tubes.length <= 1}
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-red-300 hover:bg-red-500/15 disabled:opacity-30"
                        title="Eliminar minitubo"
                        aria-label="Eliminar minitubo"
                      >
                        ✕
                      </button>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {tube.fibers.map((f, fi) => (
                        <div
                          key={f.id}
                          className="flex items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--bg)] px-1.5 py-1"
                          title={f.name}
                        >
                          <input
                            type="color"
                            value={
                              /^#[0-9a-fA-F]{6}$/.test(f.color)
                                ? f.color
                                : colorCodeAt(fi, false, colorNorm).color
                            }
                            onChange={(e) =>
                              patchFiber(tube.id, f.id, {
                                color: e.target.value,
                                tracer: null,
                                name: `Pelo ${fi + 1}`,
                              })
                            }
                            title={`Color del pelo ${fi + 1} (norma: ${colorCodeAt(fi, false, colorNorm).name})`}
                            className="h-5 w-5 cursor-pointer rounded-full border border-black/20 bg-transparent p-0"
                          />
                          <span className="text-[10px] text-[var(--text-muted)]">
                            {fi + 1}
                          </span>
                          <input
                            className="w-16 bg-transparent text-[10px] outline-none"
                            value={f.description}
                            onChange={(e) =>
                              patchFiber(tube.id, f.id, {
                                description: e.target.value,
                              })
                            }
                            placeholder="uso…"
                          />
                          <button
                            type="button"
                            onClick={() => void removeFiber(tube, f)}
                            disabled={tube.fibers.length <= 1}
                            className="ml-0.5 flex h-4 w-4 items-center justify-center rounded text-[10px] text-red-300 hover:bg-red-500/15 disabled:opacity-30"
                            title="Eliminar pelo"
                            aria-label="Eliminar pelo"
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                      <button
                        type="button"
                        onClick={() => addFiber(tube.id)}
                        disabled={tube.fibers.length >= MAX_FIBERS_PER_TUBE}
                        className="rounded-md border border-dashed border-[var(--border)] px-2 py-1 text-[11px] text-[var(--accent)] hover:bg-[var(--accent)]/10 disabled:opacity-40"
                      >
                        + Pelo
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {isCable || isDrop ? (
            <div className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5">
              <span className="mb-1 block text-xs text-[var(--text-muted)]">
                Ruta del cable
              </span>
              <p className="text-sm">
                {pathLen >= 2
                  ? `${formatPathLength(pathLengthMeters(element?.path))} · ${pathLen} puntos`
                  : pathLen === 1
                    ? '1 punto · traza más vértices o engancha postes / mufas'
                    : 'Sin ruta todavía'}
              </p>
              <p className="mt-1.5 text-[11px] text-[var(--text-muted)]">
                {isDrop
                  ? 'En el mapa se ve una línea gris. Engancha mufas o NAP y conéctalo a puertos de splitter.'
                  : 'En el mapa se ve una línea negra. Los minitubos y pelos se gestionan aquí y en la mufa/NAP.'}
              </p>
              {!isNew && onTraceRoute && (
                <button
                  type="button"
                  onClick={() =>
                    onTraceRoute({
                      ...element,
                      name: name.trim() || element.name,
                      notes: notes.trim(),
                      tubes,
                      colorNorm,
                      fibers: undefined,
                    })
                  }
                  className="mt-2 w-full rounded-lg border border-[var(--accent)]/50 bg-[var(--accent)]/10 px-3 py-2 text-sm font-medium text-[var(--accent)] hover:bg-[var(--accent)]/20"
                >
                  {pathLen >= 2 ? 'Seguir / editar ruta' : 'Trazar ruta'}
                </button>
              )}
            </div>
          ) : isZone ? (
            <div className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5">
              <span className="mb-1 block text-xs text-[var(--text-muted)]">
                Perímetro
              </span>
              <p className="text-sm">
                {pathLen >= 3
                  ? `${pathLen} vértices · polígono cerrado`
                  : pathLen > 0
                    ? `${pathLen} punto(s) · faltan al menos ${Math.max(0, 3 - pathLen)}`
                    : 'Sin perímetro todavía'}
              </p>
              <p className="mt-1.5 text-[11px] text-[var(--text-muted)]">
                En el mapa se ve el área sombreada con el color elegido.
              </p>
              {onTraceRoute && (
                <button
                  type="button"
                  onClick={() =>
                    onTraceRoute({
                      ...element,
                      name: name.trim() || element.name,
                      notes: notes.trim(),
                      color: zoneColor,
                      path: element.path ?? [],
                    })
                  }
                  className="mt-2 w-full rounded-lg border border-[var(--accent)]/50 bg-[var(--accent)]/10 px-3 py-2 text-sm font-medium text-[var(--accent)] hover:bg-[var(--accent)]/20"
                >
                  {pathLen >= 3 ? 'Editar perímetro' : 'Dibujar perímetro'}
                </button>
              )}
            </div>
          ) : (
            <div className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5">
              <span className="mb-1 block text-xs text-[var(--text-muted)]">
                Ubicación
              </span>
              <GoogleMapsCoords
                layout="inline"
                lat={element.lat}
                lng={element.lng}
              />
              <p className="mt-1.5 text-[11px] text-[var(--text-muted)]">
                {isMufa
                  ? 'Al hacer clic en la mufa en el mapa se abre la vista gráfica de bandejas.'
                  : 'Arrastra el elemento en el mapa para cambiar la posición.'}
              </p>
            </div>
          )}

          {error && <p className="text-sm text-[var(--danger)]">{error}</p>}
          </div>

          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-[var(--border)] px-5 py-3">
            {!isNew && (
              <button
                type="button"
                onClick={() => void remove()}
                className="mr-auto rounded-lg border border-red-500/40 px-3 py-2 text-sm text-red-300 hover:bg-red-500/10"
              >
                Eliminar
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)]"
            >
              Guardar
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
