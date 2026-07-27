import { useEffect, type ReactNode } from 'react'
import { Link, NavLink, Outlet, useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { fetchPortalBranding } from '../lib/client-portal'
import { usePortalAuth } from './PortalAuthContext'

export function PortalThemeRoot({ children }: { children: ReactNode }) {
  useEffect(() => {
    const root = document.documentElement
    const apply = () => {
      const dark = window.matchMedia('(prefers-color-scheme: dark)').matches
      // Fallback always dark when no preference matchable — default dark
      root.dataset.portalTheme = dark || !window.matchMedia ? 'dark' : 'light'
      if (!window.matchMedia('(prefers-color-scheme: light)').matches) {
        root.dataset.portalTheme = 'dark'
      } else if (window.matchMedia('(prefers-color-scheme: light)').matches) {
        root.dataset.portalTheme = 'light'
      } else {
        root.dataset.portalTheme = 'dark'
      }
    }
    apply()
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => apply()
    mq.addEventListener('change', onChange)
    return () => {
      mq.removeEventListener('change', onChange)
      delete root.dataset.portalTheme
    }
  }, [])
  return <div className="portal-root min-h-dvh">{children}</div>
}

export function PortalShell() {
  const { slug = '' } = useParams()
  const { user, loading, logout } = usePortalAuth()
  const navigate = useNavigate()
  const branding = useQuery({
    queryKey: ['portal', 'branding', slug],
    queryFn: () => fetchPortalBranding(slug),
    enabled: !!slug,
  })

  useEffect(() => {
    if (!loading && !user) {
      navigate(`/${slug}/portal`, { replace: true })
    }
  }, [loading, user, navigate, slug])

  if (loading || !user) {
    return (
      <PortalThemeRoot>
        <div className="flex min-h-dvh items-center justify-center text-[var(--portal-muted)]">
          Cargando…
        </div>
      </PortalThemeRoot>
    )
  }

  const company = branding.data?.name || user.tenantName || 'Portal'
  const base = `/${slug}/portal`

  return (
    <PortalThemeRoot>
      <div className="portal-shell mx-auto flex min-h-dvh max-w-6xl flex-col px-4 pb-10 pt-6 sm:px-6">
        <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            {branding.data?.logoUrl ? (
              <img
                src={branding.data.logoUrl}
                alt=""
                className="h-10 w-10 rounded-lg object-cover"
              />
            ) : (
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--portal-accent)]/20 text-sm font-bold text-[var(--portal-accent)]">
                {company.slice(0, 1).toUpperCase()}
              </div>
            )}
            <div>
              <p className="portal-brand text-xl font-semibold tracking-tight">
                {company}
              </p>
              <p className="text-sm text-[var(--portal-muted)]">
                Hola, {user.name || user.email}
              </p>
            </div>
          </div>
          <nav className="flex flex-wrap items-center gap-1 text-sm">
            <NavLink
              to={`${base}/servicios`}
              className={({ isActive }) =>
                `rounded-lg px-3 py-2 ${isActive ? 'bg-[var(--portal-elevated)] font-medium' : 'text-[var(--portal-muted)] hover:text-[var(--portal-text)]'}`
              }
            >
              Servicios
            </NavLink>
            <NavLink
              to={`${base}/facturas`}
              className={({ isActive }) =>
                `rounded-lg px-3 py-2 ${isActive ? 'bg-[var(--portal-elevated)] font-medium' : 'text-[var(--portal-muted)] hover:text-[var(--portal-text)]'}`
              }
            >
              Facturas
            </NavLink>
            <NavLink
              to={`${base}/cuenta`}
              className={({ isActive }) =>
                `rounded-lg px-3 py-2 ${isActive ? 'bg-[var(--portal-elevated)] font-medium' : 'text-[var(--portal-muted)] hover:text-[var(--portal-text)]'}`
              }
            >
              Cuenta
            </NavLink>
            <button
              type="button"
              onClick={() => {
                logout()
                navigate(`/${slug}/portal`)
              }}
              className="ml-1 rounded-lg px-3 py-2 text-[var(--portal-muted)] hover:text-[var(--portal-text)]"
            >
              Salir
            </button>
          </nav>
        </header>
        <Outlet />
        <footer className="mt-auto pt-12 text-center text-xs text-[var(--portal-muted)]">
          <Link to={`/${slug}/portal`} className="hover:underline">
            {company}
          </Link>{' '}
          · Portal de clientes
        </footer>
      </div>
    </PortalThemeRoot>
  )
}
