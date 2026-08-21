import { useEffect, useMemo, useState } from 'react'
import {
  cableTubes,
  cablesEnteringNap,
  createNapSplitter,
  createMufaTrays,
  findFiberInCable,
  strandBackground,
  SPLITTER_RATIOS,
  type MapDraftElement,
  type NapSplitter,
  type SplitterRatio,
} from '../lib/map-elements'
import type { NetworkMapClientMarker } from '../lib/network-map'
import { MapElementTypeIcon } from './MapElementTypeIcon'
import { MufaViewModal } from './MufaViewModal'
import { ModalPortal } from './ModalPortal'

type PortPick = {
  splitterId: string
  portIndex: number
}

/**
 * Vista NAP:
 * - Conexiones → bandejas / fusiones (igual que mufa)
 * - Clientes → splitters con puertos clicables → modal para asignar cliente
 */
export function NapViewModal({
  open,
  nap,
  drafts,
  clients,
  onClose,
  onChange,
  onEdit,
  mobile = false,
}: {
  open: boolean
  nap: MapDraftElement | null
  drafts: MapDraftElement[]
  clients: NetworkMapClientMarker[]
  onClose: () => void
  onChange: (next: MapDraftElement) => void
  onEdit?: (nap: MapDraftElement) => void
  /** Pantalla completa / layout táctil (vista móvil). */
  mobile?: boolean
}) {
  const [tab, setTab] = useState<'connections' | 'clients'>('connections')
  const [portPick, setPortPick] = useState<PortPick | null>(null)
  const [draftClientId, setDraftClientId] = useState('')
  const [draftDropKey, setDraftDropKey] = useState('')

  const live = nap
    ? (drafts.find((d) => d.id === nap.id) ?? nap)
    : null

  const cables = useMemo(
    () => (live ? cablesEnteringNap(live, drafts) : []),
    [live, drafts],
  )
  const drops = useMemo(
    () => cables.filter((c) => c.type === 'drop'),
    [cables],
  )
  const splitters = live?.splitters?.length
    ? live.splitters
    : [createNapSplitter(8)]

  useEffect(() => {
    if (!open) {
      setTab('connections')
      setPortPick(null)
    }
  }, [open, nap?.id])

  useEffect(() => {
    if (!portPick || !live) return
    const s = splitters.find((x) => x.id === portPick.splitterId)
    const p = s?.ports.find((x) => x.index === portPick.portIndex)
    setDraftClientId(p?.clientId ?? '')
    setDraftDropKey(
      p?.dropId
        ? `${p.dropId}:${p.fiberId ?? ''}`
        : '',
    )
  }, [portPick, live, splitters])

  if (!open || !live || live.type !== 'nap') return null

  function patch(next: Partial<MapDraftElement>) {
    onChange({
      ...live!,
      trays: live!.trays?.length ? live!.trays : createMufaTrays(2),
      cableIds: live!.cableIds ?? [],
      connections: live!.connections ?? [],
      splitters,
      ...next,
    })
  }

  function updateSplitter(id: string, fn: (s: NapSplitter) => NapSplitter) {
    patch({
      splitters: splitters.map((s) => (s.id === id ? fn(s) : s)),
    })
  }

  function addSplitter(ratio: SplitterRatio) {
    patch({ splitters: [...splitters, createNapSplitter(ratio)] })
  }

  function removeSplitter(id: string) {
    patch({ splitters: splitters.filter((s) => s.id !== id) })
  }

  function assignSplitterInput(
    splitterId: string,
    cableId: string | null,
    fiberId: string | null,
  ) {
    updateSplitter(splitterId, (s) => ({
      ...s,
      inputCableId: cableId,
      inputFiberId: fiberId,
    }))
  }

  function savePortAssignment() {
    if (!portPick) return
    const [dropId, fiberId] = draftDropKey
      ? draftDropKey.split(':')
      : [null, null]
    const prevPort = splitters
      .find((s) => s.id === portPick.splitterId)
      ?.ports.find((p) => p.index === portPick.portIndex)
    const prevDropId = prevPort?.dropId ?? null

    const nextSplitters = splitters.map((s) =>
      s.id === portPick.splitterId
        ? {
            ...s,
            ports: s.ports.map((p) =>
              p.index === portPick.portIndex
                ? {
                    ...p,
                    clientId: draftClientId || null,
                    dropId: dropId || null,
                    fiberId: fiberId || null,
                  }
                : p,
            ),
          }
        : s,
    )
    patch({ splitters: nextSplitters })

    // Vincular / desvincular drop ↔ cliente
    if (prevDropId && prevDropId !== dropId) {
      const prevDrop = drafts.find((d) => d.id === prevDropId)
      if (prevDrop?.type === 'drop') {
        onChange({ ...prevDrop, clientId: null })
      }
    }
    if (dropId) {
      const drop = drafts.find((d) => d.id === dropId)
      if (drop?.type === 'drop') {
        onChange({
          ...drop,
          clientId: draftClientId || null,
        })
      }
    }
    setPortPick(null)
  }

  function clearPortAssignment() {
    if (!portPick) return
    const prevPort = splitters
      .find((s) => s.id === portPick.splitterId)
      ?.ports.find((p) => p.index === portPick.portIndex)
    const prevDropId = prevPort?.dropId ?? null

    patch({
      splitters: splitters.map((s) =>
        s.id === portPick.splitterId
          ? {
              ...s,
              ports: s.ports.map((p) =>
                p.index === portPick.portIndex
                  ? { ...p, clientId: null, dropId: null, fiberId: null }
                  : p,
              ),
            }
          : s,
      ),
    })
    if (prevDropId) {
      const prevDrop = drafts.find((d) => d.id === prevDropId)
      if (prevDrop?.type === 'drop') {
        onChange({ ...prevDrop, clientId: null })
      }
    }
    setPortPick(null)
  }

  const usedClientIds = new Set(
    splitters.flatMap((s) =>
      s.ports
        .filter(
          (p) =>
            !(
              portPick &&
              s.id === portPick.splitterId &&
              p.index === portPick.portIndex
            ),
        )
        .map((p) => p.clientId)
        .filter(Boolean),
    ) as string[],
  )

  const usedDropIds = new Set(
    splitters.flatMap((s) =>
      s.ports
        .filter(
          (p) =>
            !(
              portPick &&
              s.id === portPick.splitterId &&
              p.index === portPick.portIndex
            ),
        )
        .map((p) => p.dropId)
        .filter(Boolean),
    ) as string[],
  )

  const pickedSplitter = portPick
    ? splitters.find((s) => s.id === portPick.splitterId)
    : null
  const currentDropKeyDropId = draftDropKey
    ? draftDropKey.split(':')[0]
    : ''

  return (
    <>
      <ModalPortal><div
        className={[
          'modal-backdrop fixed inset-0 z-[600] flex overflow-hidden bg-black/60',
          mobile
            ? 'items-stretch p-0'
            : 'items-start justify-center p-3 sm:items-center sm:p-4',
        ].join(' ')}
      >
        <div
          role="dialog"
          aria-modal="true"
          className={[
            'flex w-full flex-col overflow-hidden border border-[var(--border)] bg-[var(--bg-elevated)] shadow-xl',
            mobile
              ? 'h-dvh max-h-dvh rounded-none'
              : 'max-h-[min(92vh,100dvh)] max-w-[min(100rem,95vw)] rounded-xl',
          ].join(' ')}
        >
          <div className="modal-safe-header flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3 sm:px-5">
            <div className="flex items-center gap-3">
              <MapElementTypeIcon type="nap" size={40} />
              <div>
                <h2 className="text-lg font-semibold">
                  {live.name || 'NAP'}
                </h2>
                <p className="text-xs text-[var(--text-muted)]">
                  Bandejas / fusiones · splitters y clientes
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex overflow-hidden rounded-lg border border-[var(--border)]">
                <button
                  type="button"
                  onClick={() => setTab('connections')}
                  className={[
                    'px-3 py-1.5 text-sm',
                    tab === 'connections'
                      ? 'bg-[var(--accent)] text-white'
                      : 'hover:bg-[var(--bg)]',
                  ].join(' ')}
                >
                  Conexiones
                </button>
                <button
                  type="button"
                  onClick={() => setTab('clients')}
                  className={[
                    'px-3 py-1.5 text-sm',
                    tab === 'clients'
                      ? 'bg-[var(--accent)] text-white'
                      : 'hover:bg-[var(--bg)]',
                  ].join(' ')}
                >
                  Clientes
                </button>
              </div>
              {onEdit && (
                <button
                  type="button"
                  onClick={() => onEdit(live)}
                  className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm hover:bg-[var(--bg)]"
                >
                  Editar
                </button>
              )}
              <button
                type="button"
                onClick={onClose}
                className="rounded-md px-2 py-1 text-[var(--text-muted)] hover:bg-[var(--bg)]"
              >
                ✕
              </button>
            </div>
          </div>

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {tab === 'connections' ? (
              <MufaViewModal
                open
                embedded
                mobile={mobile}
                mufa={live}
                drafts={drafts}
                onClose={() => undefined}
                onChange={onChange}
              />
            ) : (
              <div className="min-h-0 flex-1 space-y-4 overflow-auto p-3 pb-[max(0.75rem,var(--safe-bottom))] sm:p-4 sm:pb-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-semibold tracking-wide text-[var(--text-muted)] uppercase">
                    Splitters
                  </span>
                  {SPLITTER_RATIOS.map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => addSplitter(r)}
                      className="rounded-md border border-[var(--border)] px-2 py-1 text-xs hover:bg-[var(--bg)]"
                    >
                      + 1:{r}
                    </button>
                  ))}
                </div>

                <div className="grid gap-3 lg:grid-cols-2">
                  {splitters.map((s) => {
                    const input = s.inputFiberId
                      ? findFiberInCable(
                          cables.find((c) => c.id === s.inputCableId),
                          s.inputFiberId,
                        )
                      : null
                    return (
                      <div
                        key={s.id}
                        className="rounded-xl border-2 border-cyan-500/40 bg-[var(--bg)] p-3 shadow-sm"
                      >
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <div>
                            <div className="text-sm font-semibold">
                              {s.name}
                            </div>
                            <div className="text-[11px] text-[var(--text-muted)]">
                              1:{s.ratio} · clic en un puerto para asignar
                              cliente
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => removeSplitter(s.id)}
                            className="text-xs text-red-300 hover:underline"
                          >
                            Quitar
                          </button>
                        </div>

                        <label className="mb-2 block text-[11px] text-[var(--text-muted)]">
                          Entrada (pelo)
                          <select
                            className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] px-2 py-1.5 text-sm"
                            value={
                              s.inputCableId && s.inputFiberId
                                ? `${s.inputCableId}:${s.inputFiberId}`
                                : ''
                            }
                            onChange={(e) => {
                              const v = e.target.value
                              if (!v) {
                                assignSplitterInput(s.id, null, null)
                                return
                              }
                              const [cableId, fiberId] = v.split(':')
                              assignSplitterInput(s.id, cableId, fiberId)
                            }}
                          >
                            <option value="">Sin conectar</option>
                            {cables.flatMap((c) =>
                              cableTubes(c).flatMap((t) =>
                                t.fibers.map((f) => (
                                  <option
                                    key={`${c.id}:${f.id}`}
                                    value={`${c.id}:${f.id}`}
                                  >
                                    {(c.name ||
                                      (c.type === 'drop'
                                        ? 'Drop'
                                        : 'Cable')) + ` · ${f.name}`}
                                  </option>
                                )),
                              ),
                            )}
                          </select>
                        </label>
                        {input && (
                          <div className="mb-2 flex items-center gap-2 text-xs">
                            <span
                              className="h-3 w-3 rounded-full border border-black/20"
                              style={{
                                background: strandBackground(
                                  input.fiber.color,
                                  input.fiber.tracer,
                                ),
                              }}
                            />
                            Entrada conectada
                          </div>
                        )}

                        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 md:grid-cols-4">
                          {s.ports.map((p) => {
                            const client = p.clientId
                              ? clients.find(
                                  (c) => c.clientId === p.clientId,
                                )
                              : null
                            const drop = p.dropId
                              ? drops.find((d) => d.id === p.dropId)
                              : null
                            const busy = !!(client || drop)
                            return (
                              <button
                                key={p.index}
                                type="button"
                                onClick={() =>
                                  setPortPick({
                                    splitterId: s.id,
                                    portIndex: p.index,
                                  })
                                }
                                className={[
                                  'rounded-lg border px-2 py-2 text-left transition hover:ring-2 hover:ring-[var(--accent)]',
                                  busy
                                    ? 'border-cyan-400/60 bg-cyan-500/10'
                                    : 'border-dashed border-[var(--border)] bg-[var(--bg-elevated)]',
                                ].join(' ')}
                              >
                                <div className="text-xs font-bold text-cyan-300">
                                  P{p.index}
                                </div>
                                <div className="mt-0.5 truncate text-[11px] font-medium">
                                  {client?.label || 'Sin cliente'}
                                </div>
                                <div className="truncate text-[10px] text-[var(--text-muted)]">
                                  {drop
                                    ? drop.name || 'Drop'
                                    : 'Sin drop'}
                                </div>
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      </div></ModalPortal>

      {portPick && pickedSplitter && (
        <ModalPortal><div className="fixed inset-0 z-[700] modal-backdrop flex items-stretch justify-center overflow-hidden bg-black/50 sm:items-center sm:p-4">
          <div
            role="dialog"
            aria-modal="true"
            className="h-[100dvh] max-h-[100dvh] overflow-y-auto overscroll-contain w-full max-w-md rounded-none border-0 sm:h-auto sm:max-h-[min(92dvh,920px)] sm:rounded-xl sm:border border-[var(--border)] bg-[var(--bg-elevated)] p-4 shadow-xl"
          >
            <h3 className="text-base font-semibold">
              Puerto P{portPick.portIndex} · {pickedSplitter.name}
            </h3>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              Elige un drop conectado a esta NAP y el cliente al que llega.
            </p>

            <div className="mt-4">
              <span className="mb-2 block text-sm text-[var(--text-muted)]">
                Drop (conectado a esta NAP)
              </span>
              {drops.length === 0 ? (
                <p className="rounded-lg border border-dashed border-[var(--border)] px-3 py-4 text-center text-[11px] text-[var(--text-muted)]">
                  No hay drops enganchados a esta NAP. Traza un drop hasta aquí
                  en el mapa.
                </p>
              ) : (
                <div
                  className={`flex flex-wrap gap-2 ${
 drops.length === 1 ? 'justify-center' : ''
 }`}
                >
                  {drops.map((d) => {
                    const fibers = d.fibers ?? []
                    const usedElsewhere =
                      usedDropIds.has(d.id) && currentDropKeyDropId !== d.id
                    const defaultKey = fibers[0]
                      ? `${d.id}:${fibers[0].id}`
                      : `${d.id}:`
                    const selected =
                      currentDropKeyDropId === d.id && !!draftDropKey
                    const clientLabel = d.clientId
                      ? clients.find((c) => c.clientId === d.clientId)?.label
                      : null

                    function pick(key: string) {
                      if (usedElsewhere) return
                      const next = draftDropKey === key ? '' : key
                      setDraftDropKey(next)
                      if (next && d.clientId) setDraftClientId(d.clientId)
                    }

                    return (
                      <div
                        key={d.id}
                        className={`flex w-[7.5rem] flex-col items-center justify-center gap-1 rounded-xl border px-2 py-3 text-center transition ${
 usedElsewhere
 ? 'cursor-not-allowed opacity-40'
 : 'cursor-pointer'
 } ${
 selected
 ? 'border-cyan-400 bg-cyan-500/15 ring-1 ring-cyan-400/60'
 : 'border-[var(--border)] bg-[var(--bg)] hover:border-cyan-500/40'
 }`}
                        onClick={() => {
                          if (fibers.length > 1 && selected) return
                          pick(defaultKey)
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            if (fibers.length > 1 && selected) return
                            pick(defaultKey)
                          }
                        }}
                        role="button"
                        tabIndex={usedElsewhere ? -1 : 0}
                        aria-pressed={selected}
                        aria-disabled={usedElsewhere}
                      >
                        <span
                          className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-500/40 bg-slate-500/20 text-[10px] font-bold text-slate-200"
                          aria-hidden
                        >
                          D
                        </span>
                        <span className="line-clamp-2 w-full text-[11px] font-medium leading-tight">
                          {d.name || 'Drop'}
                        </span>
                        {fibers.length > 1 && (
                          <span className="flex flex-wrap justify-center gap-0.5">
                            {fibers.map((f) => {
                              const fKey = `${d.id}:${f.id}`
                              const fSelected = draftDropKey === fKey
                              return (
                                <button
                                  key={f.id}
                                  type="button"
                                  disabled={usedElsewhere}
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    pick(fKey)
                                  }}
                                  className={`rounded px-1.5 py-0.5 text-[9px] ${
 fSelected
 ? 'bg-cyan-500/40 text-cyan-50'
 : 'bg-black/20 text-[var(--text-muted)] hover:bg-black/30'
 }`}
                                >
                                  {f.name}
                                </button>
                              )
                            })}
                          </span>
                        )}
                        {clientLabel && (
                          <span className="line-clamp-1 w-full text-[9px] text-[var(--text-muted)]">
                            {clientLabel}
                          </span>
                        )}
                        {usedElsewhere && (
                          <span className="text-[9px] text-amber-300/90">
                            Otro puerto
                          </span>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            <label className="mt-3 block text-sm">
              <span className="mb-1 block text-[var(--text-muted)]">
                Cliente
              </span>
              <select
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm"
                value={draftClientId}
                onChange={(e) => setDraftClientId(e.target.value)}
              >
                <option value="">Sin cliente</option>
                {clients.map((c) => (
                  <option
                    key={c.clientId}
                    value={c.clientId}
                    disabled={
                      usedClientIds.has(c.clientId) &&
                      draftClientId !== c.clientId
                    }
                  >
                    {c.label}
                    {c.subtitle ? ` · ${c.subtitle}` : ''}
                  </option>
                ))}
              </select>
              {clients.length === 0 && (
                <span className="mt-1 block text-[11px] text-[var(--text-muted)]">
                  No hay clientes con ubicación en el mapa.
                </span>
              )}
            </label>

            {draftDropKey && draftClientId && (
              <p className="mt-3 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-2.5 py-2 text-[11px] text-cyan-100">
                Al guardar, el drop quedará conectado a este cliente.
              </p>
            )}

            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={clearPortAssignment}
                className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm text-red-300 hover:bg-red-500/10"
              >
                Liberar puerto
              </button>
              <button
                type="button"
                onClick={() => setPortPick(null)}
                className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={savePortAssignment}
                className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-white"
              >
                Guardar
              </button>
            </div>
          </div>
        </div></ModalPortal>
      )}
    </>
  )
}
