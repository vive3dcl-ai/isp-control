import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'
import {
  TEMPLATE_TYPE_LABELS,
  type Invoice,
  type InvoiceTemplateType,
} from '../lib/billing'
import { useMoney } from '../lib/currency'
import { useNotify } from './NotifyProvider'
import { CreateInvoiceModal } from './CreateInvoiceModal'

export type InvoiceView = Invoice & {
  clientEmail: string
  clientName: string
  subject: string
  bodyHtml: string
}

const STATUS_LABEL: Record<string, string> = {
  draft: 'Borrador',
  issued: 'Emitida',
  sent: 'Enviada',
  paid: 'Pagada',
  void: 'Anulada',
  overdue: 'Vencida',
}

export function invoiceStatusLabel(status: string) {
  return STATUS_LABEL[status] ?? status
}

export function invoiceTypeLabel(type: string) {
  return (
    TEMPLATE_TYPE_LABELS[type as InvoiceTemplateType] ?? type
  )
}

export function ClientInvoicesSection({
  clientId,
  clientEmail,
  canWrite,
}: {
  clientId: string
  clientEmail: string
  canWrite: boolean
}) {
  const money = useMoney()
  const { alert } = useNotify()
  const queryClient = useQueryClient()
  const [viewId, setViewId] = useState<string | null>(null)
  const [resend, setResend] = useState<Invoice | null>(null)
  const [createOpen, setCreateOpen] = useState(false)

  const invoicesQuery = useQuery({
    queryKey: ['app', 'clients', clientId, 'invoices'],
    queryFn: () =>
      apiFetch<Invoice[]>(`/app/clients/${clientId}/invoices`),
  })

  const invoices = invoicesQuery.data ?? []

  return (
    <section className="mt-8">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h3 className="text-base font-semibold">Facturas</h3>
        {canWrite && (
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="shrink-0 rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-white hover:bg-[var(--accent-hover)]"
          >
            Nueva factura
          </button>
        )}
      </div>

      <div className="overflow-x-auto overflow-hidden rounded-xl border border-[var(--border)]">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="bg-[var(--bg)] text-[var(--text-muted)]">
            <tr>
              <th className="px-4 py-3 font-medium">Número</th>
              <th className="px-4 py-3 font-medium">Tipo</th>
              <th className="px-4 py-3 font-medium">Período</th>
              <th className="px-4 py-3 font-medium">Emisión</th>
              <th className="px-4 py-3 font-medium">Estado</th>
              <th className="px-4 py-3 font-medium">Total</th>
              <th className="w-0 whitespace-nowrap px-4 py-3 text-right font-medium">
                Acciones
              </th>
            </tr>
          </thead>
          <tbody>
            {invoicesQuery.isLoading && (
              <tr>
                <td
                  colSpan={7}
                  className="px-4 py-6 text-[var(--text-muted)]"
                >
                  Cargando facturas…
                </td>
              </tr>
            )}
            {!invoicesQuery.isLoading && invoices.length === 0 && (
              <tr>
                <td
                  colSpan={7}
                  className="px-4 py-6 text-[var(--text-muted)]"
                >
                  Aún no hay facturas generadas para este cliente.
                </td>
              </tr>
            )}
            {invoices.map((inv) => (
              <tr key={inv.id} className="border-t border-[var(--border)]">
                <td className="px-4 py-3 font-medium">{inv.number}</td>
                <td className="px-4 py-3">{invoiceTypeLabel(inv.type)}</td>
                <td className="px-4 py-3 whitespace-nowrap text-[var(--text-muted)]">
                  {inv.periodStart && inv.periodEnd
                    ? `${inv.periodStart} → ${inv.periodEnd}`
                    : '—'}
                </td>
                <td className="px-4 py-3 whitespace-nowrap">{inv.issueDate}</td>
                <td className="px-4 py-3">
                  {invoiceStatusLabel(inv.status)}
                </td>
                <td className="px-4 py-3 whitespace-nowrap">
                  {money(Number(inv.total))}
                </td>
                <td className="w-0 whitespace-nowrap px-4 py-3 text-right">
                  <div className="inline-flex flex-nowrap justify-end gap-1.5">
                    <button
                      type="button"
                      onClick={() => setViewId(inv.id)}
                      className="rounded-md border border-[var(--border)] px-2.5 py-1 text-xs hover:border-[var(--accent)] hover:text-[var(--accent)]"
                    >
                      Ver
                    </button>
                    {canWrite && (
                      <button
                        type="button"
                        onClick={() => setResend(inv)}
                        className="rounded-md bg-[var(--accent)] px-2.5 py-1 text-xs font-medium text-white hover:bg-[var(--accent-hover)]"
                      >
                        Reenviar
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {createOpen && (
        <CreateInvoiceModal
          open={createOpen}
          clientId={clientId}
          clientEmail={clientEmail}
          onClose={() => setCreateOpen(false)}
          onCreated={async (res) => {
            await queryClient.invalidateQueries({
              queryKey: ['app', 'clients', clientId, 'invoices'],
            })
            await alert(
              res.sentTo
                ? `Factura ${res.number} creada y enviada a ${res.sentTo}`
                : `Factura ${res.number} creada`,
              { title: 'Factura creada', variant: 'success' },
            )
          }}
        />
      )}
      {viewId && (
        <InvoiceViewModal
          invoiceId={viewId}
          onClose={() => setViewId(null)}
        />
      )}
      {resend && (
        <InvoiceResendModal
          invoice={resend}
          defaultEmail={clientEmail}
          onClose={() => setResend(null)}
          onSent={async (sentTo) => {
            setResend(null)
            await queryClient.invalidateQueries({
              queryKey: ['app', 'clients', clientId, 'invoices'],
            })
            await alert(`Factura ${resend.number} enviada a ${sentTo}`, {
              title: 'Correo enviado',
              variant: 'success',
            })
          }}
        />
      )}
    </section>
  )
}

function InvoiceViewModal({
  invoiceId,
  onClose,
}: {
  invoiceId: string
  onClose: () => void
}) {
  const viewQuery = useQuery({
    queryKey: ['app', 'billing', 'invoices', invoiceId],
    queryFn: () =>
      apiFetch<InvoiceView>(`/app/settings/billing/invoices/${invoiceId}`),
  })

  return (
    <div className="fixed inset-0 z-[1000] flex items-start justify-center overflow-y-auto p-3 sm:items-center sm:p-4">
      <button
        type="button"
        className="absolute inset-0 bg-black/60"
        aria-label="Cerrar"
        onClick={onClose}
      />
      <div className="relative flex max-h-[min(92vh,100dvh)] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] shadow-xl">
        <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
          <div>
            <h3 className="text-base font-semibold">
              {viewQuery.data
                ? `${viewQuery.data.number}`
                : 'Factura'}
            </h3>
            {viewQuery.data && (
              <p className="text-xs text-[var(--text-muted)]">
                {viewQuery.data.subject}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm hover:bg-[var(--bg)]"
          >
            Cerrar
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-auto bg-white p-4 text-black">
          {viewQuery.isLoading && (
            <p className="text-sm text-slate-500">Cargando…</p>
          )}
          {viewQuery.error && (
            <p className="text-sm text-red-600">
              {(viewQuery.error as Error).message}
            </p>
          )}
          {viewQuery.data && (
            <div
              className="max-w-full break-words [&_*]:max-w-full [&_img]:h-auto [&_table]:block [&_table]:w-full [&_table]:overflow-x-auto"
              dangerouslySetInnerHTML={{ __html: viewQuery.data.bodyHtml }}
            />
          )}
        </div>
      </div>
    </div>
  )
}

function InvoiceResendModal({
  invoice,
  defaultEmail,
  onClose,
  onSent,
}: {
  invoice: Invoice
  defaultEmail: string
  onClose: () => void
  onSent: (sentTo: string) => void | Promise<void>
}) {
  const { alert } = useNotify()
  const [email, setEmail] = useState(defaultEmail || '')

  useEffect(() => {
    setEmail(defaultEmail || '')
  }, [defaultEmail, invoice.id])

  const sendMutation = useMutation({
    mutationFn: () =>
      apiFetch<{ ok: boolean; sentTo: string }>(
        `/app/settings/billing/invoices/${invoice.id}/send`,
        {
          method: 'POST',
          body: JSON.stringify({ email: email.trim() }),
        },
      ),
    onSuccess: async (res) => {
      await onSent(res.sentTo)
    },
    onError: async (err) => {
      await alert((err as Error).message, {
        title: 'No se pudo enviar',
        variant: 'error',
      })
    },
  })

  return (
    <div className="fixed inset-0 z-[1000] flex items-start justify-center overflow-y-auto p-3 sm:items-center sm:p-4">
      <button
        type="button"
        className="absolute inset-0 bg-black/60"
        aria-label="Cerrar"
        onClick={onClose}
      />
      <div className="max-h-[min(92vh,100dvh)] overflow-y-auto relative w-full max-w-md rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-5 shadow-xl">
        <h3 className="text-base font-semibold">Reenviar factura</h3>
        <p className="mt-2 text-sm text-[var(--text-muted)]">
          Se enviará la factura <strong className="text-[var(--text)]">{invoice.number}</strong> por
          correo. Confirma o corrige el correo de destino por si no llegó.
        </p>
        <label className="mt-4 block text-sm">
          <span className="mb-1 block text-[var(--text-muted)]">
            Correo de envío
          </span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoFocus
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm outline-none ring-[var(--accent)] focus:ring-2"
            placeholder="cliente@ejemplo.com"
          />
        </label>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm hover:bg-[var(--bg)]"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={!email.trim() || sendMutation.isPending}
            onClick={() => sendMutation.mutate()}
            className="rounded-lg bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-50"
          >
            {sendMutation.isPending ? 'Enviando…' : 'Enviar'}
          </button>
        </div>
      </div>
    </div>
  )
}
