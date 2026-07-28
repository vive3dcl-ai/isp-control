import { useEffect, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'
import type { BillingProduct } from '../lib/billing'
import { useCompanyCurrency, useMoney } from '../lib/currency'
import { MoneyInput } from './MoneyInput'
import { useNotify } from './NotifyProvider'
import { ModalPortal } from './ModalPortal'

const inputClass =
  'w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 outline-none ring-[var(--accent)] focus:ring-2'

export function ProductosSettingsTab({ canWrite }: { canWrite: boolean }) {
  const { confirm } = useNotify()
  const queryClient = useQueryClient()
  const money = useMoney()
  const [createOpen, setCreateOpen] = useState(false)
  const [editProduct, setEditProduct] = useState<BillingProduct | null>(null)

  const productsQuery = useQuery({
    queryKey: ['app', 'billing', 'products'],
    queryFn: () =>
      apiFetch<BillingProduct[]>('/app/settings/billing/products'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/app/settings/billing/products/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ['app', 'billing', 'products'],
      })
    },
  })

  const products = productsQuery.data ?? []

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-[var(--text-muted)]">
          Ítems reutilizables para las facturas manuales (equipos, cargos,
          servicios puntuales, etc.).
        </p>
        {canWrite && (
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="shrink-0 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)]"
          >
            Nuevo producto
          </button>
        )}
      </div>

      {productsQuery.error && (
        <p className="text-sm text-[var(--danger)]">
          {(productsQuery.error as Error).message}
        </p>
      )}

      <div className="overflow-x-auto overflow-hidden rounded-xl border border-[var(--border)]">
        <table className="w-full min-w-[560px] text-left text-sm">
          <thead className="bg-[var(--bg)] text-[var(--text-muted)]">
            <tr>
              <th className="px-4 py-3 font-medium">Nombre</th>
              <th className="px-4 py-3 font-medium">Precio</th>
              <th className="px-4 py-3 font-medium">Estado</th>
              <th className="w-0 whitespace-nowrap px-4 py-3 text-right font-medium">
                Acciones
              </th>
            </tr>
          </thead>
          <tbody>
            {productsQuery.isLoading && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-[var(--text-muted)]">
                  Cargando…
                </td>
              </tr>
            )}
            {!productsQuery.isLoading && products.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-[var(--text-muted)]">
                  No hay productos todavía.
                </td>
              </tr>
            )}
            {products.map((p) => (
              <tr key={p.id} className="border-t border-[var(--border)]">
                <td className="px-4 py-3">
                  <div className="font-medium">{p.name}</div>
                  {p.description && (
                    <div className="text-xs text-[var(--text-muted)]">
                      {p.description}
                    </div>
                  )}
                </td>
                <td className="px-4 py-3">{money(p.unitPrice)}</td>
                <td className="px-4 py-3">
                  {p.isActive ? 'Activo' : 'Inactivo'}
                </td>
                <td className="px-4 py-3 text-right">
                  {canWrite && (
                    <div className="flex flex-wrap justify-end gap-1.5">
                      <button
                        type="button"
                        onClick={() => setEditProduct(p)}
                        className="rounded-md border border-[var(--border)] px-2.5 py-1 text-xs hover:border-[var(--accent)] hover:text-[var(--accent)]"
                      >
                        Editar
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          void confirm(`¿Eliminar el producto ${p.name}?`, {
                            title: 'Eliminar producto',
                            danger: true,
                            confirmLabel: 'Eliminar',
                          }).then((ok) => {
                            if (ok) deleteMutation.mutate(p.id)
                          })
                        }}
                        className="rounded-md border border-[var(--border)] px-2.5 py-1 text-xs text-[var(--danger)] hover:border-[var(--danger)]"
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
      </div>

      <ProductFormModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
      />
      <ProductFormModal
        open={!!editProduct}
        product={editProduct}
        onClose={() => setEditProduct(null)}
      />
    </div>
  )
}

type ProductForm = {
  name: string
  description: string
  unitPrice: string
  isActive: boolean
}

const empty: ProductForm = {
  name: '',
  description: '',
  unitPrice: '0',
  isActive: true,
}

function ProductFormModal({
  open,
  onClose,
  product,
}: {
  open: boolean
  onClose: () => void
  product?: BillingProduct | null
}) {
  const queryClient = useQueryClient()
  const currency = useCompanyCurrency()
  const [form, setForm] = useState<ProductForm>(empty)

  useEffect(() => {
    if (!open) return
    if (product) {
      setForm({
        name: product.name,
        description: product.description,
        unitPrice: String(product.unitPrice),
        isActive: product.isActive,
      })
    } else {
      setForm(empty)
    }
  }, [open, product])

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const mutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => {
      if (product) {
        return apiFetch(`/app/settings/billing/products/${product.id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        })
      }
      return apiFetch('/app/settings/billing/products', {
        method: 'POST',
        body: JSON.stringify(payload),
      })
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ['app', 'billing', 'products'],
      })
      onClose()
    },
  })

  if (!open) return null

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    mutation.mutate({
      name: form.name.trim(),
      description: form.description.trim(),
      unitPrice: Number(form.unitPrice || 0),
      isActive: form.isActive,
    })
  }

  function set<K extends keyof ProductForm>(key: K, value: ProductForm[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  return (
    <ModalPortal><div className="fixed inset-0 z-[100] modal-backdrop flex items-stretch justify-center overflow-hidden bg-black/60 sm:items-center sm:p-4">
      <div
        role="dialog"
        aria-modal="true"
        className="flex h-[100dvh] max-h-[100dvh] w-full max-w-md flex-col overflow-hidden rounded-none border-0 sm:h-auto sm:max-h-[min(92dvh,920px)] sm:rounded-xl sm:border border-[var(--border)] bg-[var(--bg-elevated)] shadow-xl"
      >
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[var(--border)] px-4 py-3 sm:px-5 sm:py-4">
          <h2 className="text-lg font-semibold">
            {product ? 'Editar producto' : 'Nuevo producto'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-md px-2 py-1 text-[var(--text-muted)] hover:bg-[var(--bg)]"
          >
            ✕
          </button>
        </div>

        <form
          onSubmit={onSubmit}
          className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5"
        >
          <label className="block text-sm">
            <span className="mb-1 block text-[var(--text-muted)]">Nombre</span>
            <input
              required
              className={inputClass}
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
            />
          </label>

          <label className="block text-sm">
            <span className="mb-1 block text-[var(--text-muted)]">
              Descripción (opcional)
            </span>
            <textarea
              className={`${inputClass} min-h-[72px] resize-y`}
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
            />
          </label>

          <label className="block text-sm">
            <span className="mb-1 block text-[var(--text-muted)]">
              Precio unitario ({currency})
            </span>
            <MoneyInput
              required
              className={inputClass}
              currency={currency}
              value={form.unitPrice}
              onChange={(v) => set('unitPrice', v || '0')}
            />
          </label>

          <label className="inline-flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(e) => set('isActive', e.target.checked)}
            />
            Activo
          </label>

          {mutation.error && (
            <p className="text-sm text-[var(--danger)]">
              {(mutation.error as Error).message}
            </p>
          )}

          <div className="flex justify-end gap-2 border-t border-[var(--border)] pt-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={mutation.isPending}
              className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-60"
            >
              {mutation.isPending ? 'Guardando…' : 'Guardar'}
            </button>
          </div>
        </form>
      </div>
    </div></ModalPortal>
  )
}
