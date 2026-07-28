import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthContext'
import { apiFetch } from '../lib/api'
import {
  addDays,
  addMonths,
  canWriteCalendar,
  endOfMonth,
  endOfWeek,
  EVENT_TYPE_COLOR,
  EVENT_TYPE_DOT,
  EVENT_TYPE_LABEL,
  eventsOnLocalDay,
  formatDayHeading,
  formatMonthHeading,
  formatTime,
  sameDay,
  startOfDay,
  startOfMonth,
  startOfWeek,
  toLocalDateKey,
  WEEKDAY_SHORT,
  type CalendarEvent,
} from '../lib/calendar'
import {
  CalendarEventFormModal,
  type CalendarEventFormDefaults,
} from '../components/CalendarEventFormModal'

export function MobileCalendarFullPage() {
  const { user } = useAuth()
  const canWrite = canWriteCalendar(user?.tenantRole)
  const [cursor, setCursor] = useState(() => startOfDay(new Date()))
  const [selectedDay, setSelectedDay] = useState(() => startOfDay(new Date()))
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<CalendarEvent | null>(null)
  const [defaults, setDefaults] = useState<CalendarEventFormDefaults | null>(
    null,
  )

  const range = useMemo(() => {
    const monthStart = startOfMonth(cursor)
    const gridStart = startOfWeek(monthStart)
    const monthEnd = endOfMonth(cursor)
    const gridEnd = endOfWeek(monthEnd)
    return { from: gridStart, to: gridEnd }
  }, [cursor])

  const eventsQuery = useQuery({
    queryKey: [
      'app',
      'calendar',
      'events',
      'mobile-full',
      range.from.toISOString(),
      range.to.toISOString(),
    ],
    queryFn: () =>
      apiFetch<CalendarEvent[]>(
        `/app/calendar/events?from=${encodeURIComponent(range.from.toISOString())}&to=${encodeURIComponent(range.to.toISOString())}`,
      ),
  })

  const events = eventsQuery.data ?? []
  const dayEvents = useMemo(
    () =>
      eventsOnLocalDay(events, selectedDay).filter(
        (e) => e.status !== 'cancelled',
      ),
    [events, selectedDay],
  )

  const days = useMemo(() => {
    const gridStart = startOfWeek(startOfMonth(cursor))
    return Array.from({ length: 42 }, (_, i) => addDays(gridStart, i))
  }, [cursor])
  const today = startOfDay(new Date())

  function openCreate(day?: Date) {
    setEditing(null)
    setDefaults({ startsAt: day ?? selectedDay })
    setFormOpen(true)
  }

  return (
    <div className="flex flex-1 flex-col">
      <div className="mb-4 flex items-center gap-3">
        <Link
          to="/movil/calendario"
          className="rounded-xl border border-[var(--border)] px-3 py-2 text-sm text-[var(--text-muted)]"
        >
          ←
        </Link>
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight">
            Calendario completo
          </h1>
          <p className="text-xs text-[var(--text-muted)]">Mes y agendas</p>
        </div>
      </div>

      <div className="mb-3 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setCursor((c) => addMonths(startOfMonth(c), -1))}
          className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm"
          aria-label="Mes anterior"
        >
          ‹
        </button>
        <p className="text-sm font-semibold capitalize">
          {formatMonthHeading(cursor)}
        </p>
        <button
          type="button"
          onClick={() => setCursor((c) => addMonths(startOfMonth(c), 1))}
          className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm"
          aria-label="Mes siguiente"
        >
          ›
        </button>
      </div>

      <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--bg-elevated)]">
        <div className="grid grid-cols-7 border-b border-[var(--border)] bg-[var(--bg)] text-center text-[10px] font-medium text-[var(--text-muted)]">
          {WEEKDAY_SHORT.map((d) => (
            <div key={d} className="py-2">
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {days.map((day) => {
            const inMonth = day.getMonth() === cursor.getMonth()
            const isSelected = sameDay(day, selectedDay)
            const isToday = sameDay(day, today)
            const hasEvents = eventsOnLocalDay(events, day).some(
              (e) => e.status !== 'cancelled',
            )
            return (
              <button
                key={toLocalDateKey(day)}
                type="button"
                onClick={() => setSelectedDay(day)}
                className={`relative flex min-h-[2.75rem] flex-col items-center justify-center border-b border-r border-[var(--border)] text-sm ${
                  inMonth ? '' : 'opacity-35'
                } ${isSelected ? 'bg-[var(--accent)]/15' : ''}`}
              >
                <span
                  className={`flex h-7 w-7 items-center justify-center rounded-full ${
                    isToday
                      ? 'bg-[var(--accent)] font-semibold text-white'
                      : ''
                  }`}
                >
                  {day.getDate()}
                </span>
                {hasEvents && (
                  <span
                    className={`absolute bottom-1 h-1 w-1 rounded-full ${
                      isToday ? 'bg-white' : 'bg-[var(--accent)]'
                    }`}
                  />
                )}
              </button>
            )
          })}
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-[var(--text-muted)]">
          {formatDayHeading(selectedDay)}
        </p>
        {canWrite && (
          <button
            type="button"
            onClick={() => openCreate(selectedDay)}
            className="text-sm font-medium text-[var(--accent)]"
          >
            + Agenda
          </button>
        )}
      </div>

      {eventsQuery.error && (
        <p className="mt-2 text-sm text-[var(--danger)]">
          {eventsQuery.error.message}
        </p>
      )}

      {eventsQuery.isLoading ? (
        <p className="mt-3 text-sm text-[var(--text-muted)]">Cargando…</p>
      ) : dayEvents.length === 0 ? (
        <p className="mt-3 rounded-2xl border border-dashed border-[var(--border)] px-4 py-8 text-center text-sm text-[var(--text-muted)]">
          Sin agendas este día.
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {dayEvents.map((ev) => (
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
                    <span
                      className={`mr-1 inline-block rounded px-1 py-0.5 text-[10px] ${EVENT_TYPE_COLOR[ev.type]}`}
                    >
                      {EVENT_TYPE_LABEL[ev.type]}
                    </span>
                    {formatTime(ev.startsAt)}–{formatTime(ev.endsAt)}
                  </p>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}

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
