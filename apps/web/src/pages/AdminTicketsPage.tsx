import { FormEvent, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { apiFetch } from '../lib/api'
import { PanelShell } from '../components/PanelShell'
import { useNotify } from '../components/NotifyProvider'
import {
  ListSearchInput,
  matchesSearch,
} from '../components/ListSearchInput'
import {
  CATEGORY_LABEL,
  PRIORITY_LABEL,
  STATUS_LABEL,
  type SupportTicket,
  type SupportTicketDetail,
  type SupportTicketStatus,
} from '../lib/support'

function UnreadPing() {
  return (
    <span
      className="inline-block h-2 w-2 shrink-0 rounded-full bg-[var(--danger)]"
      title="Sin leer"
      aria-label="Sin leer"
    />
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
      aria-pressed={active}
      className={[
        'shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition',
        active
          ? 'border-[var(--accent)] bg-[var(--accent)] text-white'
          : 'border-[var(--border)] bg-[var(--bg-elevated)] text-[var(--text-muted)] hover:border-[var(--accent)] hover:text-[var(--accent)]',
      ].join(' ')}
    >
      {label}
    </button>
  )
}

export function AdminTicketsPage() {
  const [status, setStatus] = useState<string>('')
  const [search, setSearch] = useState('')

  const ticketsQuery = useQuery({
    queryKey: ['admin', 'support', 'tickets', status],
    queryFn: () =>
      apiFetch<SupportTicket[]>(
        `/admin/support/tickets${status ? `?status=${status}` : ''}`,
      ),
    refetchInterval: 15_000,
  })

  const tickets = useMemo(() => {
    const all = ticketsQuery.data ?? []
    return all.filter((t) =>
      matchesSearch(
        search,
        t.subject,
        t.tenantName,
        STATUS_LABEL[t.status],
        PRIORITY_LABEL[t.priority],
      ),
    )
  }, [ticketsQuery.data, search])

  return (
    <PanelShell
      title="Tickets"
      subtitle="Soporte a empresas"
      variant="admin"
    >
      <div className="mb-4 space-y-3">
        <ListSearchInput
          value={search}
          onChange={setSearch}
          placeholder="Buscar asunto, empresa…"
          className="md:max-w-sm"
        />
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <FilterChip
            active={status === ''}
            label="Todos"
            onClick={() => setStatus('')}
          />
          {(Object.keys(STATUS_LABEL) as SupportTicketStatus[]).map((k) => (
            <FilterChip
              key={k}
              active={status === k}
              label={STATUS_LABEL[k]}
              onClick={() => setStatus(k)}
            />
          ))}
        </div>
      </div>

      {ticketsQuery.error && (
        <p className="mb-4 text-sm text-[var(--danger)]">
          {ticketsQuery.error.message}
        </p>
      )}

      {/* Mobile: tarjetas */}
      <div className="space-y-3 pb-6 md:hidden">
        {ticketsQuery.isLoading && (
          <p className="text-sm text-[var(--text-muted)]">Cargando…</p>
        )}
        {!ticketsQuery.isLoading && tickets.length === 0 && (
          <p className="rounded-xl border border-dashed border-[var(--border)] px-4 py-10 text-center text-sm text-[var(--text-muted)]">
            No hay tickets
          </p>
        )}
        {tickets.map((t) => (
          <article
            key={t.id}
            className="rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <Link
                  to={`/admin/tickets/${t.id}`}
                  className="flex items-center gap-2 text-base font-semibold text-[var(--accent)] hover:underline"
                >
                  {t.adminUnread ? <UnreadPing /> : null}
                  <span className="truncate">{t.subject}</span>
                </Link>
                <p className="mt-0.5 truncate text-sm text-[var(--text-muted)]">
                  {t.tenantName ?? '—'}
                </p>
              </div>
              <span className="shrink-0 rounded-full bg-[var(--bg)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--text-muted)]">
                {STATUS_LABEL[t.status]}
              </span>
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
              <div>
                <dt className="text-[var(--text-muted)]">Prioridad</dt>
                <dd className="mt-0.5">{PRIORITY_LABEL[t.priority]}</dd>
              </div>
              <div>
                <dt className="text-[var(--text-muted)]">Actualizado</dt>
                <dd className="mt-0.5">
                  {new Date(t.lastMessageAt).toLocaleString()}
                </dd>
              </div>
            </dl>
            <div className="mt-3 border-t border-[var(--border)] pt-3">
              <Link
                to={`/admin/tickets/${t.id}`}
                className="inline-flex rounded-md bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white hover:bg-[var(--accent-hover)]"
              >
                Abrir
              </Link>
            </div>
          </article>
        ))}
      </div>

      {/* Desktop: tabla a ancho completo */}
      <div className="hidden w-full overflow-x-auto overflow-hidden rounded-xl border border-[var(--border)] md:block">
        <table className="w-full table-fixed text-left text-sm">
          <colgroup>
            <col className="w-10" />
            <col className="w-[18%]" />
            <col className="w-[34%]" />
            <col className="w-[14%]" />
            <col className="w-[14%]" />
            <col className="w-[16%]" />
          </colgroup>
          <thead className="bg-[var(--bg)] text-[var(--text-muted)]">
            <tr>
              <th className="px-4 py-3 font-medium" />
              <th className="px-4 py-3 font-medium">Empresa</th>
              <th className="px-4 py-3 font-medium">Asunto</th>
              <th className="px-4 py-3 font-medium">Estado</th>
              <th className="px-4 py-3 font-medium">Prioridad</th>
              <th className="px-4 py-3 font-medium">Actualizado</th>
            </tr>
          </thead>
          <tbody>
            {tickets.length === 0 && !ticketsQuery.isLoading && (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-8 text-center text-[var(--text-muted)]"
                >
                  No hay tickets
                </td>
              </tr>
            )}
            {tickets.map((t) => (
              <tr
                key={t.id}
                className="border-t border-[var(--border)] hover:bg-[var(--bg-elevated)]/50"
              >
                <td className="px-4 py-3">
                  {t.adminUnread ? <UnreadPing /> : null}
                </td>
                <td className="truncate px-4 py-3">{t.tenantName ?? '—'}</td>
                <td className="truncate px-4 py-3">
                  <Link
                    to={`/admin/tickets/${t.id}`}
                    className="font-medium text-[var(--accent)] hover:underline"
                  >
                    {t.subject}
                  </Link>
                </td>
                <td className="px-4 py-3 text-[var(--text-muted)]">
                  {STATUS_LABEL[t.status]}
                </td>
                <td className="px-4 py-3 text-[var(--text-muted)]">
                  {PRIORITY_LABEL[t.priority]}
                </td>
                <td className="px-4 py-3 text-[var(--text-muted)]">
                  {new Date(t.lastMessageAt).toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </PanelShell>
  )
}

export function AdminTicketDetailPage() {
  const { id = '' } = useParams()
  const { alert } = useNotify()
  const queryClient = useQueryClient()
  const [body, setBody] = useState('')

  const detailQuery = useQuery({
    queryKey: ['admin', 'support', 'tickets', id],
    queryFn: () =>
      apiFetch<SupportTicketDetail>(`/admin/support/tickets/${id}`),
    enabled: Boolean(id),
    refetchInterval: 15_000,
  })

  const replyMutation = useMutation({
    mutationFn: () =>
      apiFetch(`/admin/support/tickets/${id}/messages`, {
        method: 'POST',
        body: JSON.stringify({ body }),
      }),
    onSuccess: () => {
      setBody('')
      void queryClient.invalidateQueries({
        queryKey: ['admin', 'support', 'tickets', id],
      })
      void queryClient.invalidateQueries({
        queryKey: ['admin', 'support', 'tickets'],
      })
      void queryClient.invalidateQueries({ queryKey: ['notifications'] })
    },
    onError: (err) => {
      void alert(err instanceof Error ? err.message : 'No se pudo enviar', {
        title: 'Error',
        variant: 'error',
      })
    },
  })

  const statusMutation = useMutation({
    mutationFn: (status: SupportTicketStatus) =>
      apiFetch(`/admin/support/tickets/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ['admin', 'support', 'tickets', id],
      })
      void queryClient.invalidateQueries({ queryKey: ['notifications'] })
    },
  })

  const ticket = detailQuery.data

  function onReply(e: FormEvent) {
    e.preventDefault()
    if (!body.trim()) return
    replyMutation.mutate()
  }

  return (
    <PanelShell
      title={ticket?.subject ?? 'Ticket'}
      subtitle={ticket?.tenantName ? `Empresa: ${ticket.tenantName}` : 'Detalle'}
      variant="admin"
    >
      <div className="mb-4">
        <Link
          to="/admin/tickets"
          className="text-sm text-[var(--accent)] hover:underline"
        >
          ← Volver a tickets
        </Link>
      </div>

      {detailQuery.error && (
        <p className="mb-4 text-sm text-[var(--danger)]">
          {detailQuery.error.message}
        </p>
      )}

      {ticket && (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-3 text-sm">
            <span className="text-[var(--text-muted)]">
              {STATUS_LABEL[ticket.status]} · {CATEGORY_LABEL[ticket.category]}{' '}
              · {PRIORITY_LABEL[ticket.priority]}
            </span>
            <select
              value={ticket.status}
              onChange={(e) =>
                statusMutation.mutate(e.target.value as SupportTicketStatus)
              }
              className="ml-auto rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-sm"
            >
              {(Object.keys(STATUS_LABEL) as SupportTicketStatus[]).map((k) => (
                <option key={k} value={k}>
                  {STATUS_LABEL[k]}
                </option>
              ))}
            </select>
          </div>

          <div className="mb-4 space-y-3 rounded-xl border border-[var(--border)] p-4">
            {ticket.messages.map((m) => (
              <div
                key={m.id}
                className={[
                  'rounded-lg px-3 py-2 text-sm',
                  m.authorRole === 'admin'
                    ? 'bg-[var(--accent)]/10'
                    : 'bg-[var(--bg-elevated)]',
                ].join(' ')}
              >
                <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2 text-xs text-[var(--text-muted)]">
                  <span className="font-medium text-[var(--text)]">
                    {m.authorName ||
                      (m.authorRole === 'admin' ? 'Soporte' : 'Empresa')}
                  </span>
                  <span>{new Date(m.createdAt).toLocaleString()}</span>
                </div>
                <p className="whitespace-pre-wrap">{m.body}</p>
              </div>
            ))}
          </div>

          {ticket.status !== 'closed' && (
            <form onSubmit={onReply} className="space-y-2">
              <textarea
                rows={3}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Responder a la empresa…"
                className="w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm"
              />
              <button
                type="submit"
                disabled={replyMutation.isPending || !body.trim()}
                className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
              >
                {replyMutation.isPending ? 'Enviando…' : 'Responder'}
              </button>
            </form>
          )}
        </>
      )}
    </PanelShell>
  )
}
