import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'
import {
  INVOICE_STATUS_LABEL,
  TEMPLATE_TYPE_LABELS,
  type AccountingOverview,
  type Invoice,
  type InvoiceTemplateType,
} from '../lib/billing'
import { formatMoney, useCompanyCurrency } from '../lib/currency'
import { PanelShell } from '../components/PanelShell'
import {
  InvoiceViewModal,
  invoiceStatusLabel,
  invoiceTypeLabel,
} from '../components/ClientInvoicesSection'
import {
  ListSearchInput,
  matchesSearch,
} from '../components/ListSearchInput'

const MONTH_NAMES = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
]

function formatMonthKey(key: string): string {
  const [y, m] = key.split('-').map(Number)
  if (!y || !m) return key
  return `${MONTH_NAMES[m - 1]} ${y}`
}

type StatusFilter =
  | ''
  | 'paid'
  | 'pending'
  | 'overdue'
  | 'issued'
  | 'sent'
  | 'draft'
  | 'void'

function matchesStatus(inv: Invoice, filter: StatusFilter): boolean {
  if (!filter) return true
  if (filter === 'pending') {
    return (
      inv.status === 'issued' ||
      inv.status === 'sent' ||
      inv.status === 'overdue'
    )
  }
  return inv.status === filter
}

function statusFromView(view: string | null): StatusFilter {
  if (view === 'sales') return 'paid'
  if (view === 'receivables') return 'pending'
  return ''
}

