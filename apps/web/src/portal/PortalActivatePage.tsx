import { FormEvent, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  activateInvite,
  fetchInvite,
  portalMe,
} from '../lib/client-portal'
import { usePortalAuth } from './PortalAuthContext'
import { PortalThemeRoot } from './PortalShell'

export function PortalActivatePage() {
  const { slug = '' } = useParams()
  const [params] = useSearchParams()
  const token = params.get('token') || ''
  const navigate = useNavigate()
  const { setUser } = usePortalAuth()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const invite = useQuery({
    queryKey: ['portal', 'invite', token],
    queryFn: () => fetchInvite(token),
    enabled: !!token,
    retry: false,
  })

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (password.length < 8) {
      setError('La contraseña debe tener al menos 8 caracteres')
      return
    }
    if (password !== confirm) {
      setError('Las contraseñas no coinciden')
      return
    }
    setBusy(true)
    try {
      const result = await activateInvite(token, password)
      const me = await portalMe()
      setUser(me)
      const nextSlug = result.user.tenantSlug || invite.data?.slug || slug
      navigate(`/${nextSlug}/portal/servicios`, { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo activar')
    } finally {
      setBusy(false)
    }
  }

  return (
    <PortalThemeRoot>
      <div className="flex min-h-dvh items-center justify-center px-4 py-12">
        <div className="w-full max-w-md">
          <h1 className="portal-brand mb-2 text-3xl font-semibold">
            {invite.data?.companyName || 'Crear cuenta'}
          </h1>
          <p className="mb-6 text-[var(--portal-muted)]">
            Elige una contraseña para acceder a tu portal
          </p>
          {!token ? (
            <p className="text-red-400">Falta el token de invitación.</p>
          ) : invite.isError ? (
            <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
              {invite.error instanceof Error
                ? invite.error.message
                : 'Invitación inválida'}
            </p>
          ) : (
            <form
              onSubmit={onSubmit}
              className="space-y-4 rounded-2xl border border-[var(--portal-border)] bg-[var(--portal-elevated)] p-6"
            >
              <p className="text-sm">
                <span className="text-[var(--portal-muted)]">Correo: </span>
                {invite.data?.email || '…'}
              </p>
              <label className="block text-sm">
                <span className="mb-1 block text-[var(--portal-muted)]">
                  Contraseña
                </span>
                <input
                  type="password"
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-xl border border-[var(--portal-border)] bg-[var(--portal-bg)] px-3 py-2.5 outline-none focus:border-[var(--portal-accent)]"
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-[var(--portal-muted)]">
                  Confirmar contraseña
                </span>
                <input
                  type="password"
                  required
                  minLength={8}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  className="w-full rounded-xl border border-[var(--portal-border)] bg-[var(--portal-bg)] px-3 py-2.5 outline-none focus:border-[var(--portal-accent)]"
                />
              </label>
              {error && <p className="text-sm text-red-400">{error}</p>}
              <button
                type="submit"
                disabled={busy || invite.isLoading}
                className="w-full rounded-xl bg-[var(--portal-accent)] px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
              >
                {busy ? 'Creando…' : 'Crear cuenta'}
              </button>
            </form>
          )}
        </div>
      </div>
    </PortalThemeRoot>
  )
}
