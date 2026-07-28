import { canInstallField } from './crm'

export const CALENDAR_EVENT_TYPES = [
  'visit',
  'support',
  'installation',
] as const
export type CalendarEventType = (typeof CALENDAR_EVENT_TYPES)[number]

export const CALENDAR_EVENT_STATUSES = [
  'scheduled',
  'done',
  'cancelled',
] as const
export type CalendarEventStatus = (typeof CALENDAR_EVENT_STATUSES)[number]

export type CalendarEvent = {
  id: string
  type: CalendarEventType
  title: string
  notes: string
  startsAt: string
  endsAt: string
  allDay: boolean
  status: CalendarEventStatus
  clientId: string | null
  assignedUserId: string | null
  address: string
  createdBy: string | null
  createdAt: string
  updatedAt: string
}

export type CreateCalendarEventPayload = {
  type: CalendarEventType
  title: string
  notes?: string
  startsAt: string
  endsAt: string
  allDay?: boolean
  status?: CalendarEventStatus
  clientId?: string | null
  assignedUserId?: string | null
  address?: string
}

export const EVENT_TYPE_LABEL: Record<CalendarEventType, string> = {
  visit: 'Visita',
  support: 'Soporte',
  installation: 'Instalación',
}

export const EVENT_STATUS_LABEL: Record<CalendarEventStatus, string> = {
  scheduled: 'Agendada',
  done: 'Hecha',
  cancelled: 'Cancelada',
}

export const EVENT_TYPE_COLOR: Record<CalendarEventType, string> = {
  visit: 'bg-sky-500/80 text-white',
  support: 'bg-amber-500/85 text-white',
  installation: 'bg-emerald-500/85 text-white',
}

export const EVENT_TYPE_DOT: Record<CalendarEventType, string> = {
  visit: 'bg-sky-400',
  support: 'bg-amber-400',
  installation: 'bg-emerald-400',
}

export function canWriteCalendar(tenantRole?: string | null) {
  return canInstallField(tenantRole)
}

export function pad2(n: number) {
  return String(n).padStart(2, '0')
}

export function toLocalDateKey(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

export function parseLocalDateKey(key: string) {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, (m ?? 1) - 1, d ?? 1, 0, 0, 0, 0)
}

export function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0)
}

export function endOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999)
}

/** Week starts Monday */
export function startOfWeek(d: Date) {
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  const out = startOfDay(d)
  out.setDate(out.getDate() + diff)
  return out
}

export function endOfWeek(d: Date) {
  const start = startOfWeek(d)
  const out = new Date(start)
  out.setDate(out.getDate() + 6)
  return endOfDay(out)
}

export function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0)
}

export function endOfMonth(d: Date) {
  return endOfDay(new Date(d.getFullYear(), d.getMonth() + 1, 0))
}

export function startOfYear(d: Date) {
  return new Date(d.getFullYear(), 0, 1, 0, 0, 0, 0)
}

export function endOfYear(d: Date) {
  return endOfDay(new Date(d.getFullYear(), 11, 31))
}

export function addDays(d: Date, n: number) {
  const out = new Date(d)
  out.setDate(out.getDate() + n)
  return out
}

export function addMonths(d: Date, n: number) {
  const out = new Date(d)
  out.setMonth(out.getMonth() + n)
  return out
}

export function sameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

export function eventOverlapsRange(
  event: CalendarEvent,
  from: Date,
  to: Date,
) {
  const s = new Date(event.startsAt).getTime()
  const e = new Date(event.endsAt).getTime()
  return s < to.getTime() && e > from.getTime()
}

export function eventsOnLocalDay(events: CalendarEvent[], day: Date) {
  const from = startOfDay(day)
  const to = endOfDay(day)
  return events
    .filter((e) => eventOverlapsRange(e, from, to))
    .sort(
      (a, b) =>
        new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime(),
    )
}

export const WEEKDAY_SHORT = ['LU', 'MA', 'MI', 'JU', 'VI', 'SA', 'DO']

export function formatTime(iso: string) {
  const d = new Date(iso)
  return d.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function formatDayHeading(d: Date) {
  const weekday = WEEKDAY_SHORT[d.getDay() === 0 ? 6 : d.getDay() - 1]
  const month = d
    .toLocaleDateString('es', { month: 'short' })
    .replace(/\./g, '')
    .trim()
  return `${weekday} ${d.getDate()} ${month} ${d.getFullYear()}`
}

export function formatMonthHeading(d: Date) {
  const month = d.toLocaleDateString(undefined, { month: 'long' })
  return `${month} ${d.getFullYear()}`
}

/** Value for <input type="datetime-local"> */
export function toDatetimeLocalValue(d: Date) {
  return `${toLocalDateKey(d)}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

export function fromDatetimeLocalValue(value: string) {
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

export function defaultEventTimes(base = new Date()) {
  const start = new Date(base)
  start.setMinutes(0, 0, 0)
  if (start.getTime() <= Date.now()) {
    start.setHours(start.getHours() + 1)
  }
  const end = new Date(start)
  end.setHours(end.getHours() + 1)
  return { start, end }
}
