import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { NotificationBell } from '../components/NotificationBell'
import { UserAccountMenu } from '../components/UserAccountMenu'
import { BrandMark } from '../components/BrandMark'
import { useBranding } from '../branding/BrandingContext'
import { isTechPwaSession } from '../lib/pwa'

export function MobileShell() {
  const { user, logout } = useAuth()
  const branding = useBranding()
  const navigate = useNavigate()
  const location = useLocation()
  const asApp = isTechPwaSession()
  const wide =
    location.pathname.startsWith('/movil/mapa-red/mapa') ||
    location.pathname.startsWith('/movil/mapa-red/tecnico') ||
    location.pathname.startsWith('/movil/mapa-red/postes')

  return (
    <div className="mobile-app app-shell flex flex-col bg-[var(--bg)] text-[var(--text)]">
      <header className="relative z-50 shrink-0 border-b border-[var(--border)] bg-[var(--bg-header)]/95 px-4 py-3 backdrop-blur">
        <div
          className={`mx-auto flex items-center justify-between gap-3 ${wide ? 'max-w-3xl' : 'max-w-lg'}`}
        >
          <NavLink
            to="/movil"
            className="flex min-w-0 items-center gap-2.5"
            end
          >
            <BrandMark size={36} className="shrink-0 rounded-lg" />
            <span className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--accent)]">
                {branding.productName}
              </p>
              <p className="truncate text-base font-semibold leading-tight">
                Técnico
              </p>
            </span>
          </NavLink>
          <div className="flex items-center gap-2">
            <NotificationBell variant="tenant" />
            <UserAccountMenu
              displayName={user?.name || user?.email || 'Usuario'}
              subtitle={user?.email}
              canEditAccount
              onGoDesktop={asApp ? undefined : () => navigate('/app')}
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
        className={`app-shell-main mx-auto flex w-full flex-col px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-4 ${
          wide ? 'max-w-3xl' : 'max-w-lg'
        }`}
      >
        <Outlet />
      </main>
    </div>
  )
}
