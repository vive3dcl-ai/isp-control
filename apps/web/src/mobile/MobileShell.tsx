import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { UserAccountMenu } from '../components/UserAccountMenu'
import { useBranding } from '../branding/BrandingContext'

export function MobileShell() {
  const { user, logout } = useAuth()
  const branding = useBranding()
  const navigate = useNavigate()
  const location = useLocation()
  const wide =
    location.pathname.startsWith('/movil/mapa-red/mapa') ||
    location.pathname.startsWith('/movil/mapa-red/tecnico') ||
    location.pathname.startsWith('/movil/mapa-red/postes')

  return (
    <div className="mobile-app flex min-h-dvh flex-col bg-[var(--bg)] text-[var(--text)]">
      <header className="sticky top-0 z-30 border-b border-[var(--border)] bg-[var(--bg-header)]/95 px-4 py-3 backdrop-blur">
        <div
          className={`mx-auto flex items-center justify-between gap-3 ${wide ? 'max-w-3xl' : 'max-w-lg'}`}
        >
          <NavLink to="/movil" className="min-w-0" end>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--accent)]">
              {branding.productName}
            </p>
            <p className="truncate text-base font-semibold leading-tight">
              Móvil
            </p>
          </NavLink>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => navigate('/app')}
              className="rounded-lg px-2 py-1.5 text-xs text-[var(--text-muted)] hover:bg-[var(--bg-elevated)]"
              title="Vista escritorio"
            >
              Escritorio
            </button>
            <UserAccountMenu
              displayName={user?.name || user?.email || 'Usuario'}
              subtitle={user?.email}
              canEditAccount
              onLogout={() => {
                void logout().then(() =>
                  navigate('/movil/login', { replace: true }),
                )
              }}
            />
          </div>
        </div>
      </header>

      <main
        className={`mx-auto flex w-full flex-1 flex-col px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-4 ${
          wide ? 'max-w-3xl' : 'max-w-lg'
        }`}
      >
        <Outlet />
      </main>
    </div>
  )
}
