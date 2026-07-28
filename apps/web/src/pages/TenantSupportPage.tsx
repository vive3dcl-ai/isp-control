import { type FormEvent, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router-dom'
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
  type SupportTicketCategory,
  type SupportTicketDetail,
  type SupportTicketPriority,
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

function StatusBadge({ status }: { status: SupportTicketStatus }) {
  const tone =
    status === 'open' || status === 'awaiting_admin'
      ? 'bg-sky-500/15 text-sky-300'
      : status === 'awaiting_tenant'
        ? 'bg-amber-500/15 text-amber-300'
        : status === 'resolved'
          ? 'bg-emerald-500/15 text-emerald-300'
          : 'bg-zinc-500/15 text-zinc-400'
  return (
    <span
      className={`inline-flex shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${tone}`}
    >
      {STATUS_LABEL[status]}
    </span>
  )
}

function PriorityBadge({ priority }: { priority: SupportTicketPriority }) {
  const tone =
    priority === 'high'
      ? 'text-rose-300'
      : priority === 'low'
        ? 'text-[var(--text-muted)]'
        : 'text-[var(--text)]'
  return (
    <span className={`text-[11px] font-medium ${tone}`}>
      {PRIORITY_LABEL[priority]}
    </span>
  )
}

function formatUpdated(iso: string) {
  const d = new Date(iso)
  const now = new Date()
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  if (sameDay) {
    return d.toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
    })
  }
  return d.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
  })
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

