import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { isPlatformRole } from '../lib/api'

/** Auth gate for /movil (except /movil/login). */
export function MobileRequireAuth() {
  const { user, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <div className="mobile-app flex min-h-dvh items-center justify-center text-[var(--text-muted)]">
        Cargando…
      </div>
    )
  }

  if (!user) {
    return (
      <Navigate to="/movil/login" replace state={{ from: location }} />
    )
  }

  if (user.role !== 'tenant_user') {
    const fallback = isPlatformRole(user.role) ? '/admin' : user.redirectTo
    return <Navigate to={fallback} replace />
  }

  return <Outlet />
}
