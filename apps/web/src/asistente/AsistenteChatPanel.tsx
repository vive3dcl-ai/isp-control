import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ModalPortal } from '../components/ModalPortal'
import { useAsistenteChat } from './AsistenteChatContext'
import { AsistenteSideHost } from './AsistenteSidePanel'

type PanelAnim = 'enter' | 'exit-min' | 'exit-close' | null

/** Fallback si el stream aún no manda `mutates` (tools de escritura conocidas). */
const WRITE_TOOL_SLUGS = new Set([
  'mikrotik_apply',
  'onu_verify_run',
  'onu_refresh',
  'onu_reboot',
  'crm_set_service_status',
  'crm_reconcile_olt',
  'crm_merge_clients',
  'crm_merge_services',
  'crm_update_client',
])

function activityIsWrite(a: { mutates?: boolean; slug: string }) {
  return a.mutates === true || WRITE_TOOL_SLUGS.has(a.slug)
}

function ActivityRow({
  a,
  restorePointsEnabled,
  readOnly,
}: {
  a: {
    id: string
    kind: 'tool' | 'skill' | 'plan'
    slug: string
    name: string
    status: 'running' | 'done' | 'error'
    detail?: string
    mutates?: boolean
  }
  restorePointsEnabled: boolean
  readOnly: boolean
}) {
  return (
    <div
      className={[
        'flex items-start gap-2 rounded-xl border px-3 py-2 text-[11px] sm:text-xs',
        a.status === 'running'
          ? 'border-[var(--accent)]/40 bg-[var(--accent)]/5'
          : a.status === 'error'
            ? 'border-[var(--danger)]/40 bg-[var(--danger)]/10'
            : a.kind === 'plan'
              ? 'border-sky-500/35 bg-sky-500/5'
            : activityIsWrite(a) && !restorePointsEnabled && !readOnly
              ? 'border-amber-500/40 bg-amber-500/5'
              : 'border-[var(--border)] bg-[var(--bg)]',
      ].join(' ')}
    >
      <span
        className={[
          'mt-0.5 inline-block h-2 w-2 shrink-0 rounded-full',
          a.status === 'running'
            ? 'animate-pulse bg-[var(--accent)]'
            : a.status === 'error'
              ? 'bg-[var(--danger)]'
              : activityIsWrite(a) && !restorePointsEnabled && !readOnly
                ? 'bg-amber-400'
                : 'bg-emerald-500',
        ].join(' ')}
        aria-hidden
      />
      <div className="min-w-0">
        <p className="font-medium text-[var(--text)]">
          {a.kind === 'plan' ? 'Plan' : a.kind === 'skill' ? 'Skill' : 'Tool'}:{' '}
          {a.name}
          {activityIsWrite(a) ? (
            <span className="ml-1.5 font-normal text-amber-200/90">
              · escritura
            </span>
          ) : null}
        </p>
        <p className="truncate text-[var(--text-muted)]">
          {a.status === 'running' ? a.detail || 'Trabajando…' : a.detail || a.slug}
        </p>
        {activityIsWrite(a) && !restorePointsEnabled && !readOnly ? (
          <p className="mt-1 text-[10px] text-amber-200/90">
            Sin punto de restauración activo
          </p>
        ) : null}
      </div>
    </div>
  )
}

/**
 * Panel de chat del Asistente.
 * Desktop: card centrada verticalmente a la derecha (altura acotada al viewport).
 * Móvil: pantalla completa.
 * Panel lateral: solo cuando el agente lo abre; nace desde el centro del área libre.
 */
