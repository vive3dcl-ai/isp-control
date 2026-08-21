import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useSubscriptionAccess } from './useSubscriptionAccess'

const SUBSCRIPTION_PATH = '/app/settings'
const SUBSCRIPTION_SEARCH = 'tab=empresa&section=suscripcion'

function isSubscriptionUnlockPath(pathname: string, search: string) {
  if (pathname !== SUBSCRIPTION_PATH) return false
  const q = new URLSearchParams(search)
  return q.get('tab') === 'empresa' && q.get('section') === 'suscripcion'
}

/**
 * Si la suscripción del tenant está en mora, bloquea el panel y fuerza
 * la pantalla de suscripción (salvo impersonación de admin).
 */
export function SubscriptionAccessGate() {
  const location = useLocation()
  const { enabled, blocked, isLoading } = useSubscriptionAccess()

  if (!enabled) return <Outlet />

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-[var(--text-muted)]">
        Verificando suscripción…
      </div>
    )
  }

  if (
    blocked &&
    !isSubscriptionUnlockPath(location.pathname, location.search)
  ) {
    return (
      <Navigate
        to={`${SUBSCRIPTION_PATH}?${SUBSCRIPTION_SEARCH}`}
        replace
        state={{ from: location, subscriptionLocked: true }}
      />
    )
  }

  return <Outlet />
}