export function AccountingPage() {
  const currency = useCompanyCurrency()
  const [searchParams, setSearchParams] = useSearchParams()
  const [search, setSearch] = useState('')
  const [viewId, setViewId] = useState<string | null>(null)

  const overviewQuery = useQuery({
    queryKey: ['app', 'accounting'],
    queryFn: () => apiFetch<AccountingOverview>('/app/accounting'),
  })

  const data = overviewQuery.data
  const kpis = data?.kpis

  const monthFilter =
    searchParams.get('month') ||
    (searchParams.get('view') === 'sales'
      ? (data?.currentMonth ?? '')
      : '')
  const statusFilter = (searchParams.get('status') ||
    statusFromView(searchParams.get('view')) ||
    '') as StatusFilter
  const typeFilter = searchParams.get('type') || ''

  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams)
    next.delete('view')
    if (value) next.set(key, value)
    else next.delete(key)
    setSearchParams(next, { replace: true })
  }

  const filtered = useMemo(() => {
    const rows = data?.invoices ?? []
    return rows.filter((inv) => {
      if (monthFilter && !inv.issueDate.startsWith(monthFilter)) return false
      if (!matchesStatus(inv, statusFilter)) return false
      if (typeFilter && inv.type !== typeFilter) return false
      return matchesSearch(
        search,
        inv.number,
        inv.clientName,
        inv.clientEmail,
        invoiceStatusLabel(inv.status),
        invoiceTypeLabel(inv.type),
        inv.issueDate,
      )
    })
  }, [data?.invoices, monthFilter, statusFilter, typeFilter, search])

  const grouped = useMemo(() => {
    const map = new Map<string, Invoice[]>()
    for (const inv of filtered) {
      const key = inv.issueDate.slice(0, 7) || 'sin-fecha'
      const list = map.get(key) ?? []
      list.push(inv)
      map.set(key, list)
    }
    return [...map.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1))
  }, [filtered])

  const monthOptions = data?.months ?? []
  const types = useMemo(() => {
    const set = new Set((data?.invoices ?? []).map((i) => i.type))
    return [...set].sort()
  }, [data?.invoices])

  const filteredTotal = filtered.reduce(
    (sum, inv) =>
      inv.status === 'void' || inv.status === 'draft'
        ? sum
        : sum + (Number(inv.total) || 0),
    0,
  )

  return (
    <PanelShell
      title="Contabilidad"
      subtitle="Facturación, cobranza y cuentas por cobrar"
      variant="tenant"
    >
      {overviewQuery.error && (
        <p className="mb-4 text-sm text-[var(--danger)]">
          {overviewQuery.error.message}
        </p>
      )}

      <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Ventas del mes"
          value={formatMoney(kpis?.salesThisMonth ?? 0, currency)}
          hint={`${kpis?.paidCountThisMonth ?? 0} facturas pagadas`}
          active={statusFilter === 'paid' && monthFilter === data?.currentMonth}
          onClick={() => {
            const next = new URLSearchParams()
            next.set('status', 'paid')
            if (data?.currentMonth) next.set('month', data.currentMonth)
            setSearchParams(next, { replace: true })
          }}
        />
        <KpiCard
          label="Cuentas por cobrar"
          value={formatMoney(kpis?.estimatedEarnings ?? 0, currency)}
          hint={`${kpis?.openInvoiceCount ?? 0} facturas abiertas`}
          active={statusFilter === 'pending'}
          onClick={() => {
            const next = new URLSearchParams()
            next.set('status', 'pending')
            setSearchParams(next, { replace: true })
          }}
        />
        <KpiCard
          label="Vencidas"
          value={formatMoney(kpis?.overdueTotal ?? 0, currency)}
          hint="Mora pendiente de cobro"
          active={statusFilter === 'overdue'}
          onClick={() => setFilter('status', 'overdue')}
        />
        <KpiCard
          label="Facturado del mes"
          value={formatMoney(kpis?.invoicedThisMonth ?? 0, currency)}
          hint={`Cobranza ${kpis?.collectionRateThisMonth ?? 0}%`}
          active={
            !statusFilter && monthFilter === data?.currentMonth && !typeFilter
          }
          onClick={() => {
            const next = new URLSearchParams()
            if (data?.currentMonth) next.set('month', data.currentMonth)
            setSearchParams(next, { replace: true })
          }}
        />
      </dl>

      <div className="mt-6 space-y-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <ListSearchInput
            value={search}
            onChange={setSearch}
            placeholder="Buscar factura, cliente, número…"
            className="lg:max-w-sm"
          />
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={monthFilter}
              onChange={(e) => setFilter('month', e.target.value)}
              className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm"
            >
              <option value="">Todos los meses</option>
              {monthOptions.map((m) => (
                <option key={m.key} value={m.key}>
                  {formatMonthKey(m.key)} ({m.invoiceCount})
                </option>
              ))}
            </select>
            <select
              value={typeFilter}
              onChange={(e) => setFilter('type', e.target.value)}
              className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm"
            >
              <option value="">Todos los tipos</option>
              {types.map((t) => (
                <option key={t} value={t}>
                  {TEMPLATE_TYPE_LABELS[t as InvoiceTemplateType] ?? t}
                </option>
              ))}
            </select>
            {(monthFilter || statusFilter || typeFilter || search.trim()) && (
              <button
                type="button"
                onClick={() => setSearchParams({}, { replace: true })}
                className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm text-[var(--text-muted)] hover:text-[var(--text)]"
              >
                Limpiar filtros
              </button>
            )}
          </div>
        </div>

        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {(
            [
              ['', 'Todas'],
              ['pending', 'Por cobrar'],
              ['paid', 'Pagadas'],
              ['overdue', 'Vencidas'],
              ['sent', 'Enviadas'],
              ['issued', 'Emitidas'],
              ['draft', 'Borrador'],
              ['void', 'Anuladas'],
            ] as const
          ).map(([value, label]) => (
            <FilterChip
              key={value || 'all'}
              active={statusFilter === value}
              label={label}
              onClick={() => setFilter('status', value)}
            />
          ))}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-baseline justify-between gap-2 text-sm text-[var(--text-muted)]">
        <p>
          {overviewQuery.isLoading
            ? 'Cargando…'
            : `${filtered.length} factura${filtered.length === 1 ? '' : 's'}`}
          {!overviewQuery.isLoading && filtered.length > 0 && (
            <span>
              {' '}
              · Total filtrado{' '}
              <span className="font-medium text-[var(--text)]">
                {formatMoney(filteredTotal, currency)}
              </span>
            </span>
          )}
        </p>
        <Link
          to="/app/settings?tab=facturacion"
          className="text-[var(--accent)] hover:underline"
        >
          Ajustes de facturación
        </Link>
      </div>

      <div className="mt-4 space-y-6">
        {!overviewQuery.isLoading && filtered.length === 0 && (
          <p className="rounded-xl border border-dashed border-[var(--border)] px-4 py-10 text-center text-sm text-[var(--text-muted)]">
            No hay facturas con esos filtros.
          </p>
        )}

        {grouped.map(([monthKey, invoices]) => {
          const monthTotal = invoices.reduce(
            (sum, inv) =>
              inv.status === 'void' || inv.status === 'draft'
                ? sum
                : sum + (Number(inv.total) || 0),
            0,
          )
          return (
            <section key={monthKey}>
              <div className="mb-2 flex items-baseline justify-between gap-3">
                <h2 className="text-sm font-semibold tracking-wide text-[var(--text)] uppercase">
                  {monthKey === 'sin-fecha'
                    ? 'Sin fecha'
                    : formatMonthKey(monthKey)}
                </h2>
                <p className="text-xs text-[var(--text-muted)]">
                  {invoices.length} · {formatMoney(monthTotal, currency)}
                </p>
              </div>

              {/* Mobile cards */}
              <div className="space-y-2 md:hidden">
                {invoices.map((inv) => (
                  <article
                    key={inv.id}
                    className="rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2.5"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">
                          {inv.number}
                        </p>
                        <Link
                          to={`/app/clients/${inv.clientId}`}
                          className="truncate text-xs text-[var(--accent)] hover:underline"
                        >
                          {inv.clientName || 'Cliente'}
                        </Link>
                      </div>
                      <StatusPill status={inv.status} />
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-[var(--text-muted)]">
                      <span>
                        {invoiceTypeLabel(inv.type)} · {inv.issueDate}
                      </span>
                      <span className="font-medium text-[var(--text)]">
                        {formatMoney(
                          Number(inv.total),
                          inv.currency || currency,
                        )}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setViewId(inv.id)}
                      className="mt-2 text-xs font-medium text-[var(--accent)] hover:underline"
                    >
                      Ver factura
                    </button>
                  </article>
                ))}
              </div>

              {/* Desktop table */}
              <div className="hidden overflow-x-auto overflow-hidden rounded-xl border border-[var(--border)] md:block">
                <table className="w-full min-w-[880px] text-left text-sm">
                  <thead className="bg-[var(--bg)] text-[var(--text-muted)]">
                    <tr>
                      <th className="px-4 py-3 font-medium">Número</th>
                      <th className="px-4 py-3 font-medium">Cliente</th>
                      <th className="px-4 py-3 font-medium">Tipo</th>
                      <th className="px-4 py-3 font-medium">Emisión</th>
                      <th className="px-4 py-3 font-medium">Vence</th>
                      <th className="px-4 py-3 font-medium">Estado</th>
                      <th className="px-4 py-3 font-medium text-right">
                        Total
                      </th>
                      <th className="w-0 px-4 py-3 text-right font-medium">
                        Acciones
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoices.map((inv) => (
                      <tr
                        key={inv.id}
                        className="border-t border-[var(--border)]"
                      >
                        <td className="px-4 py-3 font-medium">{inv.number}</td>
                        <td className="max-w-[200px] truncate px-4 py-3">
                          <Link
                            to={`/app/clients/${inv.clientId}`}
                            className="text-[var(--accent)] hover:underline"
                          >
                            {inv.clientName || 'Cliente'}
                          </Link>
                        </td>
                        <td className="px-4 py-3">
                          {invoiceTypeLabel(inv.type)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3">
                          {inv.issueDate}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-[var(--text-muted)]">
                          {inv.dueDate || '—'}
                        </td>
                        <td className="px-4 py-3">
                          <StatusPill status={inv.status} />
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right font-medium">
                          {formatMoney(
                            Number(inv.total),
                            inv.currency || currency,
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            type="button"
                            onClick={() => setViewId(inv.id)}
                            className="rounded-md border border-[var(--border)] px-2.5 py-1 text-xs hover:border-[var(--accent)] hover:text-[var(--accent)]"
                          >
                            Ver
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )
        })}
      </div>

      {viewId && (
        <InvoiceViewModal
          invoiceId={viewId}
          onClose={() => setViewId(null)}
        />
      )}
    </PanelShell>
  )
}

function KpiCard({
  label,
  value,
  hint,
  active,
  onClick,
}: {
  label: string
  value: string
  hint: string
  active?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'rounded-xl border bg-[var(--bg)] p-4 text-left transition hover:border-[var(--accent)]',
        active
          ? 'border-[var(--accent)] ring-1 ring-[var(--accent)]/40'
          : 'border-[var(--border)]',
      ].join(' ')}
    >
      <dt className="text-sm text-[var(--text-muted)]">{label}</dt>
      <dd className="mt-1 text-xl font-medium tabular-nums">{value}</dd>
      <p className="mt-1 text-[11px] text-[var(--text-muted)]">{hint}</p>
    </button>
  )
}

function FilterChip({
  active,
  label,
  onClick,
}: {
  active: boolean
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition',
        active
          ? 'bg-[var(--accent)] text-white'
          : 'border border-[var(--border)] bg-[var(--bg)] text-[var(--text-muted)] hover:text-[var(--text)]',
      ].join(' ')}
    >
      {label}
    </button>
  )
}

function StatusPill({ status }: { status: string }) {
  const tone =
    status === 'paid'
      ? 'bg-emerald-500/15 text-emerald-300'
      : status === 'overdue'
        ? 'bg-[var(--danger)]/15 text-[var(--danger)]'
        : status === 'void'
          ? 'bg-zinc-500/15 text-zinc-400'
          : status === 'draft'
            ? 'bg-zinc-500/15 text-zinc-400'
            : 'bg-amber-500/15 text-amber-300'
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ${tone}`}
    >
      {INVOICE_STATUS_LABEL[status] ?? status}
    </span>
  )
}