export function TenantSupportPage() {
  const navigate = useNavigate()
  const { alert } = useNotify()
  const queryClient = useQueryClient()
  const [creating, setCreating] = useState(false)
  const [subject, setSubject] = useState('')
  const [category, setCategory] = useState<SupportTicketCategory>('other')
  const [priority, setPriority] = useState<SupportTicketPriority>('normal')
  const [body, setBody] = useState('')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('')

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

  const tickets = useMemo(() => {
    const all = ticketsQuery.data ?? []
    return all
      .filter((t) => !statusFilter || t.status === statusFilter)
      .filter((t) =>
        matchesSearch(
          search,
          t.subject,
          STATUS_LABEL[t.status],
          PRIORITY_LABEL[t.priority],
          CATEGORY_LABEL[t.category],
        ),
      )
  }, [ticketsQuery.data, search, statusFilter])

  return (
    <PanelShell
      title="Soporte"
      subtitle="Tickets con la plataforma"
      variant="tenant"
    >
      <div className="mb-4 space-y-3 md:mb-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <ListSearchInput
            value={search}
            onChange={setSearch}
            placeholder="Buscar asunto, estado…"
            className="md:max-w-sm"
          />
          <button
            type="button"
            onClick={() => setCreating((v) => !v)}
            className="hidden shrink-0 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)] md:inline-flex"
          >
            {creating ? 'Cancelar' : 'Nuevo ticket'}
          </button>
        </div>
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <FilterChip
            active={statusFilter === ''}
            label="Todos"
            onClick={() => setStatusFilter('')}
          />
          {(Object.keys(STATUS_LABEL) as SupportTicketStatus[]).map((k) => (
            <FilterChip
              key={k}
              active={statusFilter === k}
              label={STATUS_LABEL[k]}
              onClick={() => setStatusFilter(k)}
            />
          ))}
        </div>
      </div>

      {creating && (
        <form
          onSubmit={onSubmit}
          className="mb-6 space-y-3 rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-4"
        >
          <div className="flex items-center justify-between gap-2 md:hidden">
            <p className="text-sm font-medium">Nuevo ticket</p>
            <button
              type="button"
              onClick={() => setCreating(false)}
              className="text-xs text-[var(--text-muted)] hover:text-[var(--text)]"
            >
              Cancelar
            </button>
          </div>
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

      {/* Mobile: tarjetas */}
      <div className="space-y-3 pb-28 md:hidden">
        {ticketsQuery.isLoading && (
          <p className="text-sm text-[var(--text-muted)]">Cargando…</p>
        )}
        {!ticketsQuery.isLoading && tickets.length === 0 && (
          <p className="rounded-xl border border-dashed border-[var(--border)] px-4 py-10 text-center text-sm text-[var(--text-muted)]">
            {search.trim() || statusFilter
              ? 'Sin resultados para ese filtro.'
              : 'Sin tickets. Toca + para crear el primero.'}
          </p>
        )}
        {tickets.map((t) => (
          <article
            key={t.id}
            className="rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2.5"
          >
            <div className="flex items-center gap-2">
              {t.tenantUnread ? <UnreadPing /> : null}
              <Link
                to={`/app/support/${t.id}`}
                className="min-w-0 flex-1 truncate text-sm font-semibold text-[var(--accent)] hover:underline"
              >
                {t.subject}
              </Link>
              <StatusBadge status={t.status} />
              <Link
                to={`/app/support/${t.id}`}
                className="shrink-0 text-xs font-medium text-[var(--accent)] hover:underline"
              >
                Ver
              </Link>
            </div>
            <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-[var(--text-muted)]">
              <span className="min-w-0 truncate">
                {CATEGORY_LABEL[t.category]}
                {' · '}
                <PriorityBadge priority={t.priority} />
              </span>
              <span className="shrink-0">{formatUpdated(t.lastMessageAt)}</span>
            </div>
          </article>
        ))}
      </div>

      {/* Desktop: tabla */}
      <div className="hidden w-full overflow-x-auto overflow-hidden rounded-xl border border-[var(--border)] md:block">
        <table className="w-full table-fixed text-left text-sm">
          <colgroup>
            <col className="w-10" />
            <col className="w-[36%]" />
            <col className="w-[16%]" />
            <col className="w-[16%]" />
            <col className="w-[12%]" />
            <col className="w-[10%]" />
          </colgroup>
          <thead className="bg-[var(--bg)] text-[var(--text-muted)]">
            <tr>
              <th className="px-4 py-3 font-medium" />
              <th className="px-4 py-3 font-medium">Asunto</th>
              <th className="px-4 py-3 font-medium">Estado</th>
              <th className="px-4 py-3 font-medium">Categoría</th>
              <th className="px-4 py-3 font-medium">Prioridad</th>
              <th className="px-4 py-3 font-medium">Actualizado</th>
            </tr>
          </thead>
          <tbody>
            {ticketsQuery.isLoading && (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-6 text-[var(--text-muted)]"
                >
                  Cargando…
                </td>
              </tr>
            )}
            {!ticketsQuery.isLoading && tickets.length === 0 && (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-6 text-center text-[var(--text-muted)]"
                >
                  {search.trim() || statusFilter
                    ? 'Sin resultados para ese filtro.'
                    : 'No hay tickets todavía.'}
                </td>
              </tr>
            )}
            {tickets.map((t) => (
              <tr
                key={t.id}
                className="border-t border-[var(--border)] hover:bg-[var(--bg-elevated)]/40"
              >
                <td className="px-4 py-3">
                  {t.tenantUnread ? <UnreadPing /> : null}
                </td>
                <td className="truncate px-4 py-3">
                  <Link
                    to={`/app/support/${t.id}`}
                    className="font-medium text-[var(--accent)] hover:underline"
                  >
                    {t.subject}
                  </Link>
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={t.status} />
                </td>
                <td className="truncate px-4 py-3 text-[var(--text-muted)]">
                  {CATEGORY_LABEL[t.category]}
                </td>
                <td className="px-4 py-3">
                  <PriorityBadge priority={t.priority} />
                </td>
                <td className="truncate px-4 py-3 text-[var(--text-muted)]">
                  {formatUpdated(t.lastMessageAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!creating && (
        <button
          type="button"
          onClick={() => setCreating(true)}
          aria-label="Nuevo ticket"
          className="fixed bottom-20 right-5 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-[var(--accent)] text-white shadow-lg shadow-black/25 hover:bg-[var(--accent-hover)] md:hidden"
        >
          <svg
            width="28"
            height="28"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            aria-hidden
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
      )}
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
      void queryClient.invalidateQueries({
        queryKey: ['app', 'support', 'tickets'],
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

      {detailQuery.isLoading && !ticket && (
        <p className="text-sm text-[var(--text-muted)]">Cargando…</p>
      )}

      {ticket && (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <StatusBadge status={ticket.status} />
            <span className="rounded-full bg-[var(--bg-elevated)] px-2 py-0.5 text-[10px] text-[var(--text-muted)]">
              {CATEGORY_LABEL[ticket.category]}
            </span>
            <PriorityBadge priority={ticket.priority} />
            {ticket.status !== 'closed' && (
              <button
                type="button"
                onClick={() => closeMutation.mutate()}
                className="ml-auto text-xs text-[var(--danger)] hover:underline"
              >
                Cerrar ticket
              </button>
            )}
          </div>

          <div className="mb-4 space-y-3 rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-3 sm:p-4">
            {ticket.messages.map((m) => (
              <div
                key={m.id}
                className={[
                  'rounded-lg px-3 py-2 text-sm',
                  m.authorRole === 'tenant'
                    ? 'bg-[var(--accent)]/10'
                    : 'bg-[var(--bg)]',
                ].join(' ')}
              >
                <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2 text-xs text-[var(--text-muted)]">
                  <span className="font-medium text-[var(--text)]">
                    {m.authorName ||
                      (m.authorRole === 'tenant' ? 'Empresa' : 'Soporte')}
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
              className="space-y-2 pb-8"
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
