import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'
import type { TenantModuleCard } from '../lib/modules'
import type { NetworkNode } from '../lib/network-nodes'
import {
  NODE_HEADER_PORT_COUNTS,
  headerPortAssetLabel,
  headerPortLinked,
  headerPortTooltip,
  type NodeHeader,
} from '../lib/node-headers'
import type { TopologyGraph } from '../lib/topology'
import { useNotify } from './NotifyProvider'
import { NodeHeaderPortModal } from './NodeHeaderPortModal'

const inputClass =
  'w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 outline-none ring-[var(--accent)] focus:ring-2'

/** Datos para crear/editar una cabecera de fibra. */
export type QueuedNodeHeader = {
  name: string
  description: string
  portCount: number
}

function HeaderFormFields({
  name,
  setName,
  portCount,
  setPortCount,
  description,
  setDescription,
  allowResize,
}: {
  name: string
  setName: (v: string) => void
  portCount: number
  setPortCount: (v: number) => void
  description: string
  setDescription: (v: string) => void
  allowResize: boolean
}) {
  return (
    <div className="space-y-3">
      <label className="block text-sm">
        <span className="mb-1 block text-[var(--text-muted)]">Nombre</span>
        <input
          required
          className={inputClass}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="ej. ODF Rack A"
        />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block text-[var(--text-muted)]">Puertos</span>
        <select
          className={inputClass}
          value={portCount}
          disabled={!allowResize}
          onChange={(e) => setPortCount(Number(e.target.value))}
        >
          {NODE_HEADER_PORT_COUNTS.map((n) => (
            <option key={n} value={n}>
              {n} puertos
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm">
        <span className="mb-1 block text-[var(--text-muted)]">
          Descripción
        </span>
        <textarea
          className={inputClass}
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </label>
    </div>
  )
}

function HeaderFormModal({
  open,
  header,
  onClose,
  onSubmit,
  pending,
  error,
}: {
  open: boolean
  header: NodeHeader | null
  onClose: () => void
  onSubmit: (data: QueuedNodeHeader) => void
  pending?: boolean
  error?: string | null
}) {
  const [name, setName] = useState('')
  const [portCount, setPortCount] = useState<number>(8)
  const [description, setDescription] = useState('')

  useEffect(() => {
    if (!open) return
    setName(header?.name ?? '')
    setPortCount(header?.portCount ?? 8)
    setDescription(header?.description ?? '')
  }, [open, header])

  if (!open) return null

  function submit() {
    if (!name.trim()) return
    onSubmit({
      name: name.trim(),
      description: description.trim(),
      portCount,
    })
  }

  return createPortal(
    <div className="fixed inset-0 z-[710] modal-backdrop flex items-stretch justify-center overflow-hidden bg-black/60 sm:items-center sm:p-4">
      <div
        role="dialog"
        aria-modal="true"
        className="h-[100dvh] max-h-[100dvh] overflow-y-auto overscroll-contain w-full max-w-md rounded-none border-0 sm:h-auto sm:max-h-[min(92dvh,920px)] sm:rounded-xl sm:border border-[var(--border)] bg-[var(--bg-elevated)] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
          <h2 className="text-lg font-semibold">
            {header ? 'Editar cabecera' : 'Nueva cabecera de fibra'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2 py-1 text-[var(--text-muted)] hover:bg-[var(--bg)]"
          >
            ✕
          </button>
        </div>
        <div className="px-5 py-4">
          <HeaderFormFields
            name={name}
            setName={setName}
            portCount={portCount}
            setPortCount={setPortCount}
            description={description}
            setDescription={setDescription}
            allowResize
          />
          {error && (
            <p className="mt-2 text-sm text-[var(--danger)]">{error}</p>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-[var(--border)] px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={pending || !name.trim()}
            onClick={submit}
            className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-60"
          >
            {pending ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

/**
 * Cabeceras de fibra (ODF) del nodo: crear, editar y asignar puertos.
 */
export function NodeHeadersSection({
  node,
  canWrite,
}: {
  node: NetworkNode
  canWrite: boolean
}) {
  const queryClient = useQueryClient()
  const { confirm } = useNotify()
  const [formOpen, setFormOpen] = useState(false)
  const [editingHeader, setEditingHeader] = useState<NodeHeader | null>(null)
  const [portPick, setPortPick] = useState<{
    header: NodeHeader
    index: number
  } | null>(null)

  const modulesQuery = useQuery({
    queryKey: ['app', 'settings', 'modules'],
    queryFn: () => apiFetch<TenantModuleCard[]>('/app/settings/modules'),
    staleTime: 60_000,
  })
  const mapContracted = !!modulesQuery.data?.find(
    (m) => m.id === 'mapa_red',
  )?.contracted

  const headersQuery = useQuery({
    queryKey: ['app', 'network-nodes', node.id, 'headers'],
    queryFn: () =>
      apiFetch<NodeHeader[]>(`/app/network-nodes/${node.id}/headers`),
  })
  const headers = headersQuery.data ?? []

  const topologyQuery = useQuery({
    queryKey: ['app', 'topology'],
    queryFn: () => apiFetch<TopologyGraph>('/app/topology'),
    staleTime: 60_000,
  })
  const deviceNameById = useMemo(() => {
    const map = new Map<string, string>()
    for (const d of topologyQuery.data?.devices ?? []) {
      map.set(d.id, d.name)
    }
    return map
  }, [topologyQuery.data])

  const invalidate = () => {
    void queryClient.invalidateQueries({
      queryKey: ['app', 'network-nodes', node.id, 'headers'],
    })
  }

  const createMutation = useMutation({
    mutationFn: (data: QueuedNodeHeader) =>
      apiFetch<NodeHeader>(`/app/network-nodes/${node.id}/headers`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      invalidate()
      setFormOpen(false)
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: QueuedNodeHeader }) =>
      apiFetch<NodeHeader>(`/app/network-nodes/${node.id}/headers/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      invalidate()
      setFormOpen(false)
      setEditingHeader(null)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/app/network-nodes/${node.id}/headers/${id}`, {
        method: 'DELETE',
      }),
    onSuccess: invalidate,
  })

  return (
    <div className="space-y-3 rounded-lg border border-[var(--border)] bg-[var(--bg)] p-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium">Cabeceras de fibra</p>
          <p className="text-xs text-[var(--text-muted)]">
            ODF con puertos enlazables a puertos PON de OLT o de router.
          </p>
        </div>
        {canWrite && (
          <button
            type="button"
            onClick={() => {
              setEditingHeader(null)
              setFormOpen(true)
            }}
            className="shrink-0 rounded-lg border border-[var(--accent)] px-3 py-1.5 text-sm font-medium text-[var(--accent)] hover:bg-[var(--accent)]/10"
          >
            Añadir cabecera
          </button>
        )}
      </div>

      {headersQuery.isLoading && (
        <p className="text-xs text-[var(--text-muted)]">Cargando cabeceras…</p>
      )}
      {!headersQuery.isLoading && headers.length === 0 && (
        <p className="rounded-lg border border-dashed border-[var(--border)] px-3 py-4 text-center text-xs text-[var(--text-muted)]">
          Sin cabeceras. Añade una para gestionar sus puertos.
        </p>
      )}
      {headers.map((h) => (
        <div
          key={h.id}
          className="rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] p-3"
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <div>
              <p className="text-sm font-semibold">{h.name}</p>
              <p className="text-[11px] text-[var(--text-muted)]">
                {h.portCount} puertos ·{' '}
                {h.ports.filter(headerPortLinked).length} enlazados
                {h.description ? ` · ${h.description}` : ''}
              </p>
            </div>
            {canWrite && (
              <div className="flex shrink-0 gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setEditingHeader(h)
                    setFormOpen(true)
                  }}
                  className="rounded-md border border-[var(--border)] px-2 py-1 text-xs hover:bg-[var(--bg)]"
                >
                  Editar
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void confirm(
                      `¿Eliminar la cabecera «${h.name}» y sus asignaciones de puertos?`,
                      {
                        title: 'Eliminar cabecera',
                        danger: true,
                        confirmLabel: 'Eliminar',
                      },
                    ).then((ok) => {
                      if (ok) deleteMutation.mutate(h.id)
                    })
                  }}
                  className="rounded-md border border-red-500/40 px-2 py-1 text-xs text-red-300 hover:bg-red-500/10"
                >
                  Eliminar
                </button>
              </div>
            )}
          </div>
          <div className="grid w-full grid-cols-4 gap-1.5 sm:grid-cols-6 md:grid-cols-8">
            {h.ports.map((p) => {
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
                  })}
                  onClick={() => setPortPick({ header: h, index: p.index })}
                  className={[
                    'flex min-h-[2.75rem] w-full flex-col items-center justify-center gap-0.5 rounded-md border px-1 py-1.5 text-center text-[11px] font-medium transition-colors',
                    linked
                      ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-300'
                      : 'border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--bg)]',
                  ].join(' ')}
                >
                  {assetLabel && (
                    <span className="max-w-full truncate text-[9px] leading-tight opacity-80">
                      {assetLabel}
                    </span>
                  )}
                  <span>{p.index}</span>
                </button>
              )
            })}
          </div>
        </div>
      ))}

      <HeaderFormModal
        open={formOpen}
        header={editingHeader}
        pending={createMutation.isPending || updateMutation.isPending}
        error={
          ((createMutation.error ?? updateMutation.error) as Error | null)
            ?.message ?? null
        }
        onClose={() => {
          setFormOpen(false)
          setEditingHeader(null)
        }}
        onSubmit={(data) => {
          if (editingHeader) {
            updateMutation.mutate({ id: editingHeader.id, data })
          } else {
            createMutation.mutate(data)
          }
        }}
      />

      <NodeHeaderPortModal
        open={!!portPick}
        nodeId={node.id}
        header={
          portPick
            ? (headers.find((x) => x.id === portPick.header.id) ??
              portPick.header)
            : null
        }
        portIndex={portPick?.index ?? null}
        canWrite={canWrite}
        mapContracted={mapContracted}
        onClose={() => setPortPick(null)}
      />
    </div>
  )
}
