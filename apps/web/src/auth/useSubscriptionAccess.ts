import { useQuery } from '@tanstack/react-query'
import { useAuth } from './AuthContext'
import { apiFetch } from '../lib/api'
import type { TenantSubscription } from '../lib/platform'

/** Query compartida: mora / bloqueo de acceso al panel tenant. */
export function useSubscriptionAccess() {
  const { user, isImpersonating } = useAuth()
  const enabled = user?.role === 'tenant_user' && !isImpersonating

  const query = useQuery({
    queryKey: ['app', 'settings', 'subscription', 'access'],
    queryFn: () =>
      apiFetch<TenantSubscription>('/app/settings/subscription'),
    enabled,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  })

  const sub = query.data
  /** Bloqueo duro solo tras gracia (accessBlocked). */
  const blocked = enabled && sub?.accessBlocked === true
  /** Factura vencida en período de gracia: modal nag. */
  const invoiceOverdue =
    enabled && sub?.invoiceOverdue === true && !blocked

  return {
    enabled,
    query,
    blocked: !!blocked,
    invoiceOverdue: !!invoiceOverdue,
    isLoading: enabled && query.isLoading,
    subscription: sub,
  }
}
