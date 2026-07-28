import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { ModalPortal } from './ModalPortal'

export type NotifyAlertOptions = {
  title?: string
  variant?: 'info' | 'error' | 'success' | 'warning'
  okLabel?: string
}

export type NotifyConfirmOptions = {
  title?: string
  danger?: boolean
  confirmLabel?: string
  cancelLabel?: string
  /** If set, user must type this exact text to enable Confirm */
  confirmText?: string
}

type AlertRequest = {
  kind: 'alert'
  message: string
  options: NotifyAlertOptions
  resolve: () => void
}

type ConfirmRequest = {
  kind: 'confirm'
  message: string
  options: NotifyConfirmOptions
  resolve: (ok: boolean) => void
}

type NotifyRequest = AlertRequest | ConfirmRequest

type NotifyApi = {
  alert: (message: string, options?: NotifyAlertOptions) => Promise<void>
  confirm: (
    message: string,
    options?: NotifyConfirmOptions,
  ) => Promise<boolean>
}

const NotifyContext = createContext<NotifyApi | null>(null)

function variantStyles(variant: NotifyAlertOptions['variant']) {
  switch (variant) {
    case 'error':
      return {
        title: 'text-[var(--danger)]',
        border: 'border-[var(--danger)]/40',
        button: 'bg-[var(--danger)] text-white hover:opacity-90',
      }
    case 'success':
      return {
        title: 'text-emerald-400',
        border: 'border-emerald-500/40',
        button: 'bg-emerald-600 text-white hover:bg-emerald-500',
      }
    case 'warning':
      return {
        title: 'text-amber-300',
        border: 'border-amber-500/40',
        button: 'bg-amber-600 text-white hover:bg-amber-500',
      }
    default:
      return {
        title: 'text-[var(--text)]',
        border: 'border-[var(--border)]',
        button:
          'bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)]',
      }
  }
}

function NotifyModal({
  request,
  onCloseAlert,
  onCloseConfirm,
}: {
  request: NotifyRequest
  onCloseAlert: () => void
  onCloseConfirm: (ok: boolean) => void
}) {
  const [typed, setTyped] = useState('')
  const confirmText =
    request.kind === 'confirm' ? request.options.confirmText : undefined
  const typedOk = !confirmText || typed.trim() === confirmText

  const title =
    request.kind === 'alert'
      ? (request.options.title ??
        (request.options.variant === 'error'
          ? 'Error'
          : request.options.variant === 'success'
            ? 'Listo'
            : request.options.variant === 'warning'
              ? 'Aviso'
              : 'Aviso'))
      : (request.options.title ??
        (request.options.danger ? 'Confirmar acción' : 'Confirmar'))

  const styles =
    request.kind === 'alert'
      ? variantStyles(request.options.variant)
      : request.options.danger
        ? variantStyles('error')
        : variantStyles('info')

  const lines = request.message.split('\n')

  return (
    <ModalPortal>
    <div className="modal-backdrop fixed inset-0 z-[1000] flex items-center justify-center overflow-hidden p-0 sm:p-4">
      <button
        type="button"
        aria-label="Cerrar"
        className="absolute inset-0 bg-black/60"
        onClick={() => {
          if (request.kind === 'alert') onCloseAlert()
          else onCloseConfirm(false)
        }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="notify-modal-title"
        className={`relative z-10 flex max-h-[100dvh] w-full max-w-md flex-col overflow-hidden rounded-none border-0 bg-[var(--bg-elevated)] text-[var(--text)] shadow-2xl sm:max-h-[min(90dvh,920px)] sm:rounded-xl sm:border ${styles.border}`}
      >
        <div className="shrink-0 border-b border-[var(--border)] px-5 py-4">
          <h2
            id="notify-modal-title"
            className={`text-lg font-semibold ${styles.title}`}
          >
            {title}
          </h2>
        </div>
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain px-5 py-4 text-sm text-[var(--text-muted)]">
          {lines.map((line, i) =>
            line.trim() === '' ? (
              <div key={i} className="h-2" />
            ) : (
              <p key={i} className="whitespace-pre-wrap text-[var(--text)]">
                {line}
              </p>
            ),
          )}
          {confirmText && (
            <label className="mt-3 block text-xs">
              <span className="mb-1 block text-[var(--text-muted)]">
                Escribe{' '}
                <span className="font-mono text-[var(--text)]">
                  {confirmText}
                </span>{' '}
                para confirmar
              </span>
              <input
                autoFocus
                className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm outline-none ring-[var(--accent)] focus:ring-2"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder={confirmText}
              />
            </label>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-[var(--border)] px-5 py-3">
          {request.kind === 'confirm' && (
            <button
              type="button"
              onClick={() => onCloseConfirm(false)}
              className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm"
            >
              {request.options.cancelLabel ?? 'Cancelar'}
            </button>
          )}
          <button
            type="button"
            disabled={request.kind === 'confirm' && !typedOk}
            autoFocus={!confirmText}
            onClick={() => {
              if (request.kind === 'alert') onCloseAlert()
              else onCloseConfirm(true)
            }}
            className={`rounded-lg px-3 py-2 text-sm font-medium disabled:opacity-40 ${styles.button}`}
          >
            {request.kind === 'alert'
              ? (request.options.okLabel ?? 'Entendido')
              : (request.options.confirmLabel ??
                (request.options.danger ? 'Eliminar' : 'Confirmar'))}
          </button>
        </div>
      </div>
    </div>
    </ModalPortal>
  )
}

export function NotifyProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<NotifyRequest[]>([])
  const queueRef = useRef(queue)
  queueRef.current = queue

  const enqueue = useCallback((req: NotifyRequest) => {
    setQueue((prev) => [...prev, req])
  }, [])

  const api = useMemo<NotifyApi>(
    () => ({
      alert: (message, options = {}) =>
        new Promise<void>((resolve) => {
          enqueue({ kind: 'alert', message, options, resolve })
        }),
      confirm: (message, options = {}) =>
        new Promise<boolean>((resolve) => {
          enqueue({ kind: 'confirm', message, options, resolve })
        }),
    }),
    [enqueue],
  )

  const current = queue[0] ?? null

  function closeAlert() {
    const req = queueRef.current[0]
    if (!req || req.kind !== 'alert') return
    req.resolve()
    setQueue((prev) => prev.slice(1))
  }

  function closeConfirm(ok: boolean) {
    const req = queueRef.current[0]
    if (!req || req.kind !== 'confirm') return
    req.resolve(ok)
    setQueue((prev) => prev.slice(1))
  }

  return (
    <NotifyContext.Provider value={api}>
      {children}
      {current && (
        <NotifyModal
          key={`${current.kind}-${current.message.slice(0, 40)}-${queue.length}`}
          request={current}
          onCloseAlert={closeAlert}
          onCloseConfirm={closeConfirm}
        />
      )}
    </NotifyContext.Provider>
  )
}

export function useNotify(): NotifyApi {
  const ctx = useContext(NotifyContext)
  if (!ctx) {
    throw new Error('useNotify must be used within NotifyProvider')
  }
  return ctx
}
