import { useEffect, useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import {
  getRememberedEmail,
} from '../lib/api'
import { useBranding } from '../branding/BrandingContext'
import { BrandMark } from '../components/BrandMark'
import { isMobilePwaInstalled } from '../lib/mobilePwa'

type PasswordCred = {
  id: string
  password: string
}

async function storeMobileCredentials(email: string, password: string) {
  try {
    // PasswordCredential no está tipado en todos los TS DOM libs.
    const Cred = (
      window as unknown as {
        PasswordCredential?: new (data: {
          id: string
          password: string
          name?: string
        }) => Credential
      }
    ).PasswordCredential
    if (!Cred || !navigator.credentials?.store) return
    const cred = new Cred({ id: email, password, name: email })
    await navigator.credentials.store(cred)
  } catch {
    // ignore
  }
}

async function loadStoredCredentials(): Promise<PasswordCred | null> {
  try {
    if (!navigator.credentials?.get) return null
    const cred = (await navigator.credentials.get({
      password: true,
      mediation: 'optional',
    } as CredentialRequestOptions)) as
      | (Credential & { id?: string; password?: string })
      | null
    if (cred?.id && cred.password) {
      return { id: cred.id, password: cred.password }
    }
  } catch {
    // ignore
  }
  return null
}

export function MobileLoginPage() {
  const { user, loading, login, logout } = useAuth()
  const branding = useBranding()
  const navigate = useNavigate()
  const [email, setEmail] = useState(() => getRememberedEmail())
  const [password, setPassword] = useState('')
  // En móvil / PWA siempre preferimos sesión persistente.
  const [remember, setRemember] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  // App instalada: no ofrecer panel escritorio
  const asApp = isMobilePwaInstalled()

  useEffect(() => {
    let cancelled = false
    void loadStoredCredentials().then((cred) => {
      if (cancelled || !cred) return
      setEmail(cred.id)
      setPassword(cred.password)
      setRemember(true)
    })
    return () => {
      cancelled = true
    }
  }, [])

  if (!loading && user?.role === 'tenant_user') {
    return <Navigate to="/movil" replace />
  }
  if (!loading && user && user.role !== 'tenant_user' && !asApp) {
    return <Navigate to={user.redirectTo} replace />
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      // Forzar persistencia en app móvil / PWA instalada.
      const persist = remember || isMobilePwaInstalled()
      const logged = await login(email, password, {
        remember: persist,
        channel: 'mobile',
      })
      if (asApp && logged.role !== 'tenant_user') {
        await logout()
        setError('Esta app es solo para usuarios del panel móvil.')
        return
      }
      if (persist) {
        await storeMobileCredentials(email, password)
      }
      navigate('/movil', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo iniciar sesión')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="mobile-app flex min-h-dvh flex-col overflow-x-hidden bg-[var(--bg)] text-[var(--text)]">
      <div
        className="pointer-events-none absolute inset-0 opacity-70"
        style={{
          background:
            'radial-gradient(ellipse 90% 55% at 15% 0%, color-mix(in srgb, var(--accent) 22%, transparent), transparent), radial-gradient(ellipse 70% 45% at 100% 100%, color-mix(in srgb, var(--accent) 10%, transparent), transparent)',
        }}
      />
      <div className="relative mx-auto flex w-full max-w-md flex-1 flex-col justify-start px-4 pb-6 pt-8 sm:justify-center sm:py-10">
        <div className="mb-5 text-center">
          <div className="mb-3 flex justify-center">
            <BrandMark size={44} className="rounded-xl" />
          </div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--accent)]">
            {branding.productName}
          </p>
          <h1 className="mt-1.5 text-2xl font-semibold tracking-tight">
            Acceso móvil
          </h1>
        </div>

        {loading ? (
          <p className="text-center text-[var(--text-muted)]">Cargando…</p>
        ) : (
          <form
            onSubmit={onSubmit}
            className="space-y-3 rounded-2xl border border-[var(--border)] bg-[var(--bg-elevated)]/90 p-4 backdrop-blur sm:space-y-4 sm:p-5"
          >
            <label className="block text-sm">
              <span className="mb-1.5 block text-[var(--text-muted)]">
                Email
              </span>
              <input
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 py-3 text-base outline-none ring-[var(--accent)] focus:ring-2"
                placeholder="tu@empresa.com"
              />
            </label>

            <label className="block text-sm">
              <span className="mb-1.5 block text-[var(--text-muted)]">
                Contraseña
              </span>
              <input
                type="password"
                autoComplete="current-password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 py-3 text-base outline-none ring-[var(--accent)] focus:ring-2"
                placeholder="••••••••"
              />
            </label>

            <p className="text-right text-sm">
              <Link
                to="/movil/recuperar"
                className="text-[var(--accent)] underline-offset-2 hover:underline"
              >
                ¿Olvidaste tu contraseña?
              </Link>
            </p>

            <label className="flex items-center gap-3 text-sm">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
                className="h-4 w-4 rounded border-[var(--border)] accent-[var(--accent)]"
              />
              <span>Mantener sesión en este dispositivo</span>
            </label>

            {error && (
              <p className="rounded-xl border border-[var(--danger)]/40 bg-[var(--danger)]/10 px-3 py-2 text-sm text-[var(--danger)]">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-xl bg-[var(--accent)] px-4 py-3.5 text-sm font-semibold text-white hover:bg-[var(--accent-hover)] disabled:opacity-60"
            >
              {submitting ? 'Entrando…' : 'Entrar'}
            </button>
          </form>
        )}

        {!asApp && (
          <p className="mt-4 text-center text-xs text-[var(--text-muted)] sm:mt-6">
            Panel escritorio:{' '}
            <Link to="/login" className="text-[var(--accent)] underline">
              /login
            </Link>
          </p>
        )}
      </div>
    </div>
  )
}
