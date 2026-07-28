import { useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useBranding } from '../branding/BrandingContext'
import { BrandMark } from '../components/BrandMark'
import { resetPasswordRequest } from '../lib/api'

export function ResetPasswordPage({
  channel = 'web',
  loginPath = '/login',
}: {
  channel?: 'web' | 'mobile'
  loginPath?: string
}) {
  const branding = useBranding()
  const [params] = useSearchParams()
  const token = params.get('token')?.trim() || ''
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const mobile = channel === 'mobile'
  const field = mobile
    ? 'w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 py-3 text-base outline-none ring-[var(--accent)] focus:ring-2'
    : 'w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-[var(--text)] outline-none ring-[var(--accent)] focus:ring-2'
  const forgotPath = mobile ? '/movil/recuperar' : '/recuperar'

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (password.length < 8) {
      setError('La contraseña debe tener al menos 8 caracteres')
      return
    }
    if (password !== confirm) {
      setError('Las contraseñas no coinciden')
      return
    }
    if (!token) {
      setError('Falta el token del enlace. Solicita uno nuevo.')
      return
    }
    setSubmitting(true)
    try {
      await resetPasswordRequest(token, password)
      setDone(true)
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'No se pudo restablecer',
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
            <BrandMark size={mobile ? 44 : 48} className="rounded-xl" />
          </div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--accent)] sm:text-sm">
            {branding.productName}
          </p>
          <h1 className="mt-1.5 text-2xl font-semibold tracking-tight">
            Nueva contraseña
          </h1>
        </div>

        {!token ? (
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-elevated)] p-5 text-sm">
            <p className="text-[var(--danger)]">
              Enlace incompleto. Solicita un nuevo correo de recuperación.
            </p>
            <Link
              to={forgotPath}
              className="mt-4 inline-block text-[var(--accent)] underline"
            >
              Recuperar contraseña
            </Link>
          </div>
        ) : done ? (
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-elevated)] p-5 text-sm">
            <p>Contraseña actualizada. Ya puedes iniciar sesión.</p>
            <Link
              to={loginPath}
              className="mt-4 inline-block text-[var(--accent)] underline"
            >
              Ir al login
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
                Nueva contraseña
              </span>
              <input
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={field}
              />
            </label>
            <label className="mb-4 block">
              <span className="mb-1.5 block text-sm text-[var(--text-muted)]">
                Confirmar
              </span>
              <input
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className={field}
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
              {submitting ? 'Guardando…' : 'Guardar contraseña'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
