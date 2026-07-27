import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { apiFetch } from '../lib/api'

export type NotificationAudienceVariant = 'admin' | 'tenant'

export type NotificationSummary = {
  unreadCount: number
  ticketBadge: boolean
}

export type AppNotificationItem = {
  id: string
  title: string
  body: string
  link: string
  readAt: string | null
  createdAt: string
  type: string
}

function formatRelative(iso: string) {
  const d = new Date(iso)
  const diff = Date.now() - d.getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return 'ahora'
  if (mins < 60) return `hace ${mins} min`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `hace ${hours} h`
  const days = Math.floor(hours / 24)
  return `hace ${days} d`
}

export function useNotificationSummary(variant: NotificationAudienceVariant) {
  const prefix = variant === 'admin' ? '/admin' : '/app'
  return useQuery({
    queryKey: ['notifications', 'summary', variant],
    queryFn: () =>
      apiFetch<NotificationSummary>(`${prefix}/notifications/summary`),
    refetchInterval: 15_000,
    refetchIntervalInBackground: true,
  })
}

export function NotificationBell({
  variant,
}: {
  variant: NotificationAudienceVariant
}) {
  const prefix = variant === 'admin' ? '/admin' : '/app'
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  const summaryQuery = useNotificationSummary(variant)

  const listQuery = useQuery({
    queryKey: ['notifications', 'list', variant],
    queryFn: () =>
      apiFetch<AppNotificationItem[]>(`${prefix}/notifications?limit=20`),
    enabled: open,
    refetchInterval: open ? 15_000 : false,
  })

  const markRead = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`${prefix}/notifications/${id}/read`, { method: 'POST' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['notifications'] })
    },
  })

  const markAll = useMutation({
    mutationFn: () =>
      apiFetch(`${prefix}/notifications/read-all`, { method: 'POST' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['notifications'] })
    },
  })

  useEffect(() => {
    if (!open) return
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const unread = summaryQuery.data?.unreadCount ?? 0
  const items = listQuery.data ?? []

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        aria-label="Notificaciones"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="relative rounded-md border border-[var(--border)] p-2 text-[var(--text-muted)] transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 inline-flex min-w-[1.1rem] items-center justify-center rounded-full bg-[var(--danger)] px-1 text-[10px] font-semibold text-white">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] shadow-lg">
          <div className="flex items-center justify-between border-b border-[var(--border)] px-3 py-2">
            <p className="text-sm font-medium">Notificaciones</p>
            <button
              type="button"
              disabled={unread === 0 || markAll.isPending}
              onClick={() => markAll.mutate()}
              className="text-xs text-[var(--accent)] disabled:opacity-40"
            >
              Marcar leídas
            </button>
          </div>
          <div className="max-h-80 overflow-y-auto">
            {listQuery.isLoading && (
              <p className="px-3 py-4 text-sm text-[var(--text-muted)]">
                Cargando…
              </p>
            )}
            {!listQuery.isLoading && items.length === 0 && (
              <p className="px-3 py-4 text-sm text-[var(--text-muted)]">
                Sin notificaciones
              </p>
            )}
            {items.map((n) => (
              <Link
                key={n.id}
                to={n.link || '#'}
                onClick={() => {
                  if (!n.readAt) markRead.mutate(n.id)
                  setOpen(false)
                }}
                className={[
                  'block border-b border-[var(--border)] px-3 py-2.5 transition last:border-0 hover:bg-[var(--bg)]',
                  n.readAt ? 'opacity-70' : '',
                ].join(' ')}
              >
                <div className="flex items-start gap-2">
                  {!n.readAt && (
                    <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[var(--danger)]" />
                  )}
                  <div className={n.readAt ? 'pl-4' : ''}>
                    <p className="text-sm font-medium leading-snug">{n.title}</p>
                    {n.body && (
                      <p className="mt-0.5 line-clamp-2 text-xs text-[var(--text-muted)]">
                        {n.body}
                      </p>
                    )}
                    <p className="mt-1 text-[11px] text-[var(--text-muted)]">
                      {formatRelative(n.createdAt)}
                    </p>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
