import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { BrandLogo } from '../components/BrandLogo'
import {
  getRememberPreference,
  getRememberedEmail,
} from '../lib/api'

export function LoginPage() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState(() => getRememberedEmail())
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(
    () => getRememberPreference() || !!getRememberedEmail(),
  )
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const user = await login(email, password, {
        remember,
        channel: 'web',
      })
      navigate(user.redirectTo, { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo iniciar sesión')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-dvh items-start justify-center overflow-x-hidden px-4 pb-6 pt-8 sm:items-center sm:pt-0">
      <div className="w-full max-w-md">
        <div className="mb-5 text-center sm:mb-8">
          <div className="mb-3 flex justify-center sm:mb-4">
            <BrandLogo height={72} className="mx-auto rounded-lg" />
          </div>
          <h1 className="mt-1.5 text-2xl font-semibold tracking-tight text-[var(--text)] sm:mt-2 sm:text-3xl">
            Iniciar sesión
          </h1>
        </div>

        <form
          onSubmit={onSubmit}
          className="rounded-2xl border border-[var(--border)] bg-[var(--bg-elevated)] p-5 shadow-xl shadow-black/20 sm:p-6"
        >
          <label className="mb-4 block">
            <span className="mb-1.5 block text-sm text-[var(--text-muted)]">
              Email
            </span>
            <input
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-[var(--text)] outline-none ring-[var(--accent)] focus:ring-2"
              placeholder="tu@empresa.com"
            />
          </label>

          <label className="mb-4 block">
            <span className="mb-1.5 block text-sm text-[var(--text-muted)]">
              Contraseña
            </span>
            <input
              type="password"
              autoComplete="current-password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-[var(--text)] outline-none ring-[var(--accent)] focus:ring-2"
              placeholder="••••••••"
            />
          </label>

          <p className="mb-4 text-right text-sm">
            <Link
              to="/recuperar"
              className="text-[var(--accent)] underline-offset-2 hover:underline"
            >
              ¿Olvidaste tu contraseña?
            </Link>
          </p>

          <label className="mb-4 flex items-center gap-2.5 text-sm">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="h-4 w-4 rounded border-[var(--border)] accent-[var(--accent)]"
            />
            <span>Recordarme en este dispositivo</span>
          </label>

          {error && (
            <p className="mb-4 rounded-lg border border-[var(--danger)]/40 bg-[var(--danger)]/10 px-3 py-2 text-sm text-[var(--danger)]">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-lg bg-[var(--accent)] px-4 py-2.5 font-medium text-white transition hover:bg-[var(--accent-hover)] disabled:opacity-60"
          >
            {submitting ? 'Entrando…' : 'Entrar'}
          </button>
        </form>
      </div>
    </div>
  )
}
