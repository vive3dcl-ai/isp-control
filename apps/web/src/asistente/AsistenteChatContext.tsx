import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { API_URL, apiFetch, getToken } from '../lib/api'
import type { TenantModuleCard } from '../lib/modules'

export type AsistenteChatRole = 'user' | 'assistant' | 'system'

export type AsistenteUiMessage = {
  id: string
  role: AsistenteChatRole
  content: string
  /** Tools/skills de ese turno (quedan en el timeline). */
  activities?: AsistenteActivity[]
}

export type AsistentePanelMode = 'closed' | 'open' | 'minimized'

export type AsistenteRestorePoint = {
  id: string
  sessionId: string
  toolSlug: string
  title: string
  summary: string
  status: 'active' | 'restored' | 'void'
  hasUndo: boolean
  createdAt: string
}

export type AsistenteActivity = {
  id: string
  kind: 'tool' | 'skill' | 'plan'
  slug: string
  name: string
  status: 'running' | 'done' | 'error'
  detail?: string
  /** Tool de escritura/modificación */
  mutates?: boolean
  at: string
}

export type AsistenteSideView =
  | {
      kind: 'client'
      clientId: string
      title?: string
      mode?: 'summary' | 'full'
    }
  | {
      kind: 'onu'
      onuId?: string
      oltId: string
      onuIf: string
      title?: string
      mode?: 'summary' | 'full'
    }
  | {
      kind: 'service'
      serviceId: string
      clientId?: string
      title?: string
      mode?: 'summary' | 'full'
    }
  | {
      kind: 'device'
      deviceId: string
      title?: string
      mode?: 'summary' | 'full'
    }

/** v2: defaults nuevos (solo lectura on, thinking off). */
const LS_READ_ONLY = 'isp.asistente.readOnly.v2'
const LS_RESTORE = 'isp.asistente.restorePoints'
const LS_THINKING = 'isp.asistente.thinking.v2'

function readLsBool(key: string, fallback: boolean) {
  try {
    const v = localStorage.getItem(key)
    if (v === '1' || v === 'true') return true
    if (v === '0' || v === 'false') return false
  } catch {
    /* ignore */
  }
  return fallback
}

function writeLsBool(key: string, value: boolean) {
  try {
    localStorage.setItem(key, value ? '1' : '0')
  } catch {
    /* ignore */
  }
}

export type AsistenteChatSessionSummary = {
  sessionId: string
  title: string
  updatedAt: string
  createdAt?: string
  messageCount?: number
}

type AsistenteChatContextValue = {
  mode: AsistentePanelMode
  open: boolean
  minimized: boolean
  setOpen: (open: boolean) => void
  minimize: () => void
  expand: () => void
  close: () => void
  toggle: () => void
  messages: AsistenteUiMessage[]
  activities: AsistenteActivity[]
  sending: boolean
  error: string | null
  clearError: () => void
  moduleEnabled: boolean
  moduleLoading: boolean
  sessionId: string
  readOnly: boolean
  setReadOnly: (v: boolean) => void
  restorePointsEnabled: boolean
  setRestorePointsEnabled: (v: boolean) => void
  thinkingEnabled: boolean
  setThinkingEnabled: (v: boolean) => void
  restorePoints: AsistenteRestorePoint[]
  restorePointsLoading: boolean
  restoringId: string | null
  restorePoint: (id: string) => Promise<void>
  refreshRestorePoints: () => void
  chatSessions: AsistenteChatSessionSummary[]
  chatSessionsLoading: boolean
  refreshChatSessions: () => void
  loadSession: (sessionId: string) => Promise<void>
  deleteSession: (sessionId: string) => Promise<void>
  send: (text: string) => Promise<void>
  stop: () => void
  clear: () => void
  newSession: () => void
  sideView: AsistenteSideView | null
  openSideView: (view: AsistenteSideView) => void
  closeSideView: () => void
}

const AsistenteChatContext = createContext<AsistenteChatContextValue | null>(
  null,
)

