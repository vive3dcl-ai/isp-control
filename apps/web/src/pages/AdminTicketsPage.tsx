import { FormEvent, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { apiFetch } from '../lib/api'
import { PanelShell } from '../components/PanelShell'
import { useNotify } from '../components/NotifyProvider'
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

export function AdminTicketsPage() {
  const [status, setStatus] = useState<string>('')

  const ticketsQuery = useQuery({
    queryKey: ['admin', 'support', 'tickets', status],
    queryFn: () =>
      apiFetch<SupportTicket[]>(
        `/admin/support/tickets${status ? `?status=${status}` : ''}`,
      ),
    refetchInterval: 15_000,
  })

  const tickets = ticketsQuery.data ?? []

  return (
    <PanelShell
      title="Tickets"
      subtitle="Soporte a empresas"
      variant="admin"
    >
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-[var(--text-muted)]">
          Solicitudes de las empresas ISP hacia la plataforma.
        </p>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm"
        >
          <option value="">Todos</option>
          {(Object.keys(STATUS_LABEL) as SupportTicketStatus[]).map((k) => (
            <option key={k} value={k}>
              {STATUS_LABEL[k]}
            </option>
          ))}
        </select>
      </div>

      {ticketsQuery.error && (
        <p className="mb-4 text-sm text-[var(--danger)]">
          {ticketsQuery.error.message}
        </p>
      )}

      <div className="overflow-hidden overflow-x-auto rounded-xl border border-[var(--border)]">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="bg-[var(--bg-elevated)] text-xs text-[var(--text-muted)] uppercase">
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
                <td className="w-8 px-4 py-3">
                  {t.adminUnread ? <UnreadPing /> : null}
                </td>
                <td className="px-4 py-3">{t.tenantName ?? '—'}</td>
                <td className="px-4 py-3">
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
