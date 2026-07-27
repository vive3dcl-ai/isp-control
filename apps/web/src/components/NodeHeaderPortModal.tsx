import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'
import { useAuth } from '../auth/AuthContext'
import {
  cableTubes,
  findFiberInCable,
  loadMapDrafts,
  strandBackground,
  type MapDraftElement,
} from '../lib/map-elements'
import type { NodeHeader, NodeHeaderPort } from '../lib/node-headers'
import type { OltPonPortsResponse, TopologyGraph } from '../lib/topology'
import { deviceTypeLabel } from '../lib/topology'

const inputClass =
  'w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 outline-none ring-[var(--accent)] focus:ring-2'

/** Tipos de activos con puertos enlazables a una cabecera. */
const LINKABLE_TYPES = ['olt', 'router', 'switch'] as const

/**
 * Editor de un puerto de cabecera (ODF): enlace a puerto PON de OLT o
 * puerto de router, nombre opcional, descripción y —si el mapa de red no
 * está contratado— asignación manual de cable / minitubo / pelo.
 */
export function NodeHeaderPortModal({
  open,
  nodeId,
  header,
  portIndex,
  canWrite,
  mapContracted,
  onClose,
  onSaved,
}: {
  open: boolean
  nodeId: string
  header: NodeHeader | null
  portIndex: number | null
  canWrite: boolean
  mapContracted: boolean
  onClose: () => void
  onSaved?: (next: NodeHeader) => void
}) {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const tenantKey = user?.tenantSlug ?? user?.tenantId

  const port: NodeHeaderPort | null =
    header && portIndex != null
      ? (header.ports.find((p) => p.index === portIndex) ?? null)
      : null

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [deviceId, setDeviceId] = useState('')
  const [devicePortId, setDevicePortId] = useState('')
  const [devicePortName, setDevicePortName] = useState('')
  const [cableId, setCableId] = useState('')
  const [tubeId, setTubeId] = useState('')
  const [fiberId, setFiberId] = useState('')

  useEffect(() => {
    if (!open || !port) return
    setName(port.name)
    setDescription(port.description)
    setDeviceId(port.deviceId ?? '')
    setDevicePortId(port.devicePortId ?? '')
    setDevicePortName(port.devicePortName ?? '')
    setCableId(port.cableId ?? '')
    setTubeId(port.tubeId ?? '')
    setFiberId(port.fiberId ?? '')
  }, [open, port])

  const graphQuery = useQuery({
    queryKey: ['app', 'topology'],
    queryFn: () => apiFetch<TopologyGraph>('/app/topology'),
    enabled: open,
    staleTime: 30_000,
  })

  const devices = useMemo(
    () =>
      (graphQuery.data?.devices ?? []).filter((d) =>
        (LINKABLE_TYPES as readonly string[]).includes(d.type),
      ),
    [graphQuery.data],
  )
  const device = devices.find((d) => d.id === deviceId) ?? null
  const isOlt = device?.type === 'olt'

  const ponPortsQuery = useQuery({
    queryKey: ['app', 'topology', 'device', deviceId, 'pon-ports'],
    queryFn: () =>
      apiFetch<OltPonPortsResponse>(
        `/app/topology/devices/${deviceId}/pon-ports`,
      ),
    enabled: open && !!deviceId && isOlt,
    staleTime: 60_000,
  })

  // Cables del mapa (asignación manual cuando el módulo está apagado)
  const drafts = useMemo<MapDraftElement[]>(
    () => (open && !mapContracted ? loadMapDrafts(tenantKey) : []),
    [open, mapContracted, tenantKey],
  )
  const cables = useMemo(
    () => drafts.filter((d) => d.type === 'cable' || d.type === 'drop'),
    [drafts],
  )
  const selectedCable = cables.find((c) => c.id === cableId) ?? null
  const tubes = cableTubes(selectedCable)
  const selectedTube = tubes.find((t) => t.id === tubeId) ?? null

  const mutation = useMutation({
    mutationFn: () => {
      if (!header || !port) throw new Error('Puerto no disponible')
      return apiFetch<NodeHeader>(
        `/app/network-nodes/${nodeId}/headers/${header.id}/port`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            index: port.index,
            name: name.trim(),
            description: description.trim(),
            deviceId: deviceId || null,
            devicePortId: devicePortId || null,
            devicePortName: devicePortName.trim() || null,
            cableId: cableId || null,
            tubeId: tubeId || null,
            fiberId: fiberId || null,
          }),
        },
      )
    },
    onSuccess: (next) => {
      void queryClient.invalidateQueries({
        queryKey: ['app', 'network-nodes', nodeId, 'headers'],
      })
      onSaved?.(next)
      onClose()
    },
  })

  if (!open || !header || !port) return null

  const activePortName = devicePortName || null

  function pickDevice(id: string) {
    setDeviceId(id)
    setDevicePortId('')
    setDevicePortName('')
  }

  function pickRouterPort(id: string) {
    setDevicePortId(id)
    const p = device?.ports.find((x) => x.id === id)
    setDevicePortName(p?.name ?? '')
  }

  function pickPonPort(ifName: string) {
    setDevicePortId('')
    setDevicePortName(ifName)
  }

  const currentFiber =
    fiberId && selectedCable ? findFiberInCable(selectedCable, fiberId) : null

  return createPortal(
    <div className="fixed inset-0 z-[720] flex items-start justify-center overflow-y-auto bg-black/60 p-4 sm:items-center">
      <div
        role="dialog"
        aria-modal="true"
        className="flex max-h-[min(92vh,100dvh)] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-[var(--border)] px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold">
              {header.name} · Puerto {port.index}
            </h2>
            <p className="text-xs text-[var(--text-muted)]">
              Enlaza un puerto PON de OLT o un puerto de router
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2 py-1 text-[var(--text-muted)] hover:bg-[var(--bg)]"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
          <label className="block text-sm">
            <span className="mb-1 block text-[var(--text-muted)]">Activo</span>
            <select
              className={inputClass}
              value={deviceId}
              disabled={!canWrite}
              onChange={(e) => pickDevice(e.target.value)}
            >
              <option value="">— Sin enlazar —</option>
              {devices.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} · {deviceTypeLabel[d.type]}
                </option>
              ))}
            </select>
          </label>

          {device && isOlt && (
            <label className="block text-sm">
              <span className="mb-1 block text-[var(--text-muted)]">
                Puerto PON
              </span>
              <select
                className={inputClass}
                value={devicePortName}
                disabled={!canWrite}
                onChange={(e) => pickPonPort(e.target.value)}
              >
                <option value="">— Elegir puerto —</option>
                {(ponPortsQuery.data?.ports ?? []).map((p) => (
                  <option key={p.ifName} value={p.ifName}>
                    {p.ifName} · {p.onuOnline}/{p.onuTotal} ONUs ·{' '}
                    {p.status}
                  </option>
                ))}
              </select>
              {ponPortsQuery.isLoading && (
                <span className="mt-1 block text-xs text-[var(--text-muted)]">
                  Consultando puertos PON…
                </span>
              )}
              {ponPortsQuery.error && (
                <span className="mt-1 block text-xs text-[var(--danger)]">
                  {(ponPortsQuery.error as Error).message}
                </span>
              )}
            </label>
          )}

          {device && !isOlt && (
            <label className="block text-sm">
              <span className="mb-1 block text-[var(--text-muted)]">
                Puerto
              </span>
              <select
                className={inputClass}
                value={devicePortId}
                disabled={!canWrite}
                onChange={(e) => pickRouterPort(e.target.value)}
              >
                <option value="">— Elegir puerto —</option>
                {device.ports.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.ipAddress ? ` · ${p.ipAddress}` : ''}
                  </option>
                ))}
              </select>
            </label>
          )}

          <label className="block text-sm">
            <span className="mb-1 block text-[var(--text-muted)]">
              Nombre (opcional)
            </span>
            <input
              className={inputClass}
              value={name}
              disabled={!canWrite}
              onChange={(e) => setName(e.target.value)}
              placeholder={activePortName ?? `Puerto ${port.index}`}
            />
            <span className="mt-1 block text-xs text-[var(--text-muted)]">
              Si se deja vacío se usa el nombre del puerto activo de red.
            </span>
          </label>

          <label className="block text-sm">
            <span className="mb-1 block text-[var(--text-muted)]">
              Descripción
            </span>
            <textarea
              className={inputClass}
              rows={2}
              value={description}
              disabled={!canWrite}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>

          {mapContracted ? (
            <div className="rounded-lg border border-[var(--border)] bg-[var(--bg)] p-3 text-xs text-[var(--text-muted)]">
              {fiberId ? (
                <span>
                  Pelo asignado desde el mapa
                  {currentFiber ? ` · ${currentFiber.fiber.name}` : ''}.{' '}
                  {canWrite && (
                    <button
                      type="button"
                      className="text-[var(--danger)] hover:underline"
                      onClick={() => {
                        setCableId('')
                        setTubeId('')
                        setFiberId('')
                      }}
                    >
                      Quitar
                    </button>
                  )}
                </span>
              ) : (
                'El cable / minitubo / pelo se asigna gráficamente en el mapa de red (arrastrando sobre el nodo).'
              )}
            </div>
          ) : (
            <div className="space-y-3 rounded-lg border border-[var(--border)] bg-[var(--bg)] p-3">
              <p className="text-xs font-semibold tracking-wide text-[var(--text-muted)] uppercase">
                Cable · minitubo · pelo
              </p>
              <label className="block text-sm">
                <span className="mb-1 block text-[var(--text-muted)]">
                  Cable
                </span>
                <select
                  className={inputClass}
                  value={cableId}
                  disabled={!canWrite}
                  onChange={(e) => {
                    setCableId(e.target.value)
                    setTubeId('')
                    setFiberId('')
                  }}
                >
                  <option value="">— Sin cable —</option>
                  {cables.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name || (c.type === 'drop' ? 'Drop' : 'Cable')}
                    </option>
                  ))}
                </select>
              </label>
              {selectedCable && (
                <label className="block text-sm">
                  <span className="mb-1 block text-[var(--text-muted)]">
                    Minitubo
                  </span>
                  <select
                    className={inputClass}
                    value={tubeId}
                    disabled={!canWrite}
                    onChange={(e) => {
                      setTubeId(e.target.value)
                      setFiberId('')
                    }}
                  >
                    <option value="">— Elegir minitubo —</option>
                    {tubes.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {selectedTube && (
                <label className="block text-sm">
                  <span className="mb-1 block text-[var(--text-muted)]">
                    Pelo
                  </span>
                  <select
                    className={inputClass}
                    value={fiberId}
                    disabled={!canWrite}
                    onChange={(e) => setFiberId(e.target.value)}
                  >
                    <option value="">— Elegir pelo —</option>
                    {selectedTube.fibers.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {currentFiber && (
                <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
                  <span
                    className="inline-block h-3 w-3 rounded-full border border-black/30"
                    style={{
                      background: strandBackground(
                        currentFiber.fiber.color,
                        currentFiber.fiber.tracer,
                      ),
                    }}
                  />
                  {currentFiber.tube.name} · {currentFiber.fiber.name}
                </div>
              )}
            </div>
          )}

          {mutation.error && (
            <p className="text-sm text-[var(--danger)]">
              {(mutation.error as Error).message}
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-between gap-2 border-t border-[var(--border)] px-5 py-4">
          {canWrite ? (
            <button
              type="button"
              onClick={() => {
                setName('')
                setDescription('')
                setDeviceId('')
                setDevicePortId('')
                setDevicePortName('')
                setCableId('')
                setTubeId('')
                setFiberId('')
              }}
              className="rounded-lg border border-red-500/40 px-3 py-2 text-sm text-red-300 hover:bg-red-500/10"
            >
              Vaciar puerto
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm"
            >
              Cancelar
            </button>
            {canWrite && (
              <button
                type="button"
                disabled={mutation.isPending}
                onClick={() => mutation.mutate()}
                className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-60"
              >
                {mutation.isPending ? 'Guardando…' : 'Guardar'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
