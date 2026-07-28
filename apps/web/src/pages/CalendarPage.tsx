import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthContext'
import { apiFetch } from '../lib/api'
import {
  addDays,
  addMonths,
  canWriteCalendar,
  endOfDay,
  endOfMonth,
  endOfWeek,
  endOfYear,
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
  startOfYear,
  toLocalDateKey,
  WEEKDAY_SHORT,
  type CalendarEvent,
} from '../lib/calendar'
import { PanelShell } from '../components/PanelShell'
import {
  CalendarEventFormModal,
  type CalendarEventFormDefaults,
} from '../components/CalendarEventFormModal'

type ViewMode = 'month' | 'week' | 'day' | 'year'

export function CalendarPage() {
  const { user } = useAuth()
  const canWrite = canWriteCalendar(user?.tenantRole)
  const [view, setView] = useState<ViewMode>('month')
  const [cursor, setCursor] = useState(() => startOfDay(new Date()))
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<CalendarEvent | null>(null)
  const [defaults, setDefaults] = useState<CalendarEventFormDefaults | null>(
    null,
  )

  const range = useMemo(() => rangeForView(view, cursor), [view, cursor])

  const eventsQuery = useQuery({
    queryKey: [
      'app',
      'calendar',
      'events',
      range.from.toISOString(),
      range.to.toISOString(),
    ],
    queryFn: () =>
      apiFetch<CalendarEvent[]>(
        `/app/calendar/events?from=${encodeURIComponent(range.from.toISOString())}&to=${encodeURIComponent(range.to.toISOString())}`,
      ),
  })

  const events = eventsQuery.data ?? []

  function openCreate(day?: Date, partial?: CalendarEventFormDefaults) {
    setEditing(null)
    setDefaults({
      startsAt: day ?? cursor,
      ...partial,
    })
    setFormOpen(true)
  }

  function openEdit(ev: CalendarEvent) {
    setDefaults(null)
    setEditing(ev)
    setFormOpen(true)
  }

  function goToday() {
    setCursor(startOfDay(new Date()))
    setView('day')
  }

  function goPrev() {
    if (view === 'month') setCursor((c) => addMonths(startOfMonth(c), -1))
    else if (view === 'week') setCursor((c) => addDays(c, -7))
    else if (view === 'day') setCursor((c) => addDays(c, -1))
    else setCursor((c) => new Date(c.getFullYear() - 1, c.getMonth(), 1))
  }

  function goNext() {
    if (view === 'month') setCursor((c) => addMonths(startOfMonth(c), 1))
    else if (view === 'week') setCursor((c) => addDays(c, 7))
    else if (view === 'day') setCursor((c) => addDays(c, 1))
    else setCursor((c) => new Date(c.getFullYear() + 1, c.getMonth(), 1))
  }

  const heading =
    view === 'day'
      ? formatDayHeading(cursor)
      : view === 'year'
        ? String(cursor.getFullYear())
        : view === 'week'
          ? `Sem ${startOfWeek(cursor).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`
          : formatMonthHeading(cursor)

  return (
    <PanelShell
      title="Calendario"
      subtitle="Visitas, soporte e instalaciones"
      variant="tenant"
    >
      <div className="mb-4 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        <div className="flex items-center gap-1.5 justify-self-start">
          <button
            type="button"
            onClick={goToday}
            className="rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-xs hover:bg-[var(--bg)] sm:text-sm"
          >
            Hoy
          </button>
          <button
            type="button"
            onClick={goPrev}
            className="rounded-lg border border-[var(--border)] px-2 py-1.5 text-sm hover:bg-[var(--bg)]"
            aria-label="Anterior"
          >
            ‹
          </button>
          <button
            type="button"
            onClick={goNext}
            className="rounded-lg border border-[var(--border)] px-2 py-1.5 text-sm hover:bg-[var(--bg)]"
            aria-label="Siguiente"
          >
            ›
          </button>
        </div>

        <h2 className="min-w-0 justify-self-center truncate px-1 text-center text-base font-semibold sm:text-lg">
          {heading}
        </h2>

        <div className="flex items-center justify-end gap-2 justify-self-end">
          <div className="flex overflow-hidden rounded-lg border border-[var(--border)]">
            {(
              [
                ['month', 'Mes'],
                ['week', 'Sem'],
                ['day', 'Día'],
                ['year', 'Año'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setView(id)}
                className={`px-2 py-1 text-xs sm:px-2.5 sm:py-1.5 ${
                  view === id
                    ? 'bg-[var(--accent)] text-white'
                    : 'hover:bg-[var(--bg)]'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {canWrite && (
            <button
              type="button"
              onClick={() => openCreate()}
              aria-label="Nueva agenda"
              title="Nueva agenda"
              className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)] md:inline-flex"
            >
              <svg
                width="20"
                height="20"
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
        </div>
      </div>

      <div className="mb-3 flex flex-wrap gap-3 text-xs text-[var(--text-muted)]">
        {(Object.keys(EVENT_TYPE_LABEL) as Array<keyof typeof EVENT_TYPE_LABEL>).map(
          (t) => (
            <span key={t} className="inline-flex items-center gap-1.5">
              <span className={`h-2 w-2 rounded-full ${EVENT_TYPE_DOT[t]}`} />
              {EVENT_TYPE_LABEL[t]}
            </span>
          ),
        )}
      </div>

      {eventsQuery.error && (
        <p className="mb-3 text-sm text-[var(--danger)]">
          {eventsQuery.error.message}
        </p>
      )}

      <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)]">
        {view === 'month' && (
          <MonthView
            cursor={cursor}
            events={events}
            onSelectDay={(d) => {
              setCursor(d)
              setView('day')
            }}
            onCreateDay={canWrite ? (d) => openCreate(d) : undefined}
            onOpenEvent={openEdit}
          />
        )}
        {view === 'week' && (
          <WeekView
            cursor={cursor}
            events={events}
            onOpenEvent={openEdit}
            onCreateSlot={
              canWrite
                ? (d) => openCreate(d)
                : undefined
            }
          />
        )}
        {view === 'day' && (
          <DayView
            cursor={cursor}
            events={events}
            onOpenEvent={openEdit}
          />
        )}
        {view === 'year' && (
          <YearView
            cursor={cursor}
            events={events}
            onSelectMonth={(d) => {
              setCursor(d)
              setView('month')
            }}
          />
        )}
      </div>

      {canWrite && (
        <button
          type="button"
          onClick={() => openCreate()}
          aria-label="Nueva agenda"
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
    </PanelShell>
  )
}

function rangeForView(view: ViewMode, cursor: Date) {
  if (view === 'month') {
    const monthStart = startOfMonth(cursor)
    const gridStart = startOfWeek(monthStart)
    const monthEnd = endOfMonth(cursor)
    const gridEnd = endOfWeek(monthEnd)
    return { from: gridStart, to: gridEnd }
  }
  if (view === 'week') {
    return { from: startOfWeek(cursor), to: endOfWeek(cursor) }
  }
  if (view === 'day') {
    return { from: startOfDay(cursor), to: endOfDay(cursor) }
  }
  return { from: startOfYear(cursor), to: endOfYear(cursor) }
}

function MonthView({
  cursor,
  events,
  onSelectDay,
  onCreateDay,
  onOpenEvent,
}: {
  cursor: Date
  events: CalendarEvent[]
  onSelectDay: (d: Date) => void
  onCreateDay?: (d: Date) => void
  onOpenEvent: (e: CalendarEvent) => void
}) {
  const monthStart = startOfMonth(cursor)
  const gridStart = startOfWeek(monthStart)
  const days = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i))
  const today = startOfDay(new Date())

  return (
    <div>
      <div className="grid grid-cols-7 border-b border-[var(--border)] bg-[var(--bg)] text-center text-xs font-medium text-[var(--text-muted)]">
        {WEEKDAY_SHORT.map((d) => (
          <div key={d} className="px-1 py-2">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((day) => {
          const inMonth = day.getMonth() === cursor.getMonth()
          const dayEvents = eventsOnLocalDay(events, day).filter(
            (e) => e.status !== 'cancelled',
          )
          const isToday = sameDay(day, today)
          return (
            <div
              key={toLocalDateKey(day)}
              className={`aspect-square overflow-hidden border-b border-r border-[var(--border)] p-1 sm:aspect-auto sm:min-h-[5rem] sm:p-1.5 lg:min-h-[5.5rem] ${
                inMonth ? '' : 'bg-[var(--bg)]/40 opacity-60'
              }`}
            >
              <div className="mb-0.5 flex items-center justify-between gap-0.5 sm:mb-1">
                <button
                  type="button"
                  onClick={() => onSelectDay(day)}
                  className={`flex h-6 w-6 items-center justify-center rounded-full text-xs sm:h-7 sm:w-7 sm:text-sm ${
                    isToday
                      ? 'bg-[var(--accent)] font-semibold text-white'
                      : 'hover:bg-[var(--bg)]'
                  }`}
                >
                  {day.getDate()}
                </button>
                {onCreateDay && (
                  <button
                    type="button"
                    onClick={() => onCreateDay(day)}
                    className="hidden rounded px-1 text-xs text-[var(--text-muted)] hover:bg-[var(--bg)] hover:text-[var(--text)] sm:inline"
                    title="Nueva agenda"
                  >
                    +
                  </button>
                )}
              </div>
              <div className="space-y-0.5">
                {dayEvents.slice(0, 2).map((ev) => (
                  <button
                    key={ev.id}
                    type="button"
                    onClick={() => onOpenEvent(ev)}
                    className={`block w-full truncate rounded px-0.5 py-0.5 text-left text-[9px] leading-tight sm:px-1 sm:text-[10px] ${EVENT_TYPE_COLOR[ev.type]}`}
                    title={ev.title}
                  >
                    {!ev.allDay && (
                      <span className="hidden opacity-90 sm:inline">
                        {formatTime(ev.startsAt)}{' '}
                      </span>
                    )}
                    {ev.title}
                  </button>
                ))}
                {dayEvents.length > 2 && (
                  <button
                    type="button"
                    onClick={() => onSelectDay(day)}
                    className="px-0.5 text-[9px] text-[var(--text-muted)] hover:underline sm:px-1 sm:text-[10px]"
                  >
                    +{dayEvents.length - 2}
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function WeekView({
  cursor,
  events,
  onOpenEvent,
  onCreateSlot,
}: {
  cursor: Date
  events: CalendarEvent[]
  onOpenEvent: (e: CalendarEvent) => void
  onCreateSlot?: (d: Date) => void
}) {
  const start = startOfWeek(cursor)
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i))
  const hours = Array.from({ length: 24 }, (_, i) => i)
  const today = startOfDay(new Date())

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[720px]">
        <div className="grid grid-cols-[3.5rem_repeat(7,minmax(0,1fr))] border-b border-[var(--border)] bg-[var(--bg)]">
          <div />
          {days.map((day) => (
            <div
              key={toLocalDateKey(day)}
              className={`px-2 py-2 text-center text-sm ${
                sameDay(day, today) ? 'font-semibold text-[var(--accent)]' : ''
              }`}
            >
              <div className="text-xs text-[var(--text-muted)]">
                {WEEKDAY_SHORT[day.getDay() === 0 ? 6 : day.getDay() - 1]}
              </div>
              <div>{day.getDate()}</div>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-[3.5rem_repeat(7,minmax(0,1fr))]">
          {hours.map((hour) => (
            <div key={hour} className="contents">
              <div className="border-b border-r border-[var(--border)] px-1 py-2 text-right text-[10px] text-[var(--text-muted)]">
                {padHour(hour)}
              </div>
              {days.map((day) => {
                const slot = new Date(day)
                slot.setHours(hour, 0, 0, 0)
                const slotEvents = events.filter((e) => {
                  const s = new Date(e.startsAt)
                  return (
                    sameDay(s, day) &&
                    s.getHours() === hour &&
                    e.status !== 'cancelled'
                  )
                })
                return (
                  <div
                    key={`${toLocalDateKey(day)}-${hour}`}
                    className="relative min-h-[3rem] border-b border-r border-[var(--border)] p-0.5"
                    onDoubleClick={() => onCreateSlot?.(slot)}
                  >
                    {slotEvents.map((ev) => (
                      <button
                        key={ev.id}
                        type="button"
                        onClick={() => onOpenEvent(ev)}
                        className={`mb-0.5 block w-full truncate rounded px-1 py-0.5 text-left text-[10px] ${EVENT_TYPE_COLOR[ev.type]}`}
                      >
                        {ev.title}
                      </button>
                    ))}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function DayView({
  cursor,
  events,
  onOpenEvent,
}: {
  cursor: Date
  events: CalendarEvent[]
  onOpenEvent: (e: CalendarEvent) => void
}) {
  const dayEvents = eventsOnLocalDay(events, cursor).filter(
    (e) => e.status !== 'cancelled',
  )

  return (
    <div className="p-4">
      {dayEvents.length === 0 ? (
        <p className="py-10 text-center text-sm text-[var(--text-muted)]">
          No hay agendamientos para este día.
        </p>
      ) : (
        <ul className="space-y-2">
          {dayEvents.map((ev) => (
            <li key={ev.id}>
              <button
                type="button"
                onClick={() => onOpenEvent(ev)}
                className="flex w-full items-start gap-3 rounded-xl border border-[var(--border)] bg-[var(--bg)] px-4 py-3 text-left hover:border-[var(--accent)]/40"
              >
                <span
                  className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${EVENT_TYPE_DOT[ev.type]}`}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="font-medium">{ev.title}</span>
                    <span className="text-xs text-[var(--text-muted)]">
                      {EVENT_TYPE_LABEL[ev.type]}
                    </span>
                  </div>
                  <p className="text-sm text-[var(--text-muted)]">
                    {formatTime(ev.startsAt)} – {formatTime(ev.endsAt)}
                    {ev.address ? ` · ${ev.address}` : ''}
                  </p>
                  {ev.notes ? (
                    <p className="mt-1 text-xs text-[var(--text-muted)]">
                      {ev.notes}
                    </p>
                  ) : null}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function YearView({
  cursor,
  events,
  onSelectMonth,
}: {
  cursor: Date
  events: CalendarEvent[]
  onSelectMonth: (d: Date) => void
}) {
  const months = Array.from(
    { length: 12 },
    (_, i) => new Date(cursor.getFullYear(), i, 1),
  )

  return (
    <div className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {months.map((month) => {
        const mStart = startOfMonth(month)
        const gridStart = startOfWeek(mStart)
        const days = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i))
        const count = events.filter(
          (e) =>
            e.status !== 'cancelled' &&
            new Date(e.startsAt).getMonth() === month.getMonth() &&
            new Date(e.startsAt).getFullYear() === month.getFullYear(),
        ).length
        return (
          <button
            key={month.getMonth()}
            type="button"
            onClick={() => onSelectMonth(month)}
            className="rounded-xl border border-[var(--border)] bg-[var(--bg)] p-3 text-left hover:border-[var(--accent)]/50"
          >
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-semibold capitalize">
                {month.toLocaleDateString(undefined, { month: 'long' })}
              </span>
              {count > 0 && (
                <span className="text-xs text-[var(--text-muted)]">
                  {count}
                </span>
              )}
            </div>
            <div className="grid grid-cols-7 gap-px text-center text-[9px] text-[var(--text-muted)]">
              {WEEKDAY_SHORT.map((d) => (
                <div key={d}>{d[0]}</div>
              ))}
              {days.map((day) => {
                const inMonth = day.getMonth() === month.getMonth()
                const has = eventsOnLocalDay(events, day).some(
                  (e) => e.status !== 'cancelled',
                )
                return (
                  <div
                    key={toLocalDateKey(day)}
                    className={`py-0.5 ${inMonth ? '' : 'opacity-25'} ${
                      has ? 'font-bold text-[var(--accent)]' : ''
                    }`}
                  >
                    {day.getDate()}
                  </div>
                )
              })}
            </div>
          </button>
        )
      })}
    </div>
  )
}

function padHour(h: number) {
  return `${String(h).padStart(2, '0')}:00`
}
