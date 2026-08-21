import { useEffect, useState } from 'react'
import { useAuth } from '../auth/AuthContext'
import { isPlatformRole } from '../lib/api'
import {
  clearPushPromptDismiss,
  clearPushPromptPending,
  dismissPushPrompt,
  isPwaStandalone,
  markPushPromptPending,
  wasPushPromptDismissedRecently,
} from '../lib/pwa'
import {
  enablePushNotifications,
  pushPermission,
  pushSupported,
} from '../lib/webPush'

const SHOW_DELAY_MS = 700
/** Tras «Ahora no», no volver a pedir hasta 24 h. */
const DISMISS_COOLDOWN_MS = 24 * 60 * 60 * 1000

/**
 * Tras login insiste en activar notificaciones si el permiso no está concedido.
 * «Ahora no» guarda cooldown de 24 h en localStorage.
 */
export function PushEnablePrompt() {
  const { user, loading } = useAuth()
  const [visible, setVisible] = useState(false)
  const [busy, setBusy] = useState(false)
  const [perm, setPerm] = useState(() => pushPermission())
  const [installTick, setInstallTick] = useState(0)

  useEffect(() => {
    function onInstalled() {
      markPushPromptPending()
      // Tras instalar la PWA, permitir preguntar de nuevo (limpia cooldown).
      clearPushPromptDismiss()
      setInstallTick((n) => n + 1)
    }
    function onVisible() {
      if (document.visibilityState === 'visible' && isPwaStandalone()) {
        setInstallTick((n) => n + 1)
      }
    }
    window.addEventListener('appinstalled', onInstalled)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('appinstalled', onInstalled)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  useEffect(() => {
    if (!user?.id) return
    setInstallTick((n) => n + 1)
  }, [user?.id])

  useEffect(() => {
    if (loading || !user) {
      setVisible(false)
      return
    }
    if (!pushSupported()) return

    const current = pushPermission()
    setPerm(current)
    if (current === 'granted') {
      clearPushPromptPending()
      setVisible(false)
      return
    }
    if (wasPushPromptDismissedRecently(DISMISS_COOLDOWN_MS)) {
      setVisible(false)
      return
    }

    const t = window.setTimeout(() => setVisible(true), SHOW_DELAY_MS)
    return () => window.clearTimeout(t)
  }, [user, loading, installTick])

  if (!visible || !user) return null
  if (!pushSupported()) return null
  if (perm === 'granted') return null

  const variant = isPlatformRole(user.role) ? 'admin' : 'tenant'
  const denied = perm === 'denied'
  const inApp = isPwaStandalone()

  function onDismiss() {
    dismissPushPrompt()
    setVisible(false)
  }

  async function onEnable() {
    if (denied) {
      onDismiss()
      return
    }
    setBusy(true)
    try {
      const res = await enablePushNotifications(variant)
      setPerm(pushPermission())
      if (res.ok) {
        clearPushPromptPending()
        setVisible(false)
      } else if (res.reason === 'denied') {
        setPerm('denied')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-[85] p-4 pb-[max(1rem,var(--safe-bottom))] pl-[max(1rem,var(--safe-left))] pr-[max(1rem,var(--safe-right))]">
      <div className="mx-auto max-w-lg rounded-2xl border border-[var(--border)] bg-[var(--bg-elevated)] p-4 shadow-2xl shadow-black/40">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold">
              {denied ? 'Notificaciones bloqueadas' : 'Activar notificaciones'}
            </p>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              {denied
                ? inApp
                  ? 'Actívalas en Ajustes del sistema → Notificaciones para esta app.'
                  : 'Actívalas en el candado / información del sitio del navegador y vuelve a entrar.'
                : 'Recibe avisos de tickets, agenda y eventos importantes.'}
            </p>
          </div>
          <button
            type="button"
            onClick={onDismiss}
            className="shrink-0 rounded-lg px-2 py-1 text-sm text-[var(--text-muted)] hover:bg-[var(--bg)]"
            aria-label="Cerrar"
          >
            ✕
          </button>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onDismiss}
            className="flex-1 rounded-xl border border-[var(--border)] py-3 text-sm"
          >
            Ahora no
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void onEnable()}
            className="flex-[1.4] rounded-xl bg-[var(--accent)] py-3 text-sm font-semibold text-white disabled:opacity-60"
          >
            {denied
              ? 'Entendido'
              : busy
                ? 'Activando…'
                : 'Permitir avisos'}
          </button>
        </div>
      </div>
    </div>
  )
}
