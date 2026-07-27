import { useMemo, useState, type DragEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'
import {
  cableTubes,
  cablesEnteringNode,
  findFiberInCable,
  mapElementLabel,
  strandBackground,
  type MapDraftElement,
} from '../lib/map-elements'
import {
  headerPortAssetLabel,
  headerPortLinked,
  headerPortTooltip,
  type NodeHeader,
  type NodeHeaderPort,
} from '../lib/node-headers'
import type { TopologyGraph } from '../lib/topology'
import { MapElementTypeIcon } from './MapElementTypeIcon'
import { NodeHeaderPortModal } from './NodeHeaderPortModal'

const DND_FIBER = 'application/x-node-fiber'
const DND_TUBE = 'application/x-node-tube'

type FiberDrag = {
  kind: 'fiber'
  cableId: string
  tubeId: string
  fiberId: string
}

type TubeDrag = {
  kind: 'tube'
  cableId: string
  tubeId: string
}

function parseDragPayload(e: DragEvent): FiberDrag | TubeDrag | null {
  try {
    const raw =
      e.dataTransfer.getData(DND_FIBER) || e.dataTransfer.getData(DND_TUBE)
    if (!raw) return null
    const parsed = JSON.parse(raw) as FiberDrag | TubeDrag
    if (parsed.kind === 'fiber' || parsed.kind === 'tube') return parsed
    return null
  } catch {
    return null
  }
}

/**
 * Vista de nodo físico en el mapa: cabeceras de fibra (ODF) con sus puertos
 * y cables que entran al nodo. Los pelos y minitubos se asignan a puertos
 * arrastrándolos (drag & drop), como en las NAP.
 */
export function NodeViewModal({
  open,
  nodeId,
  nodeLabel,
  drafts,
  canWrite,
  onClose,
}: {
  open: boolean
  nodeId: string | null
  nodeLabel: string
  drafts: MapDraftElement[]
  canWrite: boolean
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [portPick, setPortPick] = useState<{
    headerId: string
    index: number
  } | null>(null)
  const [dragOverPort, setDragOverPort] = useState<string | null>(null)
  const [openCables, setOpenCables] = useState<Record<string, boolean>>({})

  const headersQuery = useQuery({
    queryKey: ['app', 'network-nodes', nodeId, 'headers'],
    queryFn: () =>
      apiFetch<NodeHeader[]>(`/app/network-nodes/${nodeId}/headers`),
    enabled: open && !!nodeId,
  })
  const headers = headersQuery.data ?? []

  const topologyQuery = useQuery({
    queryKey: ['app', 'topology'],
    queryFn: () => apiFetch<TopologyGraph>('/app/topology'),
    enabled: open && !!nodeId,
    staleTime: 60_000,
  })
  const deviceNameById = useMemo(() => {
    const map = new Map<string, string>()
    for (const d of topologyQuery.data?.devices ?? []) {
      map.set(d.id, d.name)
    }
    return map
  }, [topologyQuery.data])

  const cables = useMemo(
    () => (nodeId ? cablesEnteringNode(nodeId, drafts) : []),
    [nodeId, drafts],
  )

  const invalidate = () => {
    void queryClient.invalidateQueries({
      queryKey: ['app', 'network-nodes', nodeId, 'headers'],
    })
  }

  const assignFiberMutation = useMutation({
    mutationFn: ({
      headerId,
      index,
      drag,
    }: {
      headerId: string
      index: number
      drag: FiberDrag
    }) =>
      apiFetch<NodeHeader>(
        `/app/network-nodes/${nodeId}/headers/${headerId}/port`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            index,
            cableId: drag.cableId,
            tubeId: drag.tubeId,
            fiberId: drag.fiberId,
          }),
        },
      ),
    onSuccess: invalidate,
  })

  const assignTubeMutation = useMutation({
    mutationFn: ({
      header,
      index,
      drag,
    }: {
      header: NodeHeader
      index: number
      drag: TubeDrag
    }) => {
      const cable = cables.find((c) => c.id === drag.cableId)
      const tube = cableTubes(cable).find((t) => t.id === drag.tubeId)
      const fibers = tube?.fibers ?? []
      // Reparte los pelos del minitubo en puertos libres consecutivos
      const ports: NodeHeaderPort[] = header.ports.map((p) => ({ ...p }))
      let fi = 0
      for (const p of ports) {
        if (fi >= fibers.length) break
        if (p.index < index) continue
        if (p.fiberId) continue
        p.cableId = drag.cableId
        p.tubeId = drag.tubeId
        p.fiberId = fibers[fi].id
        fi += 1
      }
      return apiFetch<NodeHeader>(
        `/app/network-nodes/${nodeId}/headers/${header.id}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ ports }),
        },
      )
    },
    onSuccess: invalidate,
  })

  if (!open || !nodeId) return null

  function handlePortDrop(header: NodeHeader, index: number, e: DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    setDragOverPort(null)
    if (!canWrite) return
    const drag = parseDragPayload(e)
    if (!drag) return
    if (drag.kind === 'fiber') {
      assignFiberMutation.mutate({ headerId: header.id, index, drag })
    } else {
      assignTubeMutation.mutate({ header, index, drag })
    }
  }

  const pickedHeader = portPick
    ? (headers.find((h) => h.id === portPick.headerId) ?? null)
    : null

  return (
    <>
      <div className="fixed inset-0 z-[600] flex items-start justify-center overflow-y-auto bg-black/60 p-3 sm:items-center sm:p-4">
        <div
          role="dialog"
          aria-modal="true"
          className="flex max-h-[min(92vh,100dvh)] w-full max-w-[min(90rem,95vw)] flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] shadow-xl"
        >
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3 sm:px-5">
            <div className="flex items-center gap-3">
              <span className="grid h-10 w-10 place-items-center rounded-lg bg-[var(--accent)]/15 text-lg">
                🏢
              </span>
              <div>
                <h2 className="text-lg font-semibold">{nodeLabel}</h2>
                <p className="text-xs text-[var(--text-muted)]">
                  Cabeceras de fibra · arrastra pelos o minitubos a un puerto
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

          <div className="grid min-h-0 flex-1 gap-3 overflow-auto p-3 sm:grid-cols-[minmax(16rem,22rem)_1fr] sm:p-4">
            {/* Cables que entran al nodo */}
            <section className="space-y-2">
              <h3 className="text-xs font-semibold tracking-wide text-[var(--text-muted)] uppercase">
                Cables en el nodo ({cables.length})
              </h3>
              {cables.length === 0 && (
                <p className="rounded-lg border border-dashed border-[var(--border)] px-3 py-6 text-center text-xs text-[var(--text-muted)]">
                  Ningún cable engancha este nodo. Traza un cable y haz
                  clic sobre el nodo para conectarlo.
                </p>
              )}
              {cables.map((c) => {
                const tubes = cableTubes(c)
                const isOpen = openCables[c.id] ?? cables.length === 1
                return (
                  <div
                    key={c.id}
                    className="rounded-xl border border-[var(--border)] bg-[var(--bg)] p-2.5"
                  >
                    <button
                      type="button"
                      onClick={() =>
                        setOpenCables((prev) => ({
                          ...prev,
                          [c.id]: !isOpen,
                        }))
                      }
                      className="flex w-full items-center gap-2 text-left"
                    >
                      <MapElementTypeIcon type={c.type} size={26} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">
                          {c.name || mapElementLabel[c.type]}
                        </span>
                        <span className="block text-[11px] text-[var(--text-muted)]">
                          {tubes.length} minitubo(s) ·{' '}
                          {tubes.reduce((n, t) => n + t.fibers.length, 0)}{' '}
                          pelos
                        </span>
                      </span>
                      <span className="text-xs text-[var(--text-muted)]">
                        {isOpen ? '▾' : '▸'}
                      </span>
                    </button>
                    {isOpen && (
                      <div className="mt-2 space-y-2">
                        {tubes.map((t) => (
                          <div
                            key={t.id}
                            className="rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] p-2"
                          >
                            <div
                              draggable={canWrite}
                              onDragStart={(e) => {
                                e.dataTransfer.setData(
                                  DND_TUBE,
                                  JSON.stringify({
                                    kind: 'tube',
                                    cableId: c.id,
                                    tubeId: t.id,
                                  } satisfies TubeDrag),
                                )
                                e.dataTransfer.effectAllowed = 'move'
                              }}
                              className={[
                                'mb-1.5 flex items-center gap-2 rounded-md px-1.5 py-1',
                                canWrite ? 'cursor-grab' : '',
                              ].join(' ')}
                              title={
                                canWrite
                                  ? 'Arrastra el minitubo a un puerto para repartir sus pelos'
                                  : undefined
                              }
                            >
                              <span
                                className="inline-block h-3.5 w-3.5 shrink-0 rounded-sm border border-black/30"
                                style={{
                                  background: strandBackground(
                                    t.color,
                                    t.tracer,
                                  ),
                                }}
                              />
                              <span className="text-xs font-medium">
                                {t.name}
                              </span>
                              <span className="text-[10px] text-[var(--text-muted)]">
                                {t.fibers.length} pelos
                              </span>
                            </div>
                            <div className="flex flex-wrap gap-1">
                              {t.fibers.map((f) => (
                                <span
                                  key={f.id}
                                  draggable={canWrite}
                                  onDragStart={(e) => {
                                    e.dataTransfer.setData(
                                      DND_FIBER,
                                      JSON.stringify({
                                        kind: 'fiber',
                                        cableId: c.id,
                                        tubeId: t.id,
                                        fiberId: f.id,
                                      } satisfies FiberDrag),
                                    )
                                    e.dataTransfer.effectAllowed = 'move'
                                  }}
                                  title={f.name}
                                  className={[
                                    'inline-flex items-center gap-1 rounded-md border border-[var(--border)] px-1.5 py-0.5 text-[10px]',
                                    canWrite ? 'cursor-grab' : '',
                                  ].join(' ')}
                                >
                                  <span
                                    className="inline-block h-2.5 w-2.5 rounded-full border border-black/30"
                                    style={{
                                      background: strandBackground(
                                        f.color,
                                        f.tracer,
                                      ),
                                    }}
                                  />
                                  {f.name}
                                </span>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </section>

            {/* Cabeceras con puertos (drop targets) */}
            <section className="space-y-3">
              <h3 className="text-xs font-semibold tracking-wide text-[var(--text-muted)] uppercase">
                Cabeceras ({headers.length})
              </h3>
              {headersQuery.isLoading && (
                <p className="text-xs text-[var(--text-muted)]">Cargando…</p>
              )}
              {!headersQuery.isLoading && headers.length === 0 && (
                <p className="rounded-lg border border-dashed border-[var(--border)] px-3 py-6 text-center text-xs text-[var(--text-muted)]">
                  Este nodo no tiene cabeceras. Créalas en Ajustes → Nodos →
                  Editar.
                </p>
              )}
              {headers.map((h) => (
                <div
                  key={h.id}
                  className="rounded-xl border-2 border-cyan-500/40 bg-[var(--bg)] p-3"
                >
                  <div className="mb-2">
                    <p className="text-sm font-semibold">{h.name}</p>
                    <p className="text-[11px] text-[var(--text-muted)]">
                      {h.portCount} puertos ·{' '}
                      {h.ports.filter(headerPortLinked).length} enlazados ·
                      clic para editar, suelta un pelo para asignarlo
                    </p>
                  </div>
                  <div className="grid w-full grid-cols-4 gap-1.5 sm:grid-cols-6 md:grid-cols-8">
                    {h.ports.map((p) => {
                      const key = `${h.id}:${p.index}`
                      const cable = p.cableId
                        ? cables.find((c) => c.id === p.cableId) ??
                          drafts.find((d) => d.id === p.cableId)
                        : null
                      const fiber =
                        p.fiberId && cable
                          ? findFiberInCable(cable, p.fiberId)
                          : null
                      const linked = headerPortLinked(p)
                      const assetLabel = headerPortAssetLabel(
                        p,
                        p.deviceId ? deviceNameById.get(p.deviceId) : null,
                      )
                      return (
                        <button
                          key={p.index}
                          type="button"
                          title={headerPortTooltip(p, {
                            deviceName: p.deviceId
                              ? deviceNameById.get(p.deviceId)
                              : null,
                            fiberHint: fiber
                              ? `pelo: ${fiber.tube.name} / ${fiber.fiber.name}`
                              : null,
                          })}
                          onClick={() =>
                            setPortPick({ headerId: h.id, index: p.index })
                          }
                          onDragOver={(e) => {
                            if (!canWrite) return
                            e.preventDefault()
                            e.dataTransfer.dropEffect = 'move'
                            setDragOverPort(key)
                          }}
                          onDragLeave={() =>
                            setDragOverPort((prev) =>
                              prev === key ? null : prev,
                            )
                          }
                          onDrop={(e) => handlePortDrop(h, p.index, e)}
                          className={[
                            'flex min-h-[3.25rem] w-full flex-col items-center justify-start gap-0.5 rounded-md border px-1 py-1.5 text-[11px] font-medium transition-colors',
                            dragOverPort === key
                              ? 'border-[var(--accent)] bg-[var(--accent)]/20'
                              : linked
                                ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-300'
                                : 'border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--bg-elevated)]',
                          ].join(' ')}
                        >
                          <span>{p.index}</span>
                          {assetLabel && (
                            <span className="max-w-full truncate text-[9px] leading-tight text-[var(--text-muted)]">
                              {assetLabel}
                            </span>
                          )}
                          {fiber ? (
                            <span
                              className="inline-block h-2.5 w-2.5 rounded-full border border-black/30"
                              style={{
                                background: strandBackground(
                                  fiber.fiber.color,
                                  fiber.fiber.tracer,
                                ),
                              }}
                            />
                          ) : null}
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))}
              {(assignFiberMutation.error || assignTubeMutation.error) && (
                <p className="text-xs text-[var(--danger)]">
                  {
                    (
                      (assignFiberMutation.error ??
                        assignTubeMutation.error) as Error
                    ).message
                  }
                </p>
              )}
            </section>
          </div>
        </div>
      </div>

      <NodeHeaderPortModal
        open={!!portPick && !!pickedHeader}
        nodeId={nodeId}
        header={pickedHeader}
        portIndex={portPick?.index ?? null}
        canWrite={canWrite}
        mapContracted
        onClose={() => setPortPick(null)}
      />
    </>
  )
}
