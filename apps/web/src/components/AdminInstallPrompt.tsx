import { useEffect, useRef, useState } from 'react'
import {
  isAdminPwaSession,
  isAndroidDevice,
  isIosDevice,
  isPwaStandalone,
  markPwaInstalled,
  registerAppServiceWorker,
} from '../lib/pwa'

const DISMISS_KEY = 'isp-pwa-admin-install-dismissed-at'
const COOLDOWN_MS = 24 * 60 * 60 * 1000
const SHOW_DELAY_MS = 2200

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

function wasDismissedRecently() {
  try {
    const raw = localStorage.getItem(DISMISS_KEY)
    if (!raw) return false
    const ts = Number(raw)
    if (!Number.isFinite(ts)) return false
    return Date.now() - ts < COOLDOWN_MS
  } catch {
    return false
  }
}

function markDismissed() {
  localStorage.setItem(DISMISS_KEY, String(Date.now()))
}

/** Prompt de instalación para la PWA “Administración ISP” (fuera de /movil). */
export function AdminInstallPrompt() {
  const [visible, setVisible] = useState(false)
  const [iosHelp, setIosHelp] = useState(false)
  const [canPrompt, setCanPrompt] = useState(false)
  const deferredRef = useRef<BeforeInstallPromptEvent | null>(null)
  const shownThisLoad = useRef(false)

  useEffect(() => {
    void registerAppServiceWorker()

    if (isPwaStandalone()) return
    if (wasDismissedRecently()) return

    function onBip(e: Event) {
      e.preventDefault()
      deferredRef.current = e as BeforeInstallPromptEvent
      setCanPrompt(true)
    }
    function onInstalled() {
      markPwaInstalled('admin')
      setVisible(false)
    }
    window.addEventListener('beforeinstallprompt', onBip)
    window.addEventListener('appinstalled', onInstalled)

    const timer = window.setTimeout(() => {
      if (shownThisLoad.current) return
      if (isPwaStandalone()) return
      if (wasDismissedRecently()) return
      shownThisLoad.current = true
      setVisible(true)
    }, SHOW_DELAY_MS)

    return () => {
      window.removeEventListener('beforeinstallprompt', onBip)
      window.removeEventListener('appinstalled', onInstalled)
      window.clearTimeout(timer)
    }
  }, [])

  if (!visible || isPwaStandalone() || isAdminPwaSession()) return null

  function dismiss() {
    markDismissed()
    setVisible(false)
    setIosHelp(false)
  }

  async function onInstallAndroid() {
    const ev = deferredRef.current
    if (!ev) {
      dismiss()
      return
    }
    try {
      await ev.prompt()
      const choice = await ev.userChoice
      if (choice.outcome === 'accepted') markPwaInstalled('admin')
    } catch {
      // ignore
    }
    deferredRef.current = null
    dismiss()
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-[80] p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
      <div className="mx-auto max-w-lg rounded-2xl border border-[var(--border)] bg-[var(--bg-elevated)] p-4 shadow-2xl shadow-black/40">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold">Instalá Administración ISP</p>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              Acceso al panel completo desde el escritorio o el móvil, como una app.
            </p>
          </div>
          <button
            type="button"
            onClick={dismiss}
            className="shrink-0 rounded-lg px-2 py-1 text-sm text-[var(--text-muted)] hover:bg-[var(--bg)]"
            aria-label="Cerrar"
          >
            ✕
          </button>
        </div>

        {isIosDevice() ? (
          <div className="space-y-3">
            {!iosHelp ? (
              <button
                type="button"
                onClick={() => setIosHelp(true)}
                className="w-full rounded-xl bg-[var(--accent)] py-3 text-sm font-semibold text-white"
              >
                Cómo instalar en iPhone
              </button>
            ) : (
              <ol className="space-y-2 rounded-xl border border-[var(--border)] bg-[var(--bg)] p-3 text-xs text-[var(--text-muted)]">
                <li>
                  1. Tocá{' '}
                  <strong className="text-[var(--text)]">Compartir</strong> en
                  Safari.
                </li>
                <li>
                  2. Elegí{' '}
                  <strong className="text-[var(--text)]">
                    Agregar a pantalla de inicio
                  </strong>
                  .
                </li>
                <li>
                  3. Confirmá con{' '}
                  <strong className="text-[var(--text)]">Agregar</strong>.
                </li>
              </ol>
            )}
            {iosHelp && (
              <button
                type="button"
                onClick={() => {
                  markPwaInstalled('admin')
                  dismiss()
                }}
                className="w-full rounded-xl border border-[var(--border)] py-2.5 text-sm"
              >
                Listo
              </button>
            )}
          </div>
        ) : (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={dismiss}
              className="flex-1 rounded-xl border border-[var(--border)] py-3 text-sm"
            >
              Ahora no
            </button>
            <button
              type="button"
              onClick={() => void onInstallAndroid()}
              className="flex-[1.4] rounded-xl bg-[var(--accent)] py-3 text-sm font-semibold text-white"
            >
              {isAndroidDevice() || canPrompt ? 'Instalar' : 'Entendido'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