function newId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function newSessionId() {
  return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

async function streamAsistenteChat(
  body: Record<string, unknown>,
  handlers: {
    onActivity: (a: AsistenteActivity) => void
    onUi: (view: AsistenteSideView | null) => void
    onContext?: (info: {
      summary: string
      keptFromEnd: number
    }) => void
    onReply: (payload: {
      reply: string
      activities?: AsistenteActivity[]
      contextSummary?: string | null
      contextCompacted?: boolean
      keptFromEnd?: number | null
    }) => void
    onError: (message: string) => void
  },
  signal?: AbortSignal,
) {
  const token = getToken()
  const res = await fetch(`${API_URL}/app/settings/modules/asistente-ia/chat/stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
    signal,
  })

  if (!res.ok) {
    let message = 'Request failed'
    try {
      const errBody = (await res.json()) as { message?: string | string[] }
      if (Array.isArray(errBody.message)) message = errBody.message.join(', ')
      else if (errBody.message) message = errBody.message
    } catch {
      /* ignore */
    }
    throw new Error(message)
  }

  if (!res.body) {
    throw new Error('Sin stream de respuesta')
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let gotReply = false
  let gotError = false

  try {
    while (true) {
      if (signal?.aborted) {
        await reader.cancel().catch(() => undefined)
        throw new DOMException('Aborted', 'AbortError')
      }
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const chunks = buffer.split('\n\n')
      buffer = chunks.pop() ?? ''
      for (const chunk of chunks) {
        const line = chunk
          .split('\n')
          .map((l) => l.trim())
          .find((l) => l.startsWith('data:'))
        if (!line) continue
        const raw = line.slice(5).trim()
        if (!raw) continue
        let event: {
          type?: string
          activity?: AsistenteActivity
          view?: AsistenteSideView | { kind: 'close' }
          reply?: string
          message?: string
          summary?: string
          keptFromEnd?: number
          activities?: AsistenteActivity[]
          contextSummary?: string | null
          contextCompacted?: boolean
        }
        try {
          event = JSON.parse(raw) as typeof event
        } catch {
          continue
        }
        if (event.type === 'activity' && event.activity) {
          if (!event.activity.slug?.startsWith('_')) {
            handlers.onActivity(event.activity)
          }
        } else if (event.type === 'context' && event.summary) {
          handlers.onContext?.({
            summary: event.summary,
            keptFromEnd: event.keptFromEnd ?? 0,
          })
        } else if (event.type === 'ui' && event.view) {
          if (event.view.kind === 'close') handlers.onUi(null)
          else handlers.onUi(event.view as AsistenteSideView)
        } else if (event.type === 'reply' && typeof event.reply === 'string') {
          gotReply = true
          handlers.onReply({
            reply: event.reply,
            activities: event.activities,
            contextSummary: event.contextSummary,
            contextCompacted: event.contextCompacted,
            keptFromEnd: event.keptFromEnd,
          })
        } else if (event.type === 'error') {
          gotError = true
          handlers.onError(event.message || 'Error del asistente')
        }
      }
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    throw err
  }

  if (!gotReply && !gotError) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    const res2 = await apiFetch<{
      reply: string
      activities?: AsistenteActivity[]
      contextSummary?: string | null
      contextCompacted?: boolean
      keptFromEnd?: number | null
    }>('/app/settings/modules/asistente-ia/chat', {
      method: 'POST',
      body: JSON.stringify(body),
      signal,
    })
    handlers.onReply({
      reply: res2.reply?.trim() || '(sin respuesta)',
      activities: res2.activities,
      contextSummary: res2.contextSummary,
      contextCompacted: res2.contextCompacted,
      keptFromEnd: res2.keptFromEnd,
    })
  }
}

export function AsistenteChatProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const [mode, setMode] = useState<AsistentePanelMode>('closed')
  const [messages, setMessages] = useState<AsistenteUiMessage[]>([])
  const [activities, setActivities] = useState<AsistenteActivity[]>([])
  const [contextSummary, setContextSummary] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sessionId, setSessionId] = useState(newSessionId)
  const [readOnly, setReadOnlyState] = useState(() =>
    readLsBool(LS_READ_ONLY, true),
  )
  const [restorePointsEnabled, setRestorePointsState] = useState(() =>
    readLsBool(LS_RESTORE, true),
  )
  const [thinkingEnabled, setThinkingState] = useState(() =>
    readLsBool(LS_THINKING, false),
  )
  const [restoringId, setRestoringId] = useState<string | null>(null)
  const [sideView, setSideView] = useState<AsistenteSideView | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const modulesQuery = useQuery({
    queryKey: ['app', 'settings', 'modules'],
    queryFn: () => apiFetch<TenantModuleCard[]>('/app/settings/modules'),
    staleTime: 60_000,
  })

  const moduleEnabled = !!modulesQuery.data?.find(
    (m) => m.id === 'asistente_ia' && m.contracted,
  )

  const restoreQueryEnabled =
    moduleEnabled && mode !== 'closed' && restorePointsEnabled && !readOnly

  const restorePointsQuery = useQuery({
    queryKey: ['app', 'asistente-ia', 'restore-points', sessionId],
    queryFn: () =>
      apiFetch<AsistenteRestorePoint[]>(
        `/app/settings/modules/asistente-ia/restore-points?sessionId=${encodeURIComponent(sessionId)}`,
      ),
    enabled: restoreQueryEnabled,
    staleTime: 15_000,
  })

  const chatSessionsQuery = useQuery({
    queryKey: ['app', 'asistente-ia', 'sessions'],
    queryFn: () =>
      apiFetch<AsistenteChatSessionSummary[]>(
        '/app/settings/modules/asistente-ia/sessions',
      ),
    enabled: moduleEnabled && mode !== 'closed',
    staleTime: 20_000,
  })

  const setReadOnly = useCallback((v: boolean) => {
    setReadOnlyState(v)
    writeLsBool(LS_READ_ONLY, v)
    if (v) {
      setRestorePointsState(false)
      writeLsBool(LS_RESTORE, false)
    }
  }, [])

  const setRestorePointsEnabled = useCallback((v: boolean) => {
    if (v) {
      setReadOnlyState(false)
      writeLsBool(LS_READ_ONLY, false)
    }
    setRestorePointsState(v)
    writeLsBool(LS_RESTORE, v)
  }, [])

  const setThinkingEnabled = useCallback((v: boolean) => {
    setThinkingState(v)
    writeLsBool(LS_THINKING, v)
  }, [])

  const setOpen = useCallback((next: boolean) => {
    setMode(next ? 'open' : 'closed')
  }, [])

  const minimize = useCallback(() => {
    setMode((m) => (m === 'open' ? 'minimized' : m))
  }, [])

  const expand = useCallback(() => {
    setMode('open')
  }, [])

  const close = useCallback(() => {
    setMode('closed')
    setSideView(null)
  }, [])

  const openSideView = useCallback((view: AsistenteSideView) => {
    setSideView(view)
    setMode('open')
  }, [])

  const closeSideView = useCallback(() => {
    setSideView(null)
  }, [])

  const toggle = useCallback(() => {
    setMode((m) => {
      if (m === 'open') {
        setSideView(null)
        return 'closed'
      }
      return 'open'
    })
  }, [])

  const clear = useCallback(() => {
    setMessages([])
    setActivities([])
    setContextSummary('')
    setError(null)
  }, [])

  const newSession = useCallback(() => {
    setMessages([])
    setActivities([])
    setContextSummary('')
    setError(null)
    setSideView(null)
    setSessionId(newSessionId())
    setMode('open')
  }, [])

  const refreshRestorePoints = useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: ['app', 'asistente-ia', 'restore-points'],
    })
  }, [queryClient])

  const refreshChatSessions = useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: ['app', 'asistente-ia', 'sessions'],
    })
  }, [queryClient])

  const loadSession = useCallback(
    async (targetSessionId: string) => {
      setError(null)
      try {
        const detail = await apiFetch<{
          sessionId: string
          title: string
          contextSummary?: string
          messages: Array<{
            role: string
            content: string
            id?: string
            activities?: AsistenteActivity[]
          }>
        }>(
          `/app/settings/modules/asistente-ia/sessions/${encodeURIComponent(targetSessionId)}`,
        )
        setSessionId(detail.sessionId)
        setContextSummary(detail.contextSummary?.trim() || '')
        setMessages(
          (detail.messages ?? []).map((m) => ({
            id: m.id || newId(),
            role:
              m.role === 'assistant'
                ? 'assistant'
                : m.role === 'system'
                  ? 'system'
                  : 'user',
            content: m.content,
            ...(Array.isArray(m.activities) && m.activities.length
              ? {
                  activities: m.activities.filter(
                    (a) => a && !String(a.slug || '').startsWith('_'),
                  ),
                }
              : {}),
          })),
        )
        setActivities([])
        setSideView(null)
        setMode('open')
        refreshRestorePoints()
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    },
    [refreshRestorePoints],
  )

  const deleteSession = useCallback(
    async (targetSessionId: string) => {
      setError(null)
      try {
        await apiFetch(
          `/app/settings/modules/asistente-ia/sessions/${encodeURIComponent(targetSessionId)}`,
          { method: 'DELETE' },
        )
        if (targetSessionId === sessionId) {
          setMessages([])
          setActivities([])
          setContextSummary('')
          setSessionId(newSessionId())
        }
        refreshChatSessions()
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    },
    [refreshChatSessions, sessionId],
  )

  const restorePoint = useCallback(
    async (id: string) => {
      if (restoringId) return
      setRestoringId(id)
      setError(null)
      try {
        await apiFetch(
          `/app/settings/modules/asistente-ia/restore-points/${id}/restore`,
          { method: 'POST' },
        )
        refreshRestorePoints()
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setRestoringId(null)
      }
    },
    [refreshRestorePoints, restoringId],
  )

  useEffect(() => {
    if (restoreQueryEnabled) refreshRestorePoints()
  }, [restoreQueryEnabled, sessionId, refreshRestorePoints])

  const send = useCallback(
    async (text: string) => {
      const content = text.trim()
      if (!content || sending) return

      const userMsg: AsistenteUiMessage = {
        id: newId(),
        role: 'user',
        content,
      }
      const nextHistory = [...messages, userMsg]
      setMessages(nextHistory)
      setActivities([])
      setSending(true)
      setError(null)
      setMode('open')

      abortRef.current?.abort()
      const ac = new AbortController()
      abortRef.current = ac

      const effectiveRestore = !readOnly && restorePointsEnabled
      const body = {
        messages: nextHistory.map((m) => ({
          role: m.role,
          content: m.content,
          ...(m.id ? { id: m.id } : {}),
          ...(m.activities?.length ? { activities: m.activities } : {}),
        })),
        readOnly,
        restorePoints: effectiveRestore,
        thinking: thinkingEnabled,
        sessionId,
        ...(contextSummary ? { contextSummary } : {}),
      }

      try {
        await streamAsistenteChat(
          body,
          {
            onActivity: (activity) => {
              setActivities((prev) => {
                const idx = prev.findIndex((a) => a.id === activity.id)
                if (idx >= 0) {
                  const next = [...prev]
                  next[idx] = activity
                  return next
                }
                return [...prev, activity]
              })
            },
            onUi: (view) => {
              setSideView(view)
            },
            onContext: ({ summary, keptFromEnd }) => {
              setContextSummary(summary)
              if (keptFromEnd > 0) {
                setMessages((prev) => {
                  const dialogue = prev.filter(
                    (m) => m.role === 'user' || m.role === 'assistant',
                  )
                  const kept = dialogue.slice(-keptFromEnd)
                  return [
                    {
                      id: newId(),
                      role: 'system',
                      content: summary,
                    },
                    ...kept,
                  ]
                })
              }
            },
            onReply: ({
              reply,
              activities: turnActivities,
              contextSummary: nextSummary,
              contextCompacted,
              keptFromEnd,
            }) => {
              if (typeof nextSummary === 'string') {
                setContextSummary(nextSummary)
              }
              const attached = (turnActivities ?? []).filter(
                (a) => a && !String(a.slug || '').startsWith('_'),
              )
              setMessages((prev) => {
                let base = prev
                if (
                  contextCompacted &&
                  keptFromEnd != null &&
                  keptFromEnd > 0 &&
                  !prev.some((m) => m.role === 'system')
                ) {
                  const dialogue = prev.filter(
                    (m) => m.role === 'user' || m.role === 'assistant',
                  )
                  const kept = dialogue.slice(-keptFromEnd)
                  base = [
                    {
                      id: newId(),
                      role: 'system',
                      content: nextSummary || contextSummary || 'Contexto resumido',
                    },
                    ...kept,
                  ]
                }
                return [
                  ...base,
                  {
                    id: newId(),
                    role: 'assistant',
                    content: reply.trim() || '(sin respuesta)',
                    ...(attached.length ? { activities: attached } : {}),
                  },
                ]
              })
              setActivities([])
            },
            onError: (message) => {
              setError(message)
            },
          },
          ac.signal,
        )
        if (effectiveRestore) refreshRestorePoints()
        refreshChatSessions()
      } catch (err) {
        const aborted =
          (err instanceof DOMException && err.name === 'AbortError') ||
          (err instanceof Error && err.name === 'AbortError')
        if (aborted) {
          setActivities((prev) =>
            prev.map((a) =>
              a.status === 'running'
                ? { ...a, status: 'error', detail: 'Cancelado' }
                : a,
            ),
          )
          setError(null)
        } else {
          const msg = err instanceof Error ? err.message : String(err)
          setError(msg || 'Error desconocido del asistente')
          setActivities((prev) =>
            prev.map((a) =>
              a.status === 'running'
                ? { ...a, status: 'error', detail: msg || 'Error' }
                : a,
            ),
          )
        }
      } finally {
        if (abortRef.current === ac) abortRef.current = null
        setSending(false)
      }
    },
    [
      messages,
      sending,
      readOnly,
      restorePointsEnabled,
      thinkingEnabled,
      sessionId,
      contextSummary,
      refreshRestorePoints,
      refreshChatSessions,
    ],
  )

  const stop = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    setSending(false)
    setActivities((prev) =>
      prev.map((a) =>
        a.status === 'running'
          ? { ...a, status: 'error', detail: 'Cancelado' }
          : a,
      ),
    )
  }, [])

  const clearError = useCallback(() => setError(null), [])

  const value = useMemo<AsistenteChatContextValue>(
    () => ({
      mode,
      open: mode === 'open',
      minimized: mode === 'minimized',
      setOpen,
      minimize,
      expand,
      close,
      toggle,
      messages,
      activities,
      sending,
      error,
      clearError,
      moduleEnabled,
      moduleLoading: modulesQuery.isLoading,
      sessionId,
      readOnly,
      setReadOnly,
      restorePointsEnabled,
      setRestorePointsEnabled,
      thinkingEnabled,
      setThinkingEnabled,
      restorePoints: restorePointsQuery.data ?? [],
      restorePointsLoading: restorePointsQuery.isFetching,
      restoringId,
      restorePoint,
      refreshRestorePoints,
      chatSessions: chatSessionsQuery.data ?? [],
      chatSessionsLoading: chatSessionsQuery.isFetching,
      refreshChatSessions,
      loadSession,
      deleteSession,
      send,
      stop,
      clear,
      newSession,
      sideView,
      openSideView,
      closeSideView,
    }),
    [
      mode,
      setOpen,
      minimize,
      expand,
      close,
      toggle,
      messages,
      activities,
      sending,
      error,
      clearError,
      moduleEnabled,
      modulesQuery.isLoading,
      sessionId,
      readOnly,
      setReadOnly,
      restorePointsEnabled,
      setRestorePointsEnabled,
      thinkingEnabled,
      setThinkingEnabled,
      restorePointsQuery.data,
      restorePointsQuery.isFetching,
      restoringId,
      restorePoint,
      refreshRestorePoints,
      chatSessionsQuery.data,
      chatSessionsQuery.isFetching,
      refreshChatSessions,
      loadSession,
      deleteSession,
      send,
      stop,
      clear,
      newSession,
      sideView,
      openSideView,
      closeSideView,
    ],
  )

  return (
    <AsistenteChatContext.Provider value={value}>
      {children}
    </AsistenteChatContext.Provider>
  )
}

export function useAsistenteChat() {
  const ctx = useContext(AsistenteChatContext)
  if (!ctx) {
    throw new Error('useAsistenteChat must be used within AsistenteChatProvider')
  }
  return ctx
}

export function useAsistenteChatOptional() {
  return useContext(AsistenteChatContext)
}
