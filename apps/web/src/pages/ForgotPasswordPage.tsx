import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { BrandLogo } from '../components/BrandLogo'
import { forgotPasswordRequest } from '../lib/api'

export function ForgotPasswordPage({
  channel = 'web',
  loginPath = '/login',
}: {
  channel?: 'web' | 'mobile'
  loginPath?: string
}) {
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const mobile = channel === 'mobile'
  const field = mobile
    ? 'w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 py-3 text-base outline-none ring-[var(--accent)] focus:ring-2'
    : 'w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-[var(--text)] outline-none ring-[var(--accent)] focus:ring-2'

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await forgotPasswordRequest(email, channel)
      setDone(true)
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'No se pudo enviar el correo',
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      className={
        mobile
          ? 'mobile-app flex min-h-dvh flex-col overflow-x-hidden bg-[var(--bg)] text-[var(--text)]'
          : 'flex min-h-dvh items-start justify-center overflow-x-hidden px-4 pb-6 pt-8 sm:items-center sm:pt-0'
      }
    >
      <div
        className={
          mobile
            ? 'relative mx-auto flex w-full max-w-md flex-1 flex-col justify-start px-4 pb-6 pt-8 sm:justify-center sm:py-10'
            : 'w-full max-w-md'
        }
      >
        <div className="mb-5 text-center sm:mb-8">
          <div className="mb-3 flex justify-center">
            <BrandLogo height={mobile ? 64 : 72} className="mx-auto rounded-lg" />
          </div>
          <h1 className="mt-1.5 text-2xl font-semibold tracking-tight">
            Recuperar contraseña
          </h1>
          <p className="mt-2 text-sm text-[var(--text-muted)]">
            Te enviaremos un enlace si el correo está registrado.
          </p>
        </div>

        {done ? (
          <div
            className={
              mobile
                ? 'rounded-2xl border border-[var(--border)] bg-[var(--bg-elevated)] p-5'
                : 'rounded-2xl border border-[var(--border)] bg-[var(--bg-elevated)] p-5 shadow-xl shadow-black/20 sm:p-6'
            }
          >
            <p className="text-sm text-[var(--text)]">
              Si existe una cuenta con ese correo, enviamos las instrucciones.
              Revisa tu bandeja (y spam).
            </p>
            <Link
              to={loginPath}
              className="mt-4 inline-block text-sm text-[var(--accent)] underline"
            >
              Volver al login
            </Link>
          </div>
        ) : (
          <form
            onSubmit={onSubmit}
            className={
              mobile
                ? 'space-y-4'
                : 'rounded-2xl border border-[var(--border)] bg-[var(--bg-elevated)] p-5 shadow-xl shadow-black/20 sm:p-6'
            }
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
                className={field}
                placeholder="tu@empresa.com"
              />
            </label>

            {error && (
              <p className="mb-4 rounded-lg border border-[var(--danger)]/40 bg-[var(--danger)]/10 px-3 py-2 text-sm text-[var(--danger)]">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={submitting}
              className={
                mobile
                  ? 'w-full rounded-xl bg-[var(--accent)] px-4 py-3.5 text-sm font-semibold text-white disabled:opacity-60'
                  : 'w-full rounded-lg bg-[var(--accent)] px-4 py-2.5 font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-60'
              }
            >
              {submitting ? 'Enviando…' : 'Enviar enlace'}
            </button>

            <p className="mt-4 text-center text-sm text-[var(--text-muted)]">
              <Link to={loginPath} className="text-[var(--accent)] underline">
                Volver al login
              </Link>
            </p>
          </form>
        )}
      </div>
    </div>
  )
}
