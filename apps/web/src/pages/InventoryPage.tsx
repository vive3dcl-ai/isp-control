import { useMemo, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'
import {
  inventoryLabel,
  type InventoryItem,
  type InventoryItemType,
} from '../lib/inventory'
import { useAuth } from '../auth/AuthContext'
import { canWriteCrm } from '../lib/crm'
import { PanelShell } from '../components/PanelShell'
import { ModalPortal } from '../components/ModalPortal'
import {
  DesktopTableWrap,
  MobileList,
  MobileListCard,
  MobileListEmpty,
  MobileListMeta,
} from '../components/MobileList'
import { useNotify } from '../components/NotifyProvider'
import { ListSearchInput, matchesSearch } from '../components/ListSearchInput'

const inputClass =
  'w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 outline-none ring-[var(--accent)] focus:ring-2'

const TYPE_LABEL: Record<InventoryItemType, string> = {
  onu: 'ONU',
  deco: 'Deco',
}

type FormState = {
  type: InventoryItemType
  brand: string
  model: string
  quantity: string
  notes: string
  isActive: boolean
}

const emptyForm: FormState = {
  type: 'onu',
  brand: '',
  model: '',
  quantity: '0',
  notes: '',
  isActive: true,
}

export function InventoryPage() {
  const { user } = useAuth()
  const canWrite = canWriteCrm(user?.tenantRole)
  const { confirm } = useNotify()
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<'' | InventoryItemType>('')
  const [modal, setModal] = useState<'create' | 'edit' | 'adjust' | null>(null)
  const [editing, setEditing] = useState<InventoryItem | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [adjustDelta, setAdjustDelta] = useState('1')
  const [adjustNote, setAdjustNote] = useState('')
  const [error, setError] = useState<string | null>(null)

  const listQuery = useQuery({
    queryKey: ['app', 'inventory', 'items'],
    queryFn: () =>
      apiFetch<{ items: InventoryItem[] }>('/app/inventory/items'),
  })

  const items = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (listQuery.data?.items ?? []).filter((i) => {
      if (typeFilter && i.type !== typeFilter) return false
      if (!q) return true
      return matchesSearch(q, i.brand, i.model, i.notes, TYPE_LABEL[i.type])
    })
  }, [listQuery.data?.items, search, typeFilter])

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ['app', 'inventory'] })
  }

  function openCreate() {
    setEditing(null)
    setForm(emptyForm)
    setError(null)
    setModal('create')
  }

  function openEdit(item: InventoryItem) {
    setEditing(item)
    setForm({
      type: item.type,
      brand: item.brand,
      model: item.model,
      quantity: String(item.quantity),
      notes: item.notes ?? '',
      isActive: item.isActive,
    })
    setError(null)
    setModal('edit')
  }

  function openAdjust(item: InventoryItem) {
    setEditing(item)
    setAdjustDelta('1')
    setAdjustNote('')
    setError(null)
    setModal('adjust')
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      const qty = Number(form.quantity)
      if (!Number.isInteger(qty) || qty < 0) {
        throw new Error('Cantidad inválida')
      }
      const body = {
        brand: form.brand.trim(),
        model: form.model.trim(),
        quantity: qty,
        notes: form.notes.trim(),
        isActive: form.isActive,
      }
      if (modal === 'create') {
        return apiFetch<InventoryItem>('/app/inventory/items', {
          method: 'POST',
          body: JSON.stringify({ ...body, type: form.type }),
        })
      }
      if (!editing) throw new Error('Sin ítem')
      return apiFetch<InventoryItem>(`/app/inventory/items/${editing.id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      })
    },
    onSuccess: () => {
      invalidate()
      setModal(null)
    },
    onError: (e: Error) => setError(e.message),
  })

  const adjustMutation = useMutation({
    mutationFn: async () => {
      if (!editing) throw new Error('Sin ítem')
      const delta = Number(adjustDelta)
      if (!Number.isInteger(delta) || delta === 0) {
        throw new Error('Delta inválido')
      }
      return apiFetch<InventoryItem>(
        `/app/inventory/items/${editing.id}/adjust`,
        {
          method: 'POST',
          body: JSON.stringify({
            delta,
            note: adjustNote.trim() || undefined,
          }),
        },
      )
    },
    onSuccess: () => {
      invalidate()
      setModal(null)
    },
    onError: (e: Error) => setError(e.message),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/app/inventory/items/${id}`, { method: 'DELETE' }),
    onSuccess: () => invalidate(),
  })

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    void saveMutation.mutateAsync()
  }

  return (
    <PanelShell
      variant="tenant"
      title="Inventario"
      subtitle="Stock de ONUs y decos por marca y modelo"
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-0 flex-1">
            <ListSearchInput
              value={search}
              onChange={setSearch}
              placeholder="Buscar marca, modelo…"
            />
          </div>
          <select
            className={`${inputClass} w-auto`}
            value={typeFilter}
            onChange={(e) =>
              setTypeFilter(e.target.value as '' | InventoryItemType)
            }
          >
            <option value="">Todos</option>
            <option value="onu">ONU</option>
            <option value="deco">Deco</option>
          </select>
          {canWrite && (
            <button
              type="button"
              onClick={openCreate}
              className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white"
            >
              Añadir equipo
            </button>
          )}
        </div>

        {listQuery.error && (
          <p className="text-sm text-[var(--danger)]">
            {(listQuery.error as Error).message}
          </p>
        )}

        <MobileList>
          {listQuery.isLoading && (
            <p className="text-sm text-[var(--text-muted)]">Cargando…</p>
          )}
          {!listQuery.isLoading && items.length === 0 && (
            <MobileListEmpty>Sin equipos en inventario.</MobileListEmpty>
          )}
          {items.map((item) => (
            <MobileListCard key={item.id}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">
                    {item.brand} {item.model}
                  </p>
                  <p className="text-xs text-[var(--text-muted)]">
                    {TYPE_LABEL[item.type]}
                  </p>
                </div>
                <span className="shrink-0 font-mono text-sm">
                  {item.quantity}
                </span>
              </div>
              <MobileListMeta>
                <span>{item.isActive ? 'Activo' : 'Inactivo'}</span>
              </MobileListMeta>
              {canWrite && (
                <div className="mt-2 flex flex-wrap gap-3">
                  <button
                    type="button"
                    className="text-xs text-[var(--accent)] hover:underline"
                    onClick={() => openEdit(item)}
                  >
                    Editar
                  </button>
                  <button
                    type="button"
                    className="text-xs text-[var(--accent)] hover:underline"
                    onClick={() => openAdjust(item)}
                  >
                    Ajuste
                  </button>
                  <button
                    type="button"
                    className="text-xs text-[var(--danger)] hover:underline"
                    onClick={() => {
                      void confirm(
                        `¿Eliminar ${inventoryLabel(item)} del inventario?`,
                        {
                          title: 'Eliminar ítem',
                          danger: true,
                          confirmLabel: 'Eliminar',
                        },
                      ).then((ok) => {
                        if (ok) void deleteMutation.mutateAsync(item.id)
                      })
                    }}
                  >
                    Eliminar
                  </button>
                </div>
              )}
            </MobileListCard>
          ))}
        </MobileList>

        <DesktopTableWrap>
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="border-b border-[var(--border)] bg-[var(--bg)] text-[var(--text-muted)]">
              <tr>
                <th className="px-3 py-2 font-medium">Tipo</th>
                <th className="px-3 py-2 font-medium">Marca</th>
                <th className="px-3 py-2 font-medium">Modelo</th>
                <th className="px-3 py-2 font-medium">Stock</th>
                <th className="px-3 py-2 font-medium">Estado</th>
                <th className="px-3 py-2 font-medium">Acción</th>
              </tr>
            </thead>
            <tbody>
              {listQuery.isLoading && (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-[var(--text-muted)]">
                    Cargando…
                  </td>
                </tr>
              )}
              {!listQuery.isLoading && items.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-[var(--text-muted)]">
                    Sin equipos en inventario.
                  </td>
                </tr>
              )}
              {items.map((item) => (
                <tr
                  key={item.id}
                  className="border-b border-[var(--border)] last:border-0"
                >
                  <td className="px-3 py-2.5">{TYPE_LABEL[item.type]}</td>
                  <td className="px-3 py-2.5 font-medium">{item.brand}</td>
                  <td className="px-3 py-2.5">{item.model}</td>
                  <td className="px-3 py-2.5 font-mono">{item.quantity}</td>
                  <td className="px-3 py-2.5">
                    {item.isActive ? 'Activo' : 'Inactivo'}
                  </td>
                  <td className="px-3 py-2.5">
                    {canWrite && (
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          className="text-xs text-[var(--accent)] hover:underline"
                          onClick={() => openEdit(item)}
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          className="text-xs text-[var(--accent)] hover:underline"
                          onClick={() => openAdjust(item)}
                        >
                          Ajuste
                        </button>
                        <button
                          type="button"
                          className="text-xs text-[var(--danger)] hover:underline"
                          onClick={() => {
                            void confirm(
                              `¿Eliminar ${inventoryLabel(item)} del inventario?`,
                              {
                                title: 'Eliminar ítem',
                                danger: true,
                                confirmLabel: 'Eliminar',
                              },
                            ).then((ok) => {
                              if (ok) void deleteMutation.mutateAsync(item.id)
                            })
                          }}
                        >
                          Eliminar
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </DesktopTableWrap>
      </div>

      {(modal === 'create' || modal === 'edit') && (
        <ModalPortal>
          <div className="fixed inset-0 z-[100] modal-backdrop flex items-center justify-center bg-black/50 p-4">
            <form
              onSubmit={onSubmit}
              className="w-full max-w-md space-y-3 rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-5 text-[var(--text)] shadow-xl"
            >
              <h3 className="text-lg font-semibold">
                {modal === 'create' ? 'Añadir equipo' : 'Editar equipo'}
              </h3>
              {modal === 'create' && (
                <label className="block text-sm">
                  <span className="mb-1 block text-[var(--text-muted)]">
                    Tipo
                  </span>
                  <select
                    className={inputClass}
                    value={form.type}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        type: e.target.value as InventoryItemType,
                      }))
                    }
                  >
                    <option value="onu">ONU</option>
                    <option value="deco">Deco</option>
                  </select>
                </label>
              )}
              <label className="block text-sm">
                <span className="mb-1 block text-[var(--text-muted)]">Marca</span>
                <input
                  className={inputClass}
                  required
                  value={form.brand}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, brand: e.target.value }))
                  }
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-[var(--text-muted)]">
                  Modelo
                </span>
                <input
                  className={inputClass}
                  required
                  value={form.model}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, model: e.target.value }))
                  }
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-[var(--text-muted)]">
                  Cantidad
                </span>
                <input
                  className={inputClass}
                  type="number"
                  min={0}
                  required
                  value={form.quantity}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, quantity: e.target.value }))
                  }
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-[var(--text-muted)]">Notas</span>
                <textarea
                  className={inputClass}
                  rows={2}
                  value={form.notes}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, notes: e.target.value }))
                  }
                />
              </label>
              <label className="inline-flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, isActive: e.target.checked }))
                  }
                />
                Activo
              </label>
              {error && <p className="text-sm text-[var(--danger)]">{error}</p>}
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm"
                  onClick={() => setModal(null)}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saveMutation.isPending}
                  className="rounded-lg bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                >
                  Guardar
                </button>
              </div>
            </form>
          </div>
        </ModalPortal>
      )}

      {modal === 'adjust' && editing && (
        <ModalPortal>
          <div className="fixed inset-0 z-[100] modal-backdrop flex items-center justify-center bg-black/50 p-4">
            <form
              onSubmit={(e) => {
                e.preventDefault()
                setError(null)
                void adjustMutation.mutateAsync()
              }}
              className="w-full max-w-sm space-y-3 rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-5 text-[var(--text)] shadow-xl"
            >
              <h3 className="text-lg font-semibold">Ajuste de stock</h3>
              <p className="text-sm text-[var(--text-muted)]">
                {TYPE_LABEL[editing.type]} · {editing.brand} {editing.model} ·
                actual {editing.quantity}
              </p>
              <label className="block text-sm">
                <span className="mb-1 block text-[var(--text-muted)]">
                  Delta (+ entrada / − salida)
                </span>
                <input
                  className={inputClass}
                  type="number"
                  required
                  value={adjustDelta}
                  onChange={(e) => setAdjustDelta(e.target.value)}
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-[var(--text-muted)]">Nota</span>
                <input
                  className={inputClass}
                  value={adjustNote}
                  onChange={(e) => setAdjustNote(e.target.value)}
                />
              </label>
              {error && <p className="text-sm text-[var(--danger)]">{error}</p>}
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm"
                  onClick={() => setModal(null)}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={adjustMutation.isPending}
                  className="rounded-lg bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                >
                  Aplicar
                </button>
              </div>
            </form>
          </div>
        </ModalPortal>
      )}
    </PanelShell>
  )
}
