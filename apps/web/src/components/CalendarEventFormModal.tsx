import { useEffect, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'
import {
  clientDisplayName,
  type Client,
} from '../lib/crm'
import type { TenantAppUser } from '../lib/users'
import {
  defaultEventTimes,
  EVENT_STATUS_LABEL,
  EVENT_TYPE_LABEL,
  fromDatetimeLocalValue,
  toDatetimeLocalValue,
  type CalendarEvent,
  type CalendarEventStatus,
  type CalendarEventType,
  type CreateCalendarEventPayload,
} from '../lib/calendar'
import { ModalPortal } from './ModalPortal'

const inputClass =
  'w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 outline-none ring-[var(--accent)] focus:ring-2'

type FormState = {
  type: CalendarEventType
  title: string
  notes: string
  startsAt: string
  endsAt: string
  allDay: boolean
  status: CalendarEventStatus
  clientId: string
  assignedUserId: string
  address: string
}

export type CalendarEventFormDefaults = {
  type?: CalendarEventType
  title?: string
  clientId?: string | null
  address?: string
  startsAt?: Date
  notes?: string
}

export function CalendarEventFormModal({
  open,
  onClose,
  event,
  defaults,
}: {
  open: boolean
  onClose: () => void
  event?: CalendarEvent | null
  defaults?: CalendarEventFormDefaults | null
}) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState<FormState>(() => emptyForm())

  const clientsQuery = useQuery({
    queryKey: ['app', 'clients'],
    queryFn: () => apiFetch<Client[]>('/app/clients'),
    enabled: open,
    staleTime: 60_000,
  })

  const usersQuery = useQuery({
    queryKey: ['app', 'users'],
    queryFn: () => apiFetch<TenantAppUser[]>('/app/users'),
    enabled: open,
    staleTime: 60_000,
  })

  useEffect(() => {
    if (!open) return
    if (event) {
      setForm({
        type: event.type,
        title: event.title,
        notes: event.notes,
        startsAt: toDatetimeLocalValue(new Date(event.startsAt)),
        endsAt: toDatetimeLocalValue(new Date(event.endsAt)),
        allDay: event.allDay,
        status: event.status,
        clientId: event.clientId ?? '',
        assignedUserId: event.assignedUserId ?? '',
        address: event.address,
      })
      return
    }
    const times = defaultEventTimes(defaults?.startsAt)
    const start = defaults?.startsAt ?? times.start
    const end = defaults?.startsAt
      ? new Date(start.getTime() + 60 * 60 * 1000)
      : times.end
    setForm({
      ...emptyForm(),
      type: defaults?.type ?? 'visit',
      title: defaults?.title ?? '',
      clientId: defaults?.clientId ?? '',
      address: defaults?.address ?? '',
      notes: defaults?.notes ?? '',
      startsAt: toDatetimeLocalValue(start),
      endsAt: toDatetimeLocalValue(end),
    })
  }, [open, event, defaults])

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const saveMutation = useMutation({
    mutationFn: (payload: CreateCalendarEventPayload) => {
      if (event) {
        return apiFetch<CalendarEvent>(`/app/calendar/events/${event.id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        })
      }
      return apiFetch<CalendarEvent>('/app/calendar/events', {
        method: 'POST',
        body: JSON.stringify(payload),
      })
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['app', 'calendar'] })
      onClose()
    },
  })

  const deleteMutation = useMutation({
    mutationFn: () =>
      apiFetch(`/app/calendar/events/${event!.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['app', 'calendar'] })
      onClose()
    },
  })

  if (!open) return null

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    const starts = fromDatetimeLocalValue(form.startsAt)
    const ends = fromDatetimeLocalValue(form.endsAt)
    if (!starts || !ends) return
    saveMutation.mutate({
      type: form.type,
      title: form.title.trim(),
      notes: form.notes,
      startsAt: starts.toISOString(),
      endsAt: ends.toISOString(),
      allDay: form.allDay,
      status: form.status,
      clientId: form.clientId || null,
      assignedUserId: form.assignedUserId || null,
      address: form.address,
    })
  }

  const clients = (clientsQuery.data ?? []).filter((c) => c.isActive)
  const users = (usersQuery.data ?? []).filter((u) => u.isActive)
  const pending = saveMutation.isPending || deleteMutation.isPending

  return (
    <ModalPortal><div className="fixed inset-0 z-[110] modal-backdrop flex items-stretch justify-center overflow-hidden bg-black/60 sm:items-center sm:p-4">
      <div
        role="dialog"
        aria-modal="true"
        className="flex h-[100dvh] max-h-[100dvh] w-full max-w-lg flex-col overflow-hidden rounded-none border-0 sm:h-auto sm:max-h-[min(92dvh,920px)] sm:rounded-xl sm:border border-[var(--border)] bg-[var(--bg-elevated)] shadow-xl"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-[var(--border)] px-5 py-4">
          <h2 className="text-lg font-semibold">
            {event ? 'Editar agenda' : 'Nueva agenda'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2 py-1 text-[var(--text-muted)] hover:bg-[var(--bg)]"
          >
            ✕
          </button>
        </div>

        <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-5 py-4">
            <label className="block text-sm">
              <span className="mb-1 block text-[var(--text-muted)]">Tipo</span>
              <select
                className={inputClass}
                value={form.type}
                onChange={(e) =>
                  set('type', e.target.value as CalendarEventType)
                }
              >
                {(Object.keys(EVENT_TYPE_LABEL) as CalendarEventType[]).map(
                  (t) => (
                    <option key={t} value={t}>
                      {EVENT_TYPE_LABEL[t]}
                    </option>
                  ),
                )}
              </select>
            </label>

            <label className="block text-sm">
              <span className="mb-1 block text-[var(--text-muted)]">
                Título
              </span>
              <input
                required
                minLength={2}
                className={inputClass}
                value={form.title}
                onChange={(e) => set('title', e.target.value)}
              />
            </label>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm">
                <span className="mb-1 block text-[var(--text-muted)]">
                  Inicio
                </span>
                <input
                  required
                  type="datetime-local"
                  className={inputClass}
                  value={form.startsAt}
                  onChange={(e) => set('startsAt', e.target.value)}
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-[var(--text-muted)]">Fin</span>
                <input
                  required
                  type="datetime-local"
                  className={inputClass}
                  value={form.endsAt}
                  onChange={(e) => set('endsAt', e.target.value)}
                />
              </label>
            </div>

            <label className="block text-sm">
              <span className="mb-1 block text-[var(--text-muted)]">
                Cliente
              </span>
              <select
                className={inputClass}
                value={form.clientId}
                onChange={(e) => {
                  const id = e.target.value
                  set('clientId', id)
                  if (!id || form.title.trim()) return
                  const c = clients.find((x) => x.id === id)
                  if (c) {
                    set(
                      'title',
                      `${EVENT_TYPE_LABEL[form.type]} — ${clientDisplayName(c)}`,
                    )
                    if (!form.address) {
                      const addr = [c.street, c.city].filter(Boolean).join(', ')
                      if (addr) set('address', addr)
                    }
                  }
                }}
              >
                <option value="">Sin cliente</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {clientDisplayName(c)}
                    {c.isLead ? ' (lead)' : ''}
                  </option>
                ))}
              </select>
            </label>

            <label className="block text-sm">
              <span className="mb-1 block text-[var(--text-muted)]">
                Asignado a
              </span>
              <select
                className={inputClass}
                value={form.assignedUserId}
                onChange={(e) => set('assignedUserId', e.target.value)}
              >
                <option value="">Sin asignar</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name || u.email}
                  </option>
                ))}
              </select>
              <span className="mt-1 block text-[11px] text-[var(--text-muted)]">
                Si eliges un usuario, se le notifica al crear o reasignar la
                agenda.
              </span>
            </label>

            <label className="block text-sm">
              <span className="mb-1 block text-[var(--text-muted)]">
                Dirección
              </span>
              <input
                className={inputClass}
                value={form.address}
                onChange={(e) => set('address', e.target.value)}
              />
            </label>

            <label className="block text-sm">
              <span className="mb-1 block text-[var(--text-muted)]">Notas</span>
              <textarea
                className={inputClass}
                rows={2}
                value={form.notes}
                onChange={(e) => set('notes', e.target.value)}
              />
            </label>

            {event && (
              <label className="block text-sm">
                <span className="mb-1 block text-[var(--text-muted)]">
                  Estado
                </span>
                <select
                  className={inputClass}
                  value={form.status}
                  onChange={(e) =>
                    set('status', e.target.value as CalendarEventStatus)
                  }
                >
                  {(
                    Object.keys(EVENT_STATUS_LABEL) as CalendarEventStatus[]
                  ).map((s) => (
                    <option key={s} value={s}>
                      {EVENT_STATUS_LABEL[s]}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {(saveMutation.error || deleteMutation.error) && (
              <p className="text-sm text-[var(--danger)]">
                {(saveMutation.error || deleteMutation.error)?.message}
              </p>
            )}
          </div>

          <div className="flex shrink-0 items-center justify-between gap-2 border-t border-[var(--border)] px-5 py-4">
            {event ? (
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  if (window.confirm('¿Eliminar esta agenda?')) {
                    deleteMutation.mutate()
                  }
                }}
                className="rounded-lg px-3 py-2 text-sm text-[var(--danger)] hover:bg-[var(--bg)]"
              >
                Eliminar
              </button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={pending}
                className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-60"
              >
                {saveMutation.isPending ? 'Guardando…' : 'Guardar'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div></ModalPortal>
  )
}

function emptyForm(): FormState {
  const { start, end } = defaultEventTimes()
  return {
    type: 'visit',
    title: '',
    notes: '',
    startsAt: toDatetimeLocalValue(start),
    endsAt: toDatetimeLocalValue(end),
    allDay: false,
    status: 'scheduled',
    clientId: '',
    assignedUserId: '',
    address: '',
  }
}
