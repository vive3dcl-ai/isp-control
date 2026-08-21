import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'
import {
  nodeHealthLabel,
  type NetworkNode,
  type NodeHealth,
} from '../lib/network-nodes'
import { useNotify } from './NotifyProvider'
import { NetworkNodeFormModal } from './NetworkNodeFormModal'
import { NetworkNodeAssetsModal } from './NetworkNodeAssetsModal'
import { GoogleMapsCoords } from './GoogleMapsCoords'
import {
  DesktopTableWrap,
  MobileList,
  MobileListCard,
  MobileListMeta,
} from './MobileList'

function healthClass(h: NodeHealth) {
  if (h === 'ok') return 'bg-emerald-500/15 text-emerald-300'
  if (h === 'degraded') return 'bg-amber-500/15 text-amber-300'
  if (h === 'down') return 'bg-red-500/15 text-red-300'
  return 'bg-[var(--bg)] text-[var(--text-muted)]'
}

export function NodosSettingsTab({ canWrite }: { canWrite: boolean }) {
  const queryClient = useQueryClient()
  const { confirm } = useNotify()
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<NetworkNode | null>(null)
  const [assetsNode, setAssetsNode] = useState<NetworkNode | null>(null)

  const query = useQuery({
    queryKey: ['app', 'network-nodes'],
    queryFn: () => apiFetch<NetworkNode[]>('/app/network-nodes'),
    refetchInterval: 15_000,
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/app/network-nodes/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['app', 'network-nodes'] })
      void queryClient.invalidateQueries({ queryKey: ['app', 'network-map'] })
    },
  })

  const nodes = query.data ?? []

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold">Nodos físicos</h3>
          <p className="mt-1 max-w-2xl text-sm text-[var(--text-muted)]">
            Sitios o racks con ubicación en el mapa. Asigna activos de
            topología; el estado del nodo refleja si algún equipo cae
            (mapa de calor).
          </p>
        </div>
        {canWrite && (
          <button
            type="button"
            onClick={() => {
              setEditing(null)
              setFormOpen(true)
            }}
            className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)]"
          >
            Añadir nodo
          </button>
        )}
      </div>

      {query.isLoading && (
        <p className="text-sm text-[var(--text-muted)]">Cargando…</p>
      )}
      {query.error && (
        <p className="text-sm text-[var(--danger)]">
          {(query.error as Error).message}
        </p>
      )}

      {!query.isLoading && nodes.length === 0 && (
        <p className="rounded-xl border border-dashed border-[var(--border)] px-4 py-10 text-center text-sm text-[var(--text-muted)]">
          Aún no hay nodos. Crea el primero con ubicación para verlo en el mapa
          de red.
        </p>
      )}

      {nodes.length > 0 && (
        <>
          <MobileList>
            {nodes.map((n) => (
              <MobileListCard key={n.id}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <button
                      type="button"
                      onClick={() => setAssetsNode(n)}
                      className="text-left text-sm font-semibold text-[var(--accent)] hover:underline"
                    >
                      {n.name}
                    </button>
                    {n.isRented && (
                      <span className="mt-0.5 block text-[11px] text-[var(--text-muted)]">
                        Arrendado
                      </span>
                    )}
                  </div>
                  <span
                    className={`shrink-0 rounded px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${healthClass(n.health)}`}
                  >
                    {nodeHealthLabel[n.health]}
                  </span>
                </div>
                <MobileListMeta>
                  <span>
                    {[n.street, n.city].filter(Boolean).join(', ') || '—'}
                  </span>
                  <span>·</span>
                  <button
                    type="button"
                    onClick={() => setAssetsNode(n)}
                    className="hover:underline"
                  >
                    {n.assetCount} ·{' '}
                    <span className="text-emerald-400">{n.onlineCount}↑</span>
                    {' · '}
                    <span className="text-red-300">{n.offlineCount}↓</span>
                  </button>
                  {n.isRented &&
                    [n.contactName, n.contactPhone].filter(Boolean).length >
                      0 && (
                      <>
                        <span>·</span>
                        <span>
                          {[n.contactName, n.contactPhone]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      </>
                    )}
                </MobileListMeta>
                {n.latitude != null && n.longitude != null && (
                  <div className="mt-1.5">
                    <GoogleMapsCoords
                      layout="inline"
                      lat={n.latitude}
                      lng={n.longitude}
                    />
                  </div>
                )}
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setAssetsNode(n)}
                    className="rounded-md border border-[var(--border)] px-2 py-1 text-xs hover:bg-[var(--bg-elevated)]"
                  >
                    Activos
                  </button>
                  {canWrite && (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          setEditing(n)
                          setFormOpen(true)
                        }}
                        className="rounded-md border border-[var(--border)] px-2 py-1 text-xs hover:bg-[var(--bg-elevated)]"
                      >
                        Editar
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          void confirm(
                            `¿Eliminar el nodo «${n.name}»? Los activos se desasignan, no se borran.`,
                            {
                              title: 'Eliminar nodo',
                              danger: true,
                              confirmLabel: 'Eliminar',
                            },
                          ).then((ok) => {
                            if (ok) deleteMutation.mutate(n.id)
                          })
                        }}
                        className="rounded-md border border-red-500/40 px-2 py-1 text-xs text-red-300 hover:bg-red-500/10"
                      >
                        Eliminar
                      </button>
                    </>
                  )}
                </div>
              </MobileListCard>
            ))}
          </MobileList>

          <DesktopTableWrap>
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="bg-[var(--bg)] text-[var(--text-muted)]">
                <tr>
                  <th className="px-4 py-3 font-medium">Nodo</th>
                  <th className="px-4 py-3 font-medium">Ubicación</th>
                  <th className="px-4 py-3 font-medium">Estado</th>
                  <th className="px-4 py-3 font-medium">Activos</th>
                  <th className="px-4 py-3 font-medium">Contacto</th>
                  <th className="px-4 py-3 font-medium">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {nodes.map((n) => (
                  <tr
                    key={n.id}
                    className="border-t border-[var(--border)] hover:bg-[var(--bg)]/60"
                  >
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => setAssetsNode(n)}
                        className="text-left font-medium text-[var(--accent)] hover:underline"
                      >
                        {n.name}
                      </button>
                      {n.isRented && (
                        <span className="mt-0.5 block text-[11px] text-[var(--text-muted)]">
                          Arrendado
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-[var(--text-muted)]">
                      <div className="space-y-1">
                        <span className="block">
                          {[n.street, n.city].filter(Boolean).join(', ') || '—'}
                        </span>
                        {n.latitude != null && n.longitude != null && (
                          <GoogleMapsCoords
                            layout="inline"
                            lat={n.latitude}
                            lng={n.longitude}
                          />
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${healthClass(n.health)}`}
                      >
                        {nodeHealthLabel[n.health]}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => setAssetsNode(n)}
                        className="text-left hover:underline"
                      >
                        {n.assetCount} ·{' '}
                        <span className="text-emerald-400">{n.onlineCount}↑</span>
                        {' · '}
                        <span className="text-red-300">{n.offlineCount}↓</span>
                      </button>
                    </td>
                    <td className="px-4 py-3 text-[var(--text-muted)]">
                      {n.isRented
                        ? [n.contactName, n.contactPhone]
                            .filter(Boolean)
                            .join(' · ') || '—'
                        : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => setAssetsNode(n)}
                          className="rounded-md border border-[var(--border)] px-2 py-1 text-xs hover:bg-[var(--bg-elevated)]"
                        >
                          Activos
                        </button>
                        {canWrite && (
                          <>
                            <button
                              type="button"
                              onClick={() => {
                                setEditing(n)
                                setFormOpen(true)
                              }}
                              className="rounded-md border border-[var(--border)] px-2 py-1 text-xs hover:bg-[var(--bg-elevated)]"
                            >
                              Editar
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                void confirm(
                                  `¿Eliminar el nodo «${n.name}»? Los activos se desasignan, no se borran.`,
                                  {
                                    title: 'Eliminar nodo',
                                    danger: true,
                                    confirmLabel: 'Eliminar',
                                  },
                                ).then((ok) => {
                                  if (ok) deleteMutation.mutate(n.id)
                                })
                              }}
                              className="rounded-md border border-red-500/40 px-2 py-1 text-xs text-red-300 hover:bg-red-500/10"
                            >
                              Eliminar
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </DesktopTableWrap>
        </>
      )}

      <NetworkNodeFormModal
        open={formOpen}
        node={editing}
        onClose={() => {
          setFormOpen(false)
          setEditing(null)
        }}
      />
      {assetsNode && (
        <NetworkNodeAssetsModal
          open={!!assetsNode}
          node={assetsNode}
          canWrite={canWrite}
          onClose={() => setAssetsNode(null)}
        />
      )}
    </div>
  )
}
