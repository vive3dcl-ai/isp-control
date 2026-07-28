import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import {
  downloadPortalInvoicePdf,
  portalInvoices,
  portalPayInvoice,
  type PortalInvoice,
} from '../lib/client-portal'
import { ModalPortal } from '../components/ModalPortal'

const STATUS_LABEL: Record<string, string> = {
  issued: 'Emitida',
  sent: 'Enviada',
  paid: 'Pagada',
  overdue: 'Vencida',
}

function money(total: string, currency: string) {
  const n = Number(total)
  if (!Number.isFinite(n)) return `${total} ${currency}`
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: currency || 'USD',
  }).format(n)
}

export function PortalInvoicesPage() {
  const [params] = useSearchParams()
  const [view, setView] = useState<PortalInvoice | null>(null)
  const [payError, setPayError] = useState('')

  const query = useQuery({
    queryKey: ['portal', 'invoices'],
    queryFn: portalInvoices,
  })

  const payMutation = useMutation({
    mutationFn: (id: string) => portalPayInvoice(id),
    onSuccess: (data) => {
      window.location.href = data.checkoutUrl
    },
    onError: (err: Error) => setPayError(err.message),
  })

  const invoices = query.data?.invoices ?? []
  const methods = query.data?.paymentMethods ?? []
  const mpReady = methods.some((m) => m.id === 'mercadopago' && m.configured)
  const flash =
    params.get('paid') != null
      ? 'Pago recibido. La factura se actualizará en breve.'
      : params.get('pending') != null
        ? 'Pago pendiente de confirmación.'
        : params.get('failed') != null
          ? 'El pago no se completó.'
          : null

  return (
    <div>
      <h1 className="portal-brand mb-1 text-2xl font-semibold">Facturas</h1>
      <p className="mb-6 text-sm text-[var(--portal-muted)]">
        Consulta y paga tus facturas emitidas
      </p>
      {flash && (
        <p className="mb-4 rounded-xl border border-[var(--portal-border)] bg-[var(--portal-elevated)] px-4 py-3 text-sm">
          {flash}
        </p>
      )}
      {payError && (
        <p className="mb-4 text-sm text-red-400">{payError}</p>
      )}
      <div className="overflow-x-auto rounded-2xl border border-[var(--portal-border)]">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="bg-[var(--portal-elevated)] text-[var(--portal-muted)]">
            <tr>
              <th className="px-4 py-3 font-medium">Número</th>
              <th className="px-4 py-3 font-medium">Estado</th>
              <th className="px-4 py-3 font-medium">Emisión</th>
              <th className="px-4 py-3 font-medium">Vence</th>
              <th className="px-4 py-3 font-medium">Total</th>
              <th className="px-4 py-3 font-medium">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {invoices.map((inv) => (
              <tr
                key={inv.id}
                className="border-t border-[var(--portal-border)]"
              >
                <td className="px-4 py-3 font-medium">{inv.number}</td>
                <td className="px-4 py-3">
                  <span
                    className={
                      inv.status === 'overdue'
                        ? 'text-red-400'
                        : inv.status === 'paid'
                          ? 'text-emerald-400'
                          : ''
                    }
                  >
                    {STATUS_LABEL[inv.status] ?? inv.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-[var(--portal-muted)]">
                  {inv.issueDate}
                </td>
                <td className="px-4 py-3 text-[var(--portal-muted)]">
                  {inv.dueDate || '—'}
                </td>
                <td className="px-4 py-3">
                  {money(inv.total, inv.currency)}
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setView(inv)}
                      className="rounded-lg border border-[var(--portal-border)] px-2.5 py-1 text-xs hover:bg-[var(--portal-elevated)]"
                    >
                      Ver
                    </button>
                    {inv.payable && (
                      <button
                        type="button"
                        disabled={!mpReady || payMutation.isPending}
                        title={
                          mpReady
                            ? 'Pagar con Mercado Pago'
                            : 'Sin métodos de pago activos'
                        }
                        onClick={() => {
                          setPayError('')
                          payMutation.mutate(inv.id)
                        }}
                        className="rounded-lg bg-[var(--portal-accent)] px-2.5 py-1 text-xs font-medium text-white disabled:opacity-40"
                      >
                        Pagar
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {!query.isLoading && !invoices.length && (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-8 text-center text-[var(--portal-muted)]"
                >
                  No hay facturas
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {view && (
        <ModalPortal><div className="modal-backdrop fixed inset-0 z-[100] flex items-stretch justify-center overflow-hidden bg-black/50 sm:items-center sm:p-4">
          <div className="h-[100dvh] max-h-[100dvh] w-full max-w-lg overflow-y-auto overscroll-contain rounded-none border-0 border-[var(--portal-border)] bg-[var(--portal-bg)] p-6 shadow-xl sm:h-auto sm:max-h-[min(90dvh,920px)] sm:rounded-2xl sm:border">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">{view.number}</h2>
                <p className="text-sm text-[var(--portal-muted)]">
                  {STATUS_LABEL[view.status] ?? view.status} ·{' '}
                  {money(view.total, view.currency)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setView(null)}
                className="text-[var(--portal-muted)] hover:text-[var(--portal-text)]"
              >
                Cerrar
              </button>
            </div>
            <ul className="mb-4 space-y-2 text-sm">
              {view.items.map((it) => (
                <li
                  key={it.id}
                  className="flex justify-between gap-4 border-b border-[var(--portal-border)] py-2"
                >
                  <span>{it.description}</span>
                  <span className="shrink-0">
                    {money(it.amount, view.currency)}
                  </span>
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() =>
                void downloadPortalInvoicePdf(
                  view.id,
                  `factura-${view.number}.pdf`,
                )
              }
              className="rounded-xl border border-[var(--portal-border)] px-4 py-2 text-sm hover:bg-[var(--portal-elevated)]"
            >
              Descargar PDF
            </button>
            {view.payable && mpReady && (
              <button
                type="button"
                onClick={() => payMutation.mutate(view.id)}
                className="ml-2 rounded-xl bg-[var(--portal-accent)] px-4 py-2 text-sm font-medium text-white"
              >
                Pagar
              </button>
            )}
          </div>
        </div></ModalPortal>
      )}
    </div>
  )
}
