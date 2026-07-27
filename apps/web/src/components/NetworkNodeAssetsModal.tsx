import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'
import {
  nodeAssetStatusLabel,
  type NetworkNode,
  type NetworkNodeAsset,
} from '../lib/network-nodes'
import { deviceTypeLabel, type NetworkDeviceType } from '../lib/topology'
import { GoogleMapsCoords } from './GoogleMapsCoords'
import { LocationPickerMap } from './LocationPickerMap'
import { NodeHeadersSection } from './NodeHeadersSection'

export function NetworkNodeAssetsModal({
  open,
  onClose,
  node,
  canWrite,
}: {
  open: boolean
  onClose: () => void
  node: NetworkNode
  canWrite: boolean
}) {
  const queryClient = useQueryClient()
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const assignableQuery = useQuery({
    queryKey: ['app', 'network-nodes', node.id, 'assignable'],
    queryFn: () =>
      apiFetch<(NetworkNodeAsset & { assigned: boolean })[]>(
        `/app/network-nodes/${node.id}/assignable-devices`,
      ),
    enabled: open,
    refetchInterval: open ? 15_000 : false,
  })

  useEffect(() => {
    if (!open || !assignableQuery.data) return
    setSelected(
      new Set(assignableQuery.data.filter((d) => d.assigned).map((d) => d.id)),
    )
  }, [open, assignableQuery.data])

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const saveMutation = useMutation({
    mutationFn: () =>
      apiFetch<NetworkNode>(`/app/network-nodes/${node.id}/devices`, {
        method: 'PUT',
        body: JSON.stringify({ deviceIds: [...selected] }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['app', 'network-nodes'] })
      void queryClient.invalidateQueries({
        queryKey: ['app', 'network-map'],
      })
      onClose()
    },
  })

  const devices = assignableQuery.data ?? []
  const sorted = useMemo(
    () =>
      [...devices].sort((a, b) => {
        if (a.assigned !== b.assigned) return a.assigned ? -1 : 1
        return a.name.localeCompare(b.name)
      }),
    [devices],
  )

  if (!open) return null

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 sm:items-center">
      <div
        role="dialog"
        aria-modal="true"
        className="flex max-h-[min(92vh,100dvh)] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] shadow-xl"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-[var(--border)] px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold">Activos · {node.name}</h2>
            <p className="text-xs text-[var(--text-muted)]">
              Gestiona equipos de topología y cabeceras de fibra.
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

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
          {(node.street ||
            node.city ||
            (node.latitude != null && node.longitude != null)) && (
            <section className="rounded-lg border border-[var(--border)] p-3">
              <h3 className="mb-2 text-sm font-semibold">Ubicación</h3>
              {(node.street || node.city) && (
                <p className="mb-2 text-xs text-[var(--text-muted)]">
                  {[node.street, node.city].filter(Boolean).join(', ')}
                </p>
              )}
              {node.latitude != null && node.longitude != null ? (
                <>
                  <LocationPickerMap
                    lat={node.latitude}
                    lng={node.longitude}
                    readOnly
                    className="h-40 w-full rounded-lg"
                  />
                  <GoogleMapsCoords
                    className="mt-2"
                    lat={node.latitude}
                    lng={node.longitude}
                  />
                </>
              ) : (
                <p className="text-xs text-[var(--text-muted)]">
                  Sin coordenadas GPS.
                </p>
              )}
            </section>
          )}

          <NodeHeadersSection node={node} canWrite={canWrite} />

          <div className="border-t border-[var(--border)] pt-3">
            <h3 className="text-sm font-semibold">Equipos de topología</h3>
            <p className="mt-0.5 text-xs text-[var(--text-muted)]">
              Asigna OLT, routers u otros activos al nodo.
            </p>
          </div>

          {assignableQuery.isLoading && (
            <p className="text-sm text-[var(--text-muted)]">Cargando…</p>
          )}
          {assignableQuery.error && (
            <p className="text-sm text-[var(--danger)]">
              {(assignableQuery.error as Error).message}
            </p>
          )}
          {!assignableQuery.isLoading && sorted.length === 0 && (
            <p className="rounded-lg border border-dashed border-[var(--border)] px-3 py-8 text-center text-sm text-[var(--text-muted)]">
              No hay activos disponibles. Crea equipos en Topología primero.
            </p>
          )}
          <ul className="space-y-1.5">
            {sorted.map((d) => {
              const checked = selected.has(d.id)
              return (
                <li key={d.id}>
                  <label
                    className={[
                      'flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 text-sm transition',
                      checked
                        ? 'border-[var(--accent)] bg-[var(--accent)]/10'
                        : 'border-[var(--border)] hover:bg-[var(--bg)]',
                      !canWrite ? 'cursor-default opacity-80' : '',
                    ].join(' ')}
                  >
                    <input
                      type="checkbox"
                      disabled={!canWrite}
                      checked={checked}
                      onChange={() => toggle(d.id)}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{d.name}</span>
                      <span className="block text-xs text-[var(--text-muted)]">
                        {deviceTypeLabel[d.type as NetworkDeviceType] ?? d.type}
                        {d.mgmtHost ? ` · ${d.mgmtHost}` : ''}
                      </span>
                    </span>
                    <StatusPill status={d.status} />
                  </label>
                </li>
              )
            })}
          </ul>
          {saveMutation.error && (
            <p className="text-sm text-[var(--danger)]">
              {saveMutation.error.message}
            </p>
          )}
        </div>

        <div className="flex shrink-0 justify-end gap-2 border-t border-[var(--border)] px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm"
          >
            Cerrar
          </button>
          {canWrite && (
            <button
              type="button"
              disabled={saveMutation.isPending}
              onClick={() => saveMutation.mutate()}
              className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-60"
            >
              {saveMutation.isPending ? 'Guardando…' : 'Guardar activos'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function StatusPill({ status }: { status: NetworkNodeAsset['status'] }) {
  const cls =
    status === 'online'
      ? 'bg-emerald-500/15 text-emerald-300'
      : status === 'offline'
        ? 'bg-red-500/15 text-red-300'
        : 'bg-[var(--bg)] text-[var(--text-muted)]'
  return (
    <span
      className={`shrink-0 rounded px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${cls}`}
    >
      {nodeAssetStatusLabel[status]}
    </span>
  )
}
