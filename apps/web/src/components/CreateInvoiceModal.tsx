import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'
import {
  buildManualInvoicePreview,
  type BillingProduct,
  type BillingSettings,
} from '../lib/billing'
import type { CompanyProfile } from '../lib/company'
import { clientDisplayName, type Client } from '../lib/crm'
import { formatMoney, useCompanyCurrency } from '../lib/currency'
import { MoneyInput } from './MoneyInput'
import { ModalPortal } from './ModalPortal'

const inputClass =
  'w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm outline-none ring-[var(--accent)] focus:ring-2'

type DraftItem = {
  key: string
  description: string
  quantity: string
  unitPrice: string
  productId?: string
}

type Step = 'edit' | 'preview'

let itemSeq = 0
function newItem(partial?: Partial<DraftItem>): DraftItem {
  itemSeq += 1
  return {
    key: `it-${Date.now().toString(36)}-${itemSeq}`,
    description: '',
    quantity: '1',
    unitPrice: '0',
    ...partial,
  }
}

export function CreateInvoiceModal({
  open,
  onClose,
  clientId: fixedClientId,
  clientEmail,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  /** Si viene fijo, no se muestra el selector de cliente. */
  clientId?: string
  clientEmail?: string
  onCreated?: (result: { number: string; sentTo: string | null }) => void
}) {
  const queryClient = useQueryClient()
  const currency = useCompanyCurrency()
  const [step, setStep] = useState<Step>('edit')
  const [clientId, setClientId] = useState(fixedClientId ?? '')
  const [items, setItems] = useState<DraftItem[]>([newItem()])
  const [notes, setNotes] = useState('')
  const [sendEmail, setSendEmail] = useState(true)
  const [email, setEmail] = useState(clientEmail ?? '')
  const [productPick, setProductPick] = useState('')
  const [formError, setFormError] = useState<string | null>(null)

  const clientsQuery = useQuery({
    queryKey: ['app', 'clients'],
    queryFn: () => apiFetch<Client[]>('/app/clients'),
    enabled: open && !fixedClientId,
  })

  const fixedClientQuery = useQuery({
    queryKey: ['app', 'clients', fixedClientId],
    queryFn: () => apiFetch<Client>(`/app/clients/${fixedClientId}`),
    enabled: open && !!fixedClientId,
  })

  const productsQuery = useQuery({
    queryKey: ['app', 'billing', 'products'],
    queryFn: () =>
      apiFetch<BillingProduct[]>('/app/settings/billing/products'),
    enabled: open,
  })

  const companyQuery = useQuery({
    queryKey: ['app', 'settings', 'company'],
    queryFn: () => apiFetch<CompanyProfile>('/app/settings/company'),
    enabled: open,
    staleTime: 5 * 60_000,
  })

  const billingQuery = useQuery({
    queryKey: ['app', 'settings', 'billing'],
    queryFn: () => apiFetch<BillingSettings>('/app/settings/billing'),
    enabled: open,
    staleTime: 60_000,
  })

  const products = useMemo(
    () => (productsQuery.data ?? []).filter((p) => p.isActive),
    [productsQuery.data],
  )

  const selectedClient = useMemo(() => {
    if (fixedClientId) return fixedClientQuery.data ?? null
    return (clientsQuery.data ?? []).find((c) => c.id === clientId) ?? null
  }, [fixedClientId, fixedClientQuery.data, clientsQuery.data, clientId])

  const cleanedItems = useMemo(
    () =>
      items
        .map((it) => ({
          description: it.description.trim(),
          quantity: Number(it.quantity) || 0,
          unitPrice: Number(it.unitPrice) || 0,
          productId: it.productId,
        }))
        .filter((it) => it.description && it.quantity > 0),
    [items],
  )

  const preview = useMemo(() => {
    if (!selectedClient || cleanedItems.length === 0) return null
    const company = companyQuery.data
    return buildManualInvoicePreview({
      company: company
        ? {
            name: company.name,
            legalName: company.legalName,
            phone: company.phone,
            email: company.email,
            address: company.address,
            city: company.city,
            country: company.country,
            taxId: company.taxId,
            legalRepresentative: company.legalRepresentative,
            currency: company.currency || currency,
            logoUrl: company.logoUrl,
            invoiceFooter: company.invoiceFooter,
            invoiceDocLabel: company.invoiceDocLabel,
          }
        : { currency },
      clientName: clientDisplayName(selectedClient),
      clientEmail: email.trim() || selectedClient.email || '',
      clientPhone: selectedClient.phone,
      clientAddress: [selectedClient.street, selectedClient.city]
        .filter(Boolean)
        .join(', '),
      notes,
      dueDays: billingQuery.data?.defaultDueDays ?? 10,
      items: cleanedItems,
    })
  }, [
    selectedClient,
    cleanedItems,
    companyQuery.data,
    currency,
    email,
    notes,
    billingQuery.data?.defaultDueDays,
  ])

  useEffect(() => {
    if (!open) return
    setStep('edit')
    setClientId(fixedClientId ?? '')
    setItems([newItem()])
    setNotes('')
    setSendEmail(true)
    setEmail(clientEmail ?? '')
    setProductPick('')
    setFormError(null)
  }, [open, fixedClientId, clientEmail])

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (step === 'preview') setStep('edit')
        else onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose, step])

  const total = useMemo(
    () =>
      cleanedItems.reduce(
        (sum, it) => sum + it.quantity * it.unitPrice,
        0,
      ),
    [cleanedItems],
  )

  const mutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      apiFetch<{ number: string; sentTo: string | null }>(
        '/app/settings/billing/invoices',
        { method: 'POST', body: JSON.stringify(payload) },
      ),
    onSuccess: async (res) => {
      await queryClient.invalidateQueries({
        queryKey: ['app', 'clients', clientId, 'invoices'],
      })
      await queryClient.invalidateQueries({
        queryKey: ['app', 'settings', 'billing', 'invoices'],
      })
      onCreated?.(res)
      onClose()
    },
  })

  if (!open) return null

  function updateItem(key: string, patch: Partial<DraftItem>) {
    setItems((prev) =>
      prev.map((it) => (it.key === key ? { ...it, ...patch } : it)),
    )
  }

  function removeItem(key: string) {
    setItems((prev) =>
      prev.length <= 1 ? prev : prev.filter((it) => it.key !== key),
    )
  }

  function addProduct(id: string) {
    const product = products.find((p) => p.id === id)
    if (!product) return
    setItems((prev) => {
      const next = prev.filter(
        (it) => it.description.trim() || it.productId || Number(it.unitPrice),
      )
      return [
        ...next,
        newItem({
          description: product.name,
          unitPrice: String(product.unitPrice),
          productId: product.id,
        }),
      ]
    })
    setProductPick('')
  }

  function validateEdit(): boolean {
    setFormError(null)
    if (!clientId) {
      setFormError('Selecciona un cliente')
      return false
    }
    if (cleanedItems.length === 0) {
      setFormError('Agrega al menos un ítem con descripción y cantidad')
      return false
    }
    if (sendEmail && !email.trim()) {
      setFormError('Indica un correo para el envío o desactiva el envío')
      return false
    }
    return true
  }

  function onPreview(e: FormEvent) {
    e.preventDefault()
    if (!validateEdit()) return
    setStep('preview')
  }

  function onConfirmCreate() {
    if (!validateEdit()) {
      setStep('edit')
      return
    }
    mutation.mutate({
      clientId,
      items: cleanedItems,
      notes: notes.trim(),
      sendEmail,
      email: email.trim() || undefined,
    })
  }

  return (
    <ModalPortal>
    <div className="fixed inset-0 z-[110] modal-backdrop flex items-stretch justify-center overflow-hidden bg-black/60 sm:items-center sm:p-4">
      <div
        role="dialog"
        aria-modal="true"
        className={[
          'flex h-[100dvh] max-h-[100dvh] w-full flex-col overflow-hidden rounded-none border-0 sm:h-auto sm:max-h-[min(92dvh,920px)] sm:rounded-xl sm:border border-[var(--border)] bg-[var(--bg-elevated)] shadow-xl',
          step === 'preview' ? 'max-w-3xl' : 'max-w-2xl',
        ].join(' ')}
      >
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[var(--border)] px-4 py-3 sm:px-5 sm:py-4">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold">
              {step === 'preview' ? 'Vista previa' : 'Nueva factura'}
            </h2>
            <p className="text-xs text-[var(--text-muted)]">
              {step === 'preview'
                ? 'Revisa el documento antes de emitirlo'
                : 'Completa los ítems y revisa el preview'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-md px-2 py-1 text-[var(--text-muted)] hover:bg-[var(--bg)]"
          >
            ✕
          </button>
        </div>

        {step === 'edit' ? (
          <form
            onSubmit={onPreview}
            className="flex min-h-0 flex-1 flex-col overflow-hidden"
          >
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5">
              {!fixedClientId && (
                <label className="block text-sm">
                  <span className="mb-1 block text-[var(--text-muted)]">
                    Cliente
                  </span>
                  <select
                    className={inputClass}
                    value={clientId}
                    onChange={(e) => {
                      setClientId(e.target.value)
                      const c = (clientsQuery.data ?? []).find(
                        (x) => x.id === e.target.value,
                      )
                      if (c?.email) setEmail(c.email)
                    }}
                    disabled={clientsQuery.isLoading}
                  >
                    <option value="">
                      {clientsQuery.isLoading
                        ? 'Cargando clientes…'
                        : 'Seleccionar cliente…'}
                    </option>
                    {(clientsQuery.data ?? []).map((c) => (
                      <option key={c.id} value={c.id}>
                        {clientDisplayName(c)}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-medium">Ítems</span>
                  <div className="flex items-center gap-2">
                    <select
                      className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-xs outline-none ring-[var(--accent)] focus:ring-2"
                      value={productPick}
                      onChange={(e) => addProduct(e.target.value)}
                      disabled={products.length === 0}
                    >
                      <option value="">
                        {products.length === 0
                          ? 'Sin productos'
                          : 'Agregar producto…'}
                      </option>
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} — {formatMoney(p.unitPrice, currency)}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => setItems((prev) => [...prev, newItem()])}
                      className="rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-xs hover:border-[var(--accent)] hover:text-[var(--accent)]"
                    >
                      + Fila
                    </button>
                  </div>
                </div>

                <div className="space-y-2">
                  {items.map((it) => (
                    <div
                      key={it.key}
                      className="grid grid-cols-1 gap-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] p-2 sm:grid-cols-[1fr_5rem_8rem_auto] sm:items-center"
                    >
                      <input
                        className={inputClass}
                        placeholder="Descripción"
                        value={it.description}
                        onChange={(e) =>
                          updateItem(it.key, {
                            description: e.target.value,
                            productId: undefined,
                          })
                        }
                      />
                      <input
                        className={inputClass}
                        type="number"
                        min={0}
                        step="any"
                        placeholder="Cant."
                        value={it.quantity}
                        onChange={(e) =>
                          updateItem(it.key, { quantity: e.target.value })
                        }
                      />
                      <MoneyInput
                        className={inputClass}
                        currency={currency}
                        value={it.unitPrice}
                        onChange={(v) =>
                          updateItem(it.key, { unitPrice: v || '0' })
                        }
                      />
                      <button
                        type="button"
                        onClick={() => removeItem(it.key)}
                        disabled={items.length <= 1}
                        className="justify-self-end rounded-md px-2 py-1 text-sm text-[var(--text-muted)] hover:bg-[var(--bg-elevated)] hover:text-[var(--danger)] disabled:opacity-40"
                        aria-label="Quitar ítem"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>

                <div className="flex items-center justify-end gap-2 text-sm">
                  <span className="text-[var(--text-muted)]">Total</span>
                  <span className="text-base font-semibold">
                    {formatMoney(total, currency)}
                  </span>
                </div>
              </div>

              <label className="block text-sm">
                <span className="mb-1 block text-[var(--text-muted)]">
                  Notas (opcional)
                </span>
                <textarea
                  className={`${inputClass} min-h-[64px] resize-y`}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </label>

              <div className="space-y-2 rounded-lg border border-[var(--border)] px-3 py-3">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={sendEmail}
                    onChange={(e) => setSendEmail(e.target.checked)}
                  />
                  Enviar al crear (correo + WhatsApp si está activo)
                </label>
                {sendEmail && (
                  <label className="block text-sm">
                    <span className="mb-1 block text-[var(--text-muted)]">
                      Correo de destino
                    </span>
                    <input
                      type="email"
                      className={inputClass}
                      placeholder="cliente@correo.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </label>
                )}
              </div>

              {(formError || mutation.error) && (
                <p className="text-sm text-[var(--danger)]">
                  {formError || (mutation.error as Error)?.message}
                </p>
              )}
            </div>

            <div className="flex shrink-0 justify-end gap-2 border-t border-[var(--border)] px-4 py-3 sm:px-5">
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
                Vista previa
              </button>
            </div>
          </form>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5">
              {preview && (
                <p className="text-xs text-[var(--text-muted)]">
                  Asunto:{' '}
                  <span className="text-[var(--text)]">{preview.subject}</span>
                  {sendEmail && email.trim() ? (
                    <>
                      {' '}
                      · Se enviará a{' '}
                      <span className="text-[var(--text)]">{email.trim()}</span>
                    </>
                  ) : (
                    ' · Sin envío por correo'
                  )}
                </p>
              )}
              <div className="overflow-x-auto rounded-lg border border-[var(--border)] bg-white p-4 text-black">
                {preview ? (
                  <div
                    className="max-w-full break-words [&_*]:max-w-full [&_img]:h-auto [&_table]:w-full"
                    dangerouslySetInnerHTML={{ __html: preview.bodyHtml }}
                  />
                ) : (
                  <p className="text-sm text-slate-500">
                    No se pudo generar la vista previa.
                  </p>
                )}
              </div>
              {mutation.error && (
                <p className="text-sm text-[var(--danger)]">
                  {(mutation.error as Error).message}
                </p>
              )}
            </div>

            <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-[var(--border)] px-4 py-3 sm:px-5">
              <button
                type="button"
                onClick={() => setStep('edit')}
                disabled={mutation.isPending}
                className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm"
              >
                Volver
              </button>
              <button
                type="button"
                onClick={onConfirmCreate}
                disabled={mutation.isPending || !preview}
                className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-60"
              >
                {mutation.isPending
                  ? 'Creando…'
                  : sendEmail
                    ? 'Crear y enviar'
                    : 'Crear factura'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
    </ModalPortal>
  )
}
