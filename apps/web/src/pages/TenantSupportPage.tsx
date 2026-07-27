import { FormEvent, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { apiFetch } from '../lib/api'
import { PanelShell } from '../components/PanelShell'
import { useNotify } from '../components/NotifyProvider'
import {
  CATEGORY_LABEL,
  PRIORITY_LABEL,
  STATUS_LABEL,
  type SupportTicket,
  type SupportTicketCategory,
  type SupportTicketDetail,
  type SupportTicketPriority,
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

export function TenantSupportPage() {
  const navigate = useNavigate()
  const { alert } = useNotify()
  const queryClient = useQueryClient()
  const [creating, setCreating] = useState(false)
  const [subject, setSubject] = useState('')
  const [category, setCategory] = useState<SupportTicketCategory>('other')
  const [priority, setPriority] = useState<SupportTicketPriority>('normal')
  const [body, setBody] = useState('')

  const ticketsQuery = useQuery({
    queryKey: ['app', 'support', 'tickets'],
    queryFn: () => apiFetch<SupportTicket[]>('/app/support/tickets'),
    refetchInterval: 15_000,
  })

  const createMutation = useMutation({
    mutationFn: () =>
      apiFetch<SupportTicketDetail>('/app/support/tickets', {
        method: 'POST',
        body: JSON.stringify({ subject, category, priority, body }),
      }),
    onSuccess: (ticket) => {
      void queryClient.invalidateQueries({ queryKey: ['app', 'support'] })
      void queryClient.invalidateQueries({ queryKey: ['notifications'] })
      setCreating(false)
      setSubject('')
      setBody('')
      setCategory('other')
      setPriority('normal')
      navigate(`/app/support/${ticket.id}`)
    },
    onError: (err) => {
      void alert(err instanceof Error ? err.message : 'No se pudo crear', {
        title: 'Error',
        variant: 'error',
      })
    },
  })

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    createMutation.mutate()
  }

  const tickets = ticketsQuery.data ?? []

  return (
    <PanelShell title="Soporte" subtitle="Tickets con la plataforma" variant="tenant">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-[var(--text-muted)]">
          Consultas de facturación, cuenta o soporte técnico a ISP Control.
        </p>
        <button
          type="button"
          onClick={() => setCreating((v) => !v)}
          className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)]"
        >
          {creating ? 'Cancelar' : 'Nuevo ticket'}
        </button>
      </div>

      {creating && (
        <form
          onSubmit={onSubmit}
          className="mb-6 space-y-3 rounded-xl border border-[var(--border)] p-4"
        >
          <div>
            <label className="mb-1 block text-xs text-[var(--text-muted)]">
              Asunto
            </label>
            <input
              required
              minLength={3}
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs text-[var(--text-muted)]">
                Categoría
              </label>
              <select
                value={category}
                onChange={(e) =>
                  setCategory(e.target.value as SupportTicketCategory)
                }
                className="w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm"
              >
                {(Object.keys(CATEGORY_LABEL) as SupportTicketCategory[]).map(
                  (k) => (
                    <option key={k} value={k}>
                      {CATEGORY_LABEL[k]}
                    </option>
                  ),
                )}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-[var(--text-muted)]">
                Prioridad
              </label>
              <select
                value={priority}
                onChange={(e) =>
                  setPriority(e.target.value as SupportTicketPriority)
                }
                className="w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm"
              >
                {(Object.keys(PRIORITY_LABEL) as SupportTicketPriority[]).map(
                  (k) => (
                    <option key={k} value={k}>
                      {PRIORITY_LABEL[k]}
                    </option>
                  ),
                )}
              </select>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs text-[var(--text-muted)]">
              Mensaje
            </label>
            <textarea
              required
              rows={4}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className="w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm"
            />
          </div>
          <button
            type="submit"
            disabled={createMutation.isPending}
            className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            {createMutation.isPending ? 'Enviando…' : 'Crear ticket'}
          </button>
        </form>
      )}

      {ticketsQuery.error && (
        <p className="mb-4 text-sm text-[var(--danger)]">
          {ticketsQuery.error.message}
        </p>
      )}

      <div className="overflow-hidden overflow-x-auto rounded-xl border border-[var(--border)]">
        <table className="w-full min-w-[560px] text-left text-sm">
          <thead className="bg-[var(--bg-elevated)] text-xs text-[var(--text-muted)] uppercase">
            <tr>
              <th className="px-4 py-3 font-medium" />
              <th className="px-4 py-3 font-medium">Asunto</th>
              <th className="px-4 py-3 font-medium">Estado</th>
              <th className="px-4 py-3 font-medium">Categoría</th>
              <th className="px-4 py-3 font-medium">Actualizado</th>
            </tr>
          </thead>
          <tbody>
            {tickets.length === 0 && !ticketsQuery.isLoading && (
              <tr>
                <td
                  colSpan={5}
                  className="px-4 py-8 text-center text-[var(--text-muted)]"
                >
                  No hay tickets todavía
                </td>
              </tr>
            )}
            {tickets.map((t) => (
              <tr
                key={t.id}
                className="border-t border-[var(--border)] hover:bg-[var(--bg-elevated)]/50"
              >
                <td className="w-8 px-4 py-3">
                  {t.tenantUnread ? <UnreadPing /> : null}
                </td>
                <td className="px-4 py-3">
                  <Link
                    to={`/app/support/${t.id}`}
                    className="font-medium text-[var(--accent)] hover:underline"
                  >
                    {t.subject}
                  </Link>
                </td>
                <td className="px-4 py-3 text-[var(--text-muted)]">
                  {STATUS_LABEL[t.status]}
                </td>
                <td className="px-4 py-3 text-[var(--text-muted)]">
                  {CATEGORY_LABEL[t.category]}
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

export function TenantSupportDetailPage() {
  const { id = '' } = useParams()
  const { alert } = useNotify()
  const queryClient = useQueryClient()
  const [body, setBody] = useState('')

  const detailQuery = useQuery({
    queryKey: ['app', 'support', 'tickets', id],
    queryFn: () =>
      apiFetch<SupportTicketDetail>(`/app/support/tickets/${id}`),
    enabled: Boolean(id),
    refetchInterval: 15_000,
  })

  const replyMutation = useMutation({
    mutationFn: () =>
      apiFetch(`/app/support/tickets/${id}/messages`, {
        method: 'POST',
        body: JSON.stringify({ body }),
      }),
    onSuccess: () => {
      setBody('')
      void queryClient.invalidateQueries({
        queryKey: ['app', 'support', 'tickets', id],
      })
      void queryClient.invalidateQueries({ queryKey: ['app', 'support', 'tickets'] })
      void queryClient.invalidateQueries({ queryKey: ['notifications'] })
    },
    onError: (err) => {
      void alert(err instanceof Error ? err.message : 'No se pudo enviar', {
        title: 'Error',
        variant: 'error',
      })
    },
  })

  const closeMutation = useMutation({
    mutationFn: () =>
      apiFetch(`/app/support/tickets/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'closed' }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ['app', 'support', 'tickets', id],
      })
      void queryClient.invalidateQueries({ queryKey: ['notifications'] })
    },
  })

  const ticket = detailQuery.data

  return (
    <PanelShell
      title={ticket?.subject ?? 'Ticket'}
      subtitle="Detalle de soporte"
      variant="tenant"
    >
      <div className="mb-4">
        <Link
          to="/app/support"
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
          <div className="mb-4 flex flex-wrap gap-3 text-sm text-[var(--text-muted)]">
            <span>{STATUS_LABEL[ticket.status]}</span>
            <span>·</span>
            <span>{CATEGORY_LABEL[ticket.category]}</span>
            <span>·</span>
            <span>{PRIORITY_LABEL[ticket.priority]}</span>
            {ticket.status !== 'closed' && (
              <button
                type="button"
                onClick={() => closeMutation.mutate()}
                className="ml-auto text-[var(--danger)] hover:underline"
              >
                Cerrar ticket
              </button>
            )}
          </div>

          <div className="mb-4 space-y-3 rounded-xl border border-[var(--border)] p-4">
            {ticket.messages.map((m) => (
              <div
                key={m.id}
                className={[
                  'rounded-lg px-3 py-2 text-sm',
                  m.authorRole === 'tenant'
                    ? 'bg-[var(--accent)]/10'
                    : 'bg-[var(--bg-elevated)]',
                ].join(' ')}
              >
                <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2 text-xs text-[var(--text-muted)]">
                  <span className="font-medium text-[var(--text)]">
                    {m.authorName || (m.authorRole === 'tenant' ? 'Empresa' : 'Soporte')}
                  </span>
                  <span>{new Date(m.createdAt).toLocaleString()}</span>
                </div>
                <p className="whitespace-pre-wrap">{m.body}</p>
              </div>
            ))}
          </div>

          {ticket.status !== 'closed' && (
            <form
              onSubmit={(e) => {
                e.preventDefault()
                if (!body.trim()) return
                replyMutation.mutate()
              }}
              className="space-y-2"
            >
              <textarea
                rows={3}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Escribe una respuesta…"
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
