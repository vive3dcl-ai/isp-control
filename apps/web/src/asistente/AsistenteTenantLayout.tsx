import { Outlet } from 'react-router-dom'
import { useSubscriptionAccess } from '../auth/useSubscriptionAccess'
import { SubscriptionOverdueModal } from '../components/SubscriptionOverdueModal'
import { AsistenteChatProvider } from './AsistenteChatContext'
import { AsistenteLauncher } from './AsistenteLauncher'

/** Layout de rutas tenant (/app): provider + FAB/panel. */
export function AsistenteTenantLayout() {
  const { blocked } = useSubscriptionAccess()

  return (
    <AsistenteChatProvider>
      <Outlet />
      {!blocked && <AsistenteLauncher />}
      <SubscriptionOverdueModal />
    </AsistenteChatProvider>
  )
}
