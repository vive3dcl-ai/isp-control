import { useEffect, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthContext'
import { apiFetch } from '../lib/api'
import { adoptOrphanMapZones } from '../lib/adopt-map-zones'
import { useNotify } from './NotifyProvider'

const inputClass =
  'w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm outline-none ring-[var(--accent)] focus:ring-2'

export type Zone = {
  id: string
  name: string
  description: string
  clientCount: number
  createdAt: string
  updatedAt: string
}

type ModalMode = 'create' | 'edit'

/**
 * Catálogo de zonas (Ajustes). Independiente del perímetro en el Mapa de red:
 * aquí solo nombre y descripción; el dibujo en mapa es opcional (módulo de pago).
 */
export function ZonasSettingsTab({ canWrite }: { canWrite: boolean }) {
  const { user } = useAuth()
  const tenantKey = user?.tenantSlug ?? user?.tenantId
  const queryClient = useQueryClient()
  const { confirm } = useNotify()
  const [modal, setModal] = useState<ModalMode | null>(null)
  const [editing, setEditing] = useState<Zone | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [syncNote, setSyncNote] = useState<string | null>(null)

  const zonesQuery = useQuery({
    queryKey: ['app', 'zones'],
    queryFn: () => apiFetch<Zone[]>('/app/zones'),
  })

  // Trae al catálogo las zonas dibujadas en el mapa que aún no existen aquí.
  useEffect(() => {
    if (!zonesQuery.isSuccess || !canWrite) return
    let cancelled = false
    void (async () => {
      try {
        const result = await adoptOrphanMapZones(tenantKey, [
          ...(zonesQuery.data ?? []),
        ])
        if (cancelled) return
        if (result.created > 0) {
          setSyncNote(
            result.created === 1
              ? 'Se importó 1 zona desde el mapa.'
              : `Se importaron ${result.created} zonas desde el mapa.`,
          )
          void queryClient.invalidateQueries({ queryKey: ['app', 'zones'] })
        } else if (result.failed > 0) {
          setSyncNote(
            result.lastError
              ? `No se pudieron importar zonas del mapa: ${result.lastError}`
              : 'No se pudieron importar zonas del mapa.',
          )
        }
      } catch (e) {
        if (!cancelled) {
          setSyncNote(
            e instanceof Error
              ? e.message
              : 'Error al sincronizar zonas del mapa.',
          )
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [
    zonesQuery.isSuccess,
    zonesQuery.dataUpdatedAt,
    canWrite,
    tenantKey,
    queryClient,
  ])

  async function syncFromMap() {
    setSyncNote('Sincronizando…')
    try {
      const result = await adoptOrphanMapZones(tenantKey, [
        ...(zonesQuery.data ?? []),
      ])
      if (result.created > 0) {
        setSyncNote(
          result.created === 1
            ? 'Se importó 1 zona desde el mapa.'
            : `Se importaron ${result.created} zonas desde el mapa.`,
        )
        void queryClient.invalidateQueries({ queryKey: ['app', 'zones'] })
      } else if (result.failed > 0) {
        setSyncNote(
          result.lastError
            ? `No se pudieron importar: ${result.lastError}`
            : 'No se pudieron importar zonas del mapa.',
        )
      } else {
        setSyncNote(
          'No hay zonas nuevas en el mapa de este navegador para importar.',
        )
      }
    } catch (e) {
      setSyncNote(
        e instanceof Error ? e.message : 'Error al sincronizar zonas del mapa.',
      )
    }
  }

  const saveMutation = useMutation({
    mutationFn: (payload: { name: string; description: string }) => {
      if (editing) {
        return apiFetch<Zone>(`/app/zones/${editing.id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        })
      }
      return apiFetch<Zone>('/app/zones', {
        method: 'POST',
        body: JSON.stringify(payload),
      })
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['app', 'zones'] })
      closeModal()
    },
    onError: (e: Error) => setError(e.message),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/app/zones/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['app', 'zones'] })
      void queryClient.invalidateQueries({ queryKey: ['app', 'clients'] })
    },
  })

  function openCreate() {
    setModal('create')
    setEditing(null)
    setName('')
    setDescription('')
    setError(null)
  }

  function openEdit(z: Zone) {
    setModal('edit')
    setEditing(z)
    setName(z.name)
    setDescription(z.description ?? '')
    setError(null)
  }

  function closeModal() {
    setModal(null)
    setEditing(null)
    setError(null)
  }

  useEffect(() => {
    if (!modal) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') closeModal()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [modal])

  function submit(e: FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (trimmed.length < 2) {
      setError('El nombre debe tener al menos 2 caracteres.')
      return
    }
    setError(null)
    saveMutation.mutate({
      name: trimmed,
      description: description.trim(),
    })
  }

  async function remove(z: Zone) {
    const ok = await confirm(
      z.clientCount > 0
        ? `«${z.name}» tiene ${z.clientCount} cliente(s). Al eliminarla quedarán sin zona.`
        : `¿Eliminar la zona «${z.name}»?`,
      {
        title: 'Eliminar zona',
        danger: true,
        confirmLabel: 'Eliminar',
      },
    )
    if (ok) deleteMutation.mutate(z.id)
  }

  const zones = zonesQuery.data ?? []

  return (
    <div className="space-y-4">
      <div className="mb-2 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold">Zonas</h3>
          <p className="mt-1 max-w-2xl text-sm text-[var(--text-muted)]">
            Catálogo de zonas para organizar clientes. El perímetro en el mapa
            es opcional (módulo Mapa de red) y se dibuja aparte.
          </p>
        </div>
        {canWrite && (
          <div className="flex shrink-0 flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void syncFromMap()}
              className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-medium hover:bg-[var(--bg)]"
            >
              Importar del mapa
            </button>
            <button
              type="button"
              onClick={openCreate}
              className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)]"
            >
              Nueva zona
            </button>
          </div>
        )}
      </div>

      {zonesQuery.error && (
        <p className="text-sm text-[var(--danger)]">
          {(zonesQuery.error as Error).message}
        </p>
      )}

      {syncNote && (
        <p className="text-sm text-[var(--accent)]">{syncNote}</p>
      )}

      <div className="overflow-x-auto overflow-hidden rounded-xl border border-[var(--border)]">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="bg-[var(--bg)] text-[var(--text-muted)]">
            <tr>
              <th className="px-4 py-3 font-medium">Nombre</th>
              <th className="px-4 py-3 font-medium">Descripción</th>
              <th className="px-4 py-3 font-medium">Clientes</th>
              <th className="px-4 py-3 font-medium">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {zonesQuery.isLoading && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-[var(--text-muted)]">
                  Cargando…
                </td>
              </tr>
            )}
            {!zonesQuery.isLoading && zones.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-[var(--text-muted)]">
                  No hay zonas todavía. Crea una para asignarla a clientes.
                </td>
              </tr>
            )}
            {zones.map((z) => (
              <tr key={z.id} className="border-t border-[var(--border)]">
                <td className="px-4 py-3 font-medium">{z.name}</td>
                <td className="max-w-xs px-4 py-3 text-[var(--text-muted)]">
                  <span className="line-clamp-2">
                    {z.description || '—'}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className="tabular-nums">{z.clientCount}</span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-2">
                    {canWrite && (
                      <>
                        <button
                          type="button"
                          onClick={() => openEdit(z)}
                          className="rounded-md border border-[var(--border)] px-2.5 py-1 text-xs hover:bg-[var(--bg)]"
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          onClick={() => void remove(z)}
                          disabled={deleteMutation.isPending}
                          className="rounded-md border border-red-500/40 px-2.5 py-1 text-xs text-red-300 hover:bg-red-500/10 disabled:opacity-50"
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
      </div>

      {modal && (
        <div className="fixed inset-0 z-[600] flex items-start justify-center overflow-y-auto bg-black/60 p-3 sm:items-center sm:p-4">
          <div
            role="dialog"
            aria-modal="true"
            className="max-h-[min(92vh,100dvh)] overflow-y-auto w-full max-w-md rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] shadow-xl"
          >
            <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
              <h2 className="text-lg font-semibold">
                {modal === 'create' ? 'Nueva zona' : 'Editar zona'}
              </h2>
              <button
                type="button"
                onClick={closeModal}
                className="rounded-md px-2 py-1 text-[var(--text-muted)] hover:bg-[var(--bg)]"
              >
                ✕
              </button>
            </div>
            <form onSubmit={submit} className="space-y-4 px-5 py-4">
              <label className="block text-sm">
                <span className="mb-1 block text-[var(--text-muted)]">
                  Nombre
                </span>
                <input
                  className={inputClass}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ej. Norte, Centro…"
                  autoFocus
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-[var(--text-muted)]">
                  Descripción
                </span>
                <textarea
                  className={inputClass}
                  rows={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Sector, cobertura, notas…"
                />
              </label>
              {error && <p className="text-sm text-[var(--danger)]">{error}</p>}
              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={closeModal}
                  className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saveMutation.isPending}
                  className="rounded-lg bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                >
                  {saveMutation.isPending ? 'Guardando…' : 'Guardar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
