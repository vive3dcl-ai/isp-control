import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthContext'
import { apiFetch } from '../lib/api'
import {
  canWriteCalendar,
  endOfDay,
  EVENT_TYPE_DOT,
  EVENT_TYPE_LABEL,
  eventsOnLocalDay,
  formatDayHeading,
  formatTime,
  startOfDay,
  toLocalDateKey,
  type CalendarEvent,
} from '../lib/calendar'
import {
  CalendarEventFormModal,
  type CalendarEventFormDefaults,
} from '../components/CalendarEventFormModal'

export function MobileCalendarDayPage() {
  const { user } = useAuth()
  const canWrite = canWriteCalendar(user?.tenantRole)
  const [day] = useState(() => startOfDay(new Date()))
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<CalendarEvent | null>(null)
  const [defaults, setDefaults] = useState<CalendarEventFormDefaults | null>(
    null,
  )

  const from = startOfDay(day)
  const to = endOfDay(day)

  const eventsQuery = useQuery({
    queryKey: [
      'app',
      'calendar',
      'events',
      'mobile-day',
      toLocalDateKey(day),
    ],
    queryFn: () =>
      apiFetch<CalendarEvent[]>(
        `/app/calendar/events?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`,
      ),
    refetchInterval: 60_000,
  })

  const events = useMemo(
    () =>
      eventsOnLocalDay(eventsQuery.data ?? [], day).filter(
        (e) => e.status !== 'cancelled',
      ),
    [eventsQuery.data, day],
  )

  function openCreate() {
    setEditing(null)
    setDefaults({ startsAt: day })
    setFormOpen(true)
  }

  return (
    <div className="flex flex-1 flex-col">
      <div className="mb-4 flex items-center gap-3">
        <Link
          to="/movil"
          className="rounded-xl border border-[var(--border)] px-3 py-2 text-sm text-[var(--text-muted)]"
        >
          ←
        </Link>
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight">Calendario</h1>
          <p className="truncate text-xs text-[var(--text-muted)]">
            {formatDayHeading(day)}
          </p>
        </div>
      </div>

      {eventsQuery.error && (
        <p className="mb-3 text-sm text-[var(--danger)]">
          {eventsQuery.error.message}
        </p>
      )}

      {eventsQuery.isLoading ? (
        <p className="text-sm text-[var(--text-muted)]">Cargando…</p>
      ) : events.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[var(--border)] px-4 py-10 text-center">
          <p className="text-sm text-[var(--text-muted)]">
            No hay agendas para hoy.
          </p>
          {canWrite && (
            <button
              type="button"
              onClick={openCreate}
              className="mt-3 text-sm font-medium text-[var(--accent)]"
            >
              Crear agenda
            </button>
          )}
        </div>
      ) : (
        <ul className="space-y-2">
          {events.map((ev) => (
            <li key={ev.id}>
              <button
                type="button"
                onClick={() => {
                  setDefaults(null)
                  setEditing(ev)
                  setFormOpen(true)
                }}
                className="flex w-full items-start gap-3 rounded-2xl border border-[var(--border)] bg-[var(--bg-elevated)] px-4 py-3 text-left active:scale-[0.99]"
              >
                <span
                  className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${EVENT_TYPE_DOT[ev.type]}`}
                />
                <div className="min-w-0 flex-1">
                  <p className="font-medium leading-tight">{ev.title}</p>
                  <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                    {EVENT_TYPE_LABEL[ev.type]} · {formatTime(ev.startsAt)}–
                    {formatTime(ev.endsAt)}
                  </p>
                  {ev.address ? (
                    <p className="mt-1 truncate text-xs text-[var(--text-muted)]">
                      {ev.address}
                    </p>
                  ) : null}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-auto space-y-2 pt-6">
        {canWrite && events.length > 0 && (
          <button
            type="button"
            onClick={openCreate}
            className="w-full rounded-xl border border-[var(--border)] py-3 text-sm font-medium"
          >
            Nueva agenda
          </button>
        )}
        <Link
          to="/movil/calendario/completo"
          className="flex w-full items-center justify-center rounded-xl bg-[var(--accent)] py-3 text-sm font-medium text-white"
        >
          Ver calendario completo
        </Link>
      </div>

      <CalendarEventFormModal
        open={formOpen}
        onClose={() => {
          setFormOpen(false)
          setEditing(null)
          setDefaults(null)
        }}
        event={editing}
        defaults={defaults}
      />
    </div>
  )
}
