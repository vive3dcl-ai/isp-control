import { FormEvent, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  fetchPortalBranding,
  portalLogin,
  portalMe,
} from '../lib/client-portal'
import { usePortalAuth } from './PortalAuthContext'
import { PortalThemeRoot } from './PortalShell'
import { getPortalToken } from '../lib/api'

export function PortalLoginPage() {
  const { slug = '' } = useParams()
  const navigate = useNavigate()
  const { setUser, user, loading } = usePortalAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const branding = useQuery({
    queryKey: ['portal', 'branding', slug],
    queryFn: () => fetchPortalBranding(slug),
    enabled: !!slug,
    retry: false,
  })

  useEffect(() => {
    if (!loading && user) {
      navigate(`/${slug}/portal/servicios`, { replace: true })
    }
  }, [loading, user, navigate, slug])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      await portalLogin(slug, email, password)
      const me = await portalMe()
      setUser(me)
      navigate(`/${slug}/portal/servicios`, { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo iniciar sesión')
    } finally {
      setBusy(false)
    }
  }

  const company = branding.data?.name || 'Portal de clientes'

  return (
    <PortalThemeRoot>
      <div className="relative flex min-h-dvh items-center justify-center overflow-hidden px-4 py-12">
        <div
          className="pointer-events-none absolute inset-0 opacity-80"
          style={{
            background:
              'radial-gradient(ellipse 80% 50% at 20% 10%, color-mix(in srgb, var(--portal-accent) 28%, transparent), transparent), radial-gradient(ellipse 60% 40% at 90% 80%, color-mix(in srgb, var(--portal-accent) 12%, transparent), transparent)',
          }}
        />
        <div className="relative w-full max-w-md">
          <div className="mb-8 text-center">
            {branding.data?.logoUrl ? (
              <img
                src={branding.data.logoUrl}
                alt=""
                className="mx-auto mb-4 h-14 w-14 rounded-xl object-cover"
              />
            ) : null}
            <h1 className="portal-brand text-3xl font-semibold tracking-tight sm:text-4xl">
              {company}
            </h1>
            <p className="mt-2 text-[var(--portal-muted)]">
              Accede a tus servicios y facturas
            </p>
          </div>
          {branding.isError ? (
            <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
              Portal no disponible para esta empresa.
            </p>
          ) : (
            <form
              onSubmit={onSubmit}
              className="space-y-4 rounded-2xl border border-[var(--portal-border)] bg-[var(--portal-elevated)]/80 p-6 backdrop-blur"
            >
              <label className="block text-sm">
                <span className="mb-1 block text-[var(--portal-muted)]">
                  Correo
                </span>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-xl border border-[var(--portal-border)] bg-[var(--portal-bg)] px-3 py-2.5 outline-none focus:border-[var(--portal-accent)]"
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-[var(--portal-muted)]">
                  Contraseña
                </span>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-xl border border-[var(--portal-border)] bg-[var(--portal-bg)] px-3 py-2.5 outline-none focus:border-[var(--portal-accent)]"
                />
              </label>
              {error && (
                <p className="text-sm text-red-400">{error}</p>
              )}
              <button
                type="submit"
                disabled={busy || branding.isError}
                className="w-full rounded-xl bg-[var(--portal-accent)] px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
              >
                {busy ? 'Entrando…' : 'Entrar'}
              </button>
            </form>
          )}
          {getPortalToken() ? (
            <p className="mt-4 text-center text-xs text-[var(--portal-muted)]">
              <Link to={`/${slug}/portal/servicios`} className="underline">
                Ir al panel
              </Link>
            </p>
          ) : null}
        </div>
      </div>
    </PortalThemeRoot>
  )
}
