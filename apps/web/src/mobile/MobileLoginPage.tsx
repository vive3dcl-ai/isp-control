import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import {
  getRememberPreference,
  getRememberedEmail,
} from '../lib/api'
import { useBranding } from '../branding/BrandingContext'
import { BrandMark } from '../components/BrandMark'

export function MobileLoginPage() {
  const { user, loading, login } = useAuth()
  const branding = useBranding()
  const navigate = useNavigate()
  const [email, setEmail] = useState(() => getRememberedEmail())
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(() => getRememberPreference() || !!getRememberedEmail())
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  if (!loading && user?.role === 'tenant_user') {
    return <Navigate to="/movil" replace />
  }
  if (!loading && user && user.role !== 'tenant_user') {
    return <Navigate to={user.redirectTo} replace />
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await login(email, password, { remember, channel: 'mobile' })
      navigate('/movil', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo iniciar sesión')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="mobile-app flex min-h-dvh flex-col bg-[var(--bg)] text-[var(--text)]">
      <div
        className="pointer-events-none absolute inset-0 opacity-70"
        style={{
          background:
            'radial-gradient(ellipse 90% 55% at 15% 0%, color-mix(in srgb, var(--accent) 22%, transparent), transparent), radial-gradient(ellipse 70% 45% at 100% 100%, color-mix(in srgb, var(--accent) 10%, transparent), transparent)',
        }}
      />
      <div className="relative mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-10">
        <div className="mb-8 text-center">
          <div className="mb-4 flex justify-center">
            <BrandMark size={52} className="rounded-xl" />
          </div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--accent)]">
            {branding.productName}
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">
            Acceso móvil
          </h1>
        </div>

        {loading ? (
          <p className="text-center text-[var(--text-muted)]">Cargando…</p>
        ) : (
          <form
            onSubmit={onSubmit}
            className="space-y-4 rounded-2xl border border-[var(--border)] bg-[var(--bg-elevated)]/90 p-5 backdrop-blur"
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

            <label className="flex items-center gap-3 text-sm">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
                className="h-4 w-4 rounded border-[var(--border)] accent-[var(--accent)]"
              />
              <span>Recordarme en este dispositivo</span>
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

        <p className="mt-6 text-center text-xs text-[var(--text-muted)]">
          Panel escritorio:{' '}
          <Link to="/login" className="text-[var(--accent)] underline">
            /login
          </Link>
        </p>
      </div>
    </div>
  )
}