export function AsistenteChatPanel() {
  const {
    mode,
    minimize,
    close,
    messages,
    activities,
    sending,
    error,
    send,
    stop,
    clearError,
    newSession,
    moduleEnabled,
    readOnly,
    setReadOnly,
    restorePointsEnabled,
    setRestorePointsEnabled,
    thinkingEnabled,
    setThinkingEnabled,
    restorePoints,
    restoringId,
    restorePoint,
    sideView,
    closeSideView,
    chatSessions,
    chatSessionsLoading,
    loadSession,
    deleteSession,
    refreshChatSessions,
    sessionId,
  } = useAsistenteChat()
  const [draft, setDraft] = useState('')
  const [visible, setVisible] = useState(false)
  const [anim, setAnim] = useState<PanelAnim>(null)
  const [showRestoreList, setShowRestoreList] = useState(false)
  const [showChatSessions, setShowChatSessions] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const closingRef = useRef(false)

  // Abrir / reabrir desde minimizado
  useEffect(() => {
    if (mode === 'open') {
      closingRef.current = false
      setVisible(true)
      setAnim('enter')
      const t = window.setTimeout(() => setAnim(null), 320)
      return () => window.clearTimeout(t)
    }
    if (mode === 'closed' && visible && !closingRef.current) {
      closingRef.current = true
      setAnim('exit-close')
      const t = window.setTimeout(() => {
        setVisible(false)
        setAnim(null)
        closingRef.current = false
      }, 280)
      return () => window.clearTimeout(t)
    }
    if (mode === 'minimized' && visible && !closingRef.current) {
      setVisible(false)
      setAnim(null)
    }
  }, [mode, visible])

  useEffect(() => {
    if (mode !== 'open') return
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [mode, messages, sending, activities])

  useEffect(() => {
    if (mode !== 'open') return
    const t = window.setTimeout(() => inputRef.current?.focus(), 80)
    return () => window.clearTimeout(t)
  }, [mode])

  function onMinimize() {
    if (closingRef.current) return
    closingRef.current = true
    setAnim('exit-min')
    window.setTimeout(() => {
      minimize()
      setVisible(false)
      setAnim(null)
      closingRef.current = false
    }, 320)
  }

  function onClose() {
    if (closingRef.current) return
    closingRef.current = true
    setAnim('exit-close')
    window.setTimeout(() => {
      close()
      setVisible(false)
      setAnim(null)
      closingRef.current = false
    }, 280)
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    const text = draft
    setDraft('')
    await send(text)
  }

  if (!moduleEnabled) return null

  const animClass =
    anim === 'enter'
      ? 'asistente-panel--enter'
      : anim === 'exit-min'
        ? 'asistente-panel--exit-min'
        : anim === 'exit-close'
          ? 'asistente-panel--exit-close'
          : ''

  const activeRestoreCount = restorePoints.filter(
    (p) => p.status === 'active',
  ).length

  const writingWithoutRestore =
    !readOnly &&
    !restorePointsEnabled &&
    activities.some(
      (a) =>
        a.kind === 'tool' &&
        (a.mutates === true || WRITE_TOOL_SLUGS.has(a.slug)),
    )

  const panelHeightClass = 'asistente-panel-h'

  return (
    <ModalPortal>
      {/* Móvil: vista real sobrevive al minimizar el chat */}
      {!visible && sideView ? (
        <AsistenteSideHost
          view={sideView}
          onClose={closeSideView}
          onMinimize={minimize}
          chatHeightClass={panelHeightClass}
        />
      ) : null}

      {visible ? (
      <div className="pointer-events-none fixed inset-0 z-[inherit] flex items-stretch justify-end sm:items-center sm:justify-end sm:gap-3 sm:px-3 sm:pb-[max(3.5rem,calc(3rem+var(--safe-bottom)))] sm:pt-3 sm:pr-[max(0.75rem,var(--safe-right))] sm:pl-2">
        <button
          type="button"
          aria-label="Cerrar Asistente"
          className={[
            'pointer-events-auto absolute inset-0 bg-black/40 sm:hidden',
            anim === 'enter' ? 'asistente-backdrop--enter' : '',
            anim === 'exit-min' || anim === 'exit-close'
              ? 'asistente-backdrop--exit'
              : '',
          ].join(' ')}
          onClick={onClose}
        />

        <AsistenteSideHost
          view={sideView}
          onClose={closeSideView}
          onMinimize={minimize}
          chatHeightClass={panelHeightClass}
        />

        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="asistente-chat-title"
          className={[
            'asistente-panel pointer-events-auto relative z-[3] flex w-full shrink-0 flex-col border-[var(--border)] bg-[var(--bg-elevated)] text-[var(--text)] shadow-2xl sm:max-w-md sm:rounded-2xl sm:border',
            panelHeightClass,
            'asistente-chat-w',
            animClass,
          ].join(' ')}
        >

          <header className="modal-safe-header flex shrink-0 items-center justify-between gap-2 border-b border-[var(--border)] px-3 py-2.5 sm:px-4">
            <div className="min-w-0">
              <h2
                id="asistente-chat-title"
                className="text-sm font-semibold sm:text-base"
              >
                Asistente
              </h2>
              <p className="truncate text-[11px] text-[var(--text-muted)] sm:text-xs">
                {readOnly
                  ? 'Modo solo lectura'
                  : thinkingEnabled
                    ? restorePointsEnabled
                      ? 'Thinking · restauración'
                      : 'Thinking activo'
                    : restorePointsEnabled
                      ? 'Con puntos de restauración'
                      : 'Agente ISP Control'}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-0.5">
              <button
                type="button"
                onClick={() => {
                  setDraft('')
                  newSession()
                  setShowRestoreList(false)
                  setShowChatSessions(false)
                }}
                className="rounded-lg px-2 py-1.5 text-xs text-[var(--text-muted)] hover:bg-[var(--bg)] hover:text-[var(--text)]"
                title="Nueva sesión (limpia el contexto)"
              >
                Nueva sesión
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowChatSessions((v) => !v)
                  setShowRestoreList(false)
                  if (!showChatSessions) refreshChatSessions()
                }}
                className="rounded-lg px-2 py-1.5 text-xs text-[var(--text-muted)] hover:bg-[var(--bg)] hover:text-[var(--text)]"
                title="Conversaciones anteriores"
              >
                Chats
              </button>
              <button
                type="button"
                onClick={onMinimize}
                className="hidden h-8 w-8 items-center justify-center rounded-lg text-[var(--text-muted)] hover:bg-[var(--bg)] hover:text-[var(--text)] sm:inline-flex"
                aria-label="Minimizar"
                title="Minimizar"
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  aria-hidden
                >
                  <path d="M5 12h14" />
                </svg>
              </button>
              <button
                type="button"
                onClick={onClose}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-muted)] hover:bg-[var(--bg)] hover:text-[var(--text)]"
                aria-label="Cerrar"
                title="Cerrar"
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  aria-hidden
                >
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>
          </header>

          <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--border)] px-3 py-2 sm:px-4">
            <label
              className={[
                'inline-flex cursor-pointer items-center gap-1.5 rounded-lg border px-2 py-1 text-[11px] sm:text-xs',
                readOnly
                  ? 'border-[var(--accent)]/50 bg-[var(--accent)]/10 text-[var(--text)]'
                  : 'border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--bg)]',
              ].join(' ')}
              title="El agente solo lee y orienta; no realiza cambios"
            >
              <input
                type="checkbox"
                className="h-3.5 w-3.5 accent-[var(--accent)]"
                checked={readOnly}
                onChange={(e) => setReadOnly(e.target.checked)}
              />
              S lectura
            </label>
            <label
              className={[
                'inline-flex cursor-pointer items-center gap-1.5 rounded-lg border px-2 py-1 text-[11px] sm:text-xs',
                thinkingEnabled
                  ? 'border-[var(--accent)]/50 bg-[var(--accent)]/10 text-[var(--text)]'
                  : 'border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--bg)]',
              ].join(' ')}
              title="Primero planifica la cadena de tools y luego las ejecuta hasta completar"
            >
              <input
                type="checkbox"
                className="h-3.5 w-3.5 accent-[var(--accent)]"
                checked={thinkingEnabled}
                onChange={(e) => setThinkingEnabled(e.target.checked)}
              />
              Thinking
            </label>
            <label
              className={[
                'inline-flex cursor-pointer items-center gap-1.5 rounded-lg border px-2 py-1 text-[11px] sm:text-xs',
                restorePointsEnabled && !readOnly
                  ? 'border-[var(--accent)]/50 bg-[var(--accent)]/10 text-[var(--text)]'
                  : 'border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--bg)]',
                readOnly ? 'cursor-not-allowed opacity-50' : '',
              ].join(' ')}
              title={
                readOnly
                  ? 'Desactiva «S lectura» para guardar puntos de restauración'
                  : 'Cada cambio del agente se guarda para poder deshacerlo'
              }
            >
              <input
                type="checkbox"
                className="h-3.5 w-3.5 accent-[var(--accent)]"
                checked={restorePointsEnabled && !readOnly}
                disabled={readOnly}
                onChange={(e) => setRestorePointsEnabled(e.target.checked)}
              />
              P. Restauración
            </label>
            {restorePointsEnabled && !readOnly && (
              <button
                type="button"
                onClick={() => {
                  setShowRestoreList((v) => !v)
                  setShowChatSessions(false)
                }}
                className="inline-flex items-center rounded-lg border border-[var(--border)] px-2 py-1 text-[11px] text-[var(--text-muted)] hover:bg-[var(--bg)] hover:text-[var(--text)] sm:text-xs"
              >
                {showRestoreList ? 'Ocultar' : 'Restaurar'}
                {activeRestoreCount > 0 ? ` (${activeRestoreCount})` : ''}
              </button>
            )}
          </div>

          {showChatSessions && (
            <div className="max-h-44 shrink-0 space-y-1.5 overflow-y-auto border-b border-[var(--border)] bg-[var(--bg)] px-3 py-2 sm:px-4">
              {chatSessionsLoading && chatSessions.length === 0 ? (
                <p className="text-[11px] text-[var(--text-muted)]">
                  Cargando conversaciones…
                </p>
              ) : chatSessions.length === 0 ? (
                <p className="text-[11px] text-[var(--text-muted)]">
                  Aún no hay conversaciones guardadas. Se crean al chatear.
                </p>
              ) : (
                chatSessions.map((s) => (
                  <div
                    key={s.sessionId}
                    className={[
                      'flex items-start justify-between gap-2 rounded-lg border px-2.5 py-1.5',
                      s.sessionId === sessionId
                        ? 'border-[var(--accent)]/50 bg-[var(--accent)]/5'
                        : 'border-[var(--border)] bg-[var(--bg-elevated)]',
                    ].join(' ')}
                  >
                    <button
                      type="button"
                      className="min-w-0 flex-1 text-left"
                      onClick={() => {
                        void loadSession(s.sessionId)
                        setShowChatSessions(false)
                      }}
                    >
                      <p className="truncate text-xs font-medium">{s.title}</p>
                      <p className="truncate text-[10px] text-[var(--text-muted)]">
                        {new Date(s.updatedAt).toLocaleString()}
                        {s.messageCount != null
                          ? ` · ${s.messageCount} msgs`
                          : ''}
                      </p>
                    </button>
                    <button
                      type="button"
                      onClick={() => void deleteSession(s.sessionId)}
                      className="shrink-0 rounded-md border border-[var(--border)] px-2 py-0.5 text-[10px] text-[var(--text-muted)] hover:bg-[var(--bg)] hover:text-[var(--danger)]"
                      title="Eliminar"
                    >
                      Borrar
                    </button>
                  </div>
                ))
              )}
            </div>
          )}

          {writingWithoutRestore && (
            <div
              role="alert"
              className="flex shrink-0 items-start gap-2 border-b border-amber-500/40 bg-amber-500/10 px-3 py-2.5 sm:px-4"
            >
              <span
                className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-500/20 text-[11px] font-bold text-amber-200"
                aria-hidden
              >
                !
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-amber-100">
                  Cambio sin punto de restauración
                </p>
                <p className="mt-0.5 text-[11px] text-amber-100/80">
                  El agente está aplicando una modificación y el punto de
                  restauración está desactivado. No podrás deshacer desde el
                  asistente.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setRestorePointsEnabled(true)}
                className="shrink-0 rounded-lg border border-amber-400/50 bg-amber-500/20 px-2 py-1 text-[11px] font-medium text-amber-50 hover:bg-amber-500/30"
              >
                Activar
              </button>
            </div>
          )}

          {showRestoreList && restorePointsEnabled && !readOnly && (
            <div className="max-h-36 shrink-0 space-y-1.5 overflow-y-auto border-b border-[var(--border)] bg-[var(--bg)] px-3 py-2 sm:px-4">
              {restorePoints.length === 0 ? (
                <p className="text-[11px] text-[var(--text-muted)]">
                  Aún no hay puntos en esta sesión. Se crearán al aplicar
                  cambios con tools de escritura.
                </p>
              ) : (
                restorePoints.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-start justify-between gap-2 rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-2.5 py-1.5"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-xs font-medium">{p.title}</p>
                      <p className="truncate text-[10px] text-[var(--text-muted)]">
                        {p.status === 'active'
                          ? 'Activo'
                          : p.status === 'restored'
                            ? 'Restaurado'
                            : p.status}
                        {p.summary ? ` · ${p.summary}` : ''}
                      </p>
                    </div>
                    {p.status === 'active' && p.hasUndo && (
                      <button
                        type="button"
                        disabled={restoringId === p.id}
                        onClick={() => void restorePoint(p.id)}
                        className="shrink-0 rounded-md border border-[var(--border)] px-2 py-0.5 text-[10px] hover:bg-[var(--bg)] disabled:opacity-50"
                      >
                        {restoringId === p.id ? '…' : 'Deshacer'}
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>
          )}

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
            {messages.length === 0 && (
              <div className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--bg)] px-4 py-6 text-sm text-[var(--text-muted)]">
                <p className="font-medium text-[var(--text)]">
                  ¿En qué te ayudo?
                </p>
                <p className="mt-2">
                  Puedo buscar clientes, ver servicios y seriales ONU, revisar
                  topología y abrir las fichas reales (cliente, ONU, equipo).
                  Usa Solo lectura para bloquear cambios.
                </p>
              </div>
            )}
            {messages.map((m) => (
              <div key={m.id} className="space-y-1.5">
                {m.role === 'system' ? (
                  <div className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-[11px] text-[var(--text-muted)]">
                    <p className="mb-1 font-medium text-[var(--text)]">
                      Contexto anterior resumido
                    </p>
                    <p className="whitespace-pre-wrap">{m.content}</p>
                  </div>
                ) : null}
                {m.role === 'assistant' && m.activities && m.activities.length > 0 ? (
                  <div className="mr-4 space-y-1.5">
                    {m.activities.map((a) => (
                      <ActivityRow
                        key={a.id}
                        a={a}
                        restorePointsEnabled={restorePointsEnabled}
                        readOnly={readOnly}
                      />
                    ))}
                  </div>
                ) : null}
                {m.role === 'user' || m.role === 'assistant' ? (
                  <div
                    className={
                      m.role === 'user'
                        ? 'ml-8 rounded-2xl rounded-br-md bg-[var(--accent)] px-3 py-2 text-sm text-white'
                        : 'mr-6 rounded-2xl rounded-bl-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm whitespace-pre-wrap'
                    }
                  >
                    {m.content}
                  </div>
                ) : null}
              </div>
            ))}
            {activities.length > 0 && (
              <div className="mr-4 space-y-1.5">
                {activities.map((a) => (
                  <ActivityRow
                    key={a.id}
                    a={a}
                    restorePointsEnabled={restorePointsEnabled}
                    readOnly={readOnly}
                  />
                ))}
              </div>
            )}
            {sending && activities.every((a) => a.status !== 'running') && (
              <p className="text-xs text-[var(--text-muted)]">
                {thinkingEnabled ? 'Pensando y planificando…' : 'Pensando…'}
              </p>
            )}
            {error && (
              <div
                role="alert"
                className="rounded-lg border border-[var(--danger)]/40 bg-[var(--danger)]/10 px-3 py-2 text-xs text-[var(--danger)]"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="font-medium">Error</p>
                  <button
                    type="button"
                    className="shrink-0 text-[10px] underline opacity-80 hover:opacity-100"
                    onClick={clearError}
                  >
                    Cerrar
                  </button>
                </div>
                <p className="mt-0.5 whitespace-pre-wrap break-words">{error}</p>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          <form
            onSubmit={onSubmit}
            className="modal-safe-footer flex shrink-0 gap-2 border-t border-[var(--border)] px-3 py-3"
          >
            <textarea
              ref={inputRef}
              rows={2}
              value={draft}
              disabled={sending}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  if (draft.trim() && !sending) {
                    void onSubmit(e as unknown as FormEvent)
                  }
                }
              }}
              placeholder="Escribe un mensaje…"
              className="min-h-[2.75rem] flex-1 resize-none rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm outline-none ring-[var(--accent)] focus:ring-2 disabled:opacity-60"
            />
            {sending ? (
              <button
                type="button"
                onClick={stop}
                title="Detener"
                aria-label="Detener"
                className="asistente-stop-btn relative self-end inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--danger)] text-white hover:opacity-90"
              >
                <span className="asistente-stop-spin" aria-hidden />
                <span className="relative z-[1] block h-3 w-3 rounded-[2px] bg-white" />
              </button>
            ) : (
              <button
                type="submit"
                disabled={!draft.trim()}
                title="Enviar"
                aria-label="Enviar"
                className="self-end inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)] disabled:opacity-50"
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  aria-hidden
                >
                  <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
                </svg>
              </button>
            )}
          </form>
        </div>
      </div>
      ) : null}
    </ModalPortal>
  )
}
