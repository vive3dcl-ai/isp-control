import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { isPlatformRole, type JwtRole } from '../lib/api'

export function ProtectedRoute({ roles }: { roles: JwtRole[] }) {
  const { user, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-[var(--text-muted)]">
        Cargando…
      </div>
    )
  }

  if (!user) {
    const toLogin = location.pathname.startsWith('/movil')
      ? '/movil/login'
      : '/login'
    return <Navigate to={toLogin} replace state={{ from: location }} />
  }

  if (!roles.includes(user.role)) {
    const fallback = isPlatformRole(user.role) ? '/admin' : '/app'
    return <Navigate to={fallback} replace />
  }

  return <Outlet />
}

export function GuestRoute() {
  const { user, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-[var(--text-muted)]">
        Cargando…
      </div>
    )
  }

  // Recuperar/reset deben funcionar aunque haya sesión (enlace del correo).
  const isPasswordRecovery =
    location.pathname === '/recuperar' ||
    location.pathname.startsWith('/recuperar/') ||
    location.pathname === '/reset-password' ||
    location.pathname.startsWith('/reset-password/')

  if (user && !isPasswordRecovery) {
    const dest =
      user.role === 'tenant_user' && location.pathname.startsWith('/movil')
        ? '/movil'
        : user.redirectTo
    return <Navigate to={dest} replace />
  }

  return <Outlet />
}
