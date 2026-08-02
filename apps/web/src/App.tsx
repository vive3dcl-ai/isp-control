import { useEffect } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { AuthProvider } from './auth/AuthContext'
import { GuestRoute, ProtectedRoute } from './auth/ProtectedRoute'
import { NotifyProvider } from './components/NotifyProvider'
import { LoginPage } from './pages/LoginPage'
import { ForgotPasswordPage } from './pages/ForgotPasswordPage'
import { ResetPasswordPage } from './pages/ResetPasswordPage'
import { AdminDashboardPage } from './pages/AdminDashboardPage'
import { AdminTenantsPage } from './pages/AdminTenantsPage'
import { AdminTenantDetailPage } from './pages/AdminTenantDetailPage'
import { TenantDashboardPage } from './pages/TenantDashboardPage'
import { ClientsPage } from './pages/ClientsPage'
import { ClientDetailPage } from './pages/ClientDetailPage'
import { TopologyPage } from './pages/TopologyPage'
import { NetworkMapPage } from './pages/NetworkMapPage'
import { InventoryPage } from './pages/InventoryPage'
import { SettingsPage } from './pages/SettingsPage'
import { AdminOnusPage } from './pages/AdminOnusPage'
import { AdminPaymentMethodsPage } from './pages/AdminPaymentMethodsPage'
import { AdminModulesPage } from './pages/AdminModulesPage'
import { AdminSettingsPage } from './pages/AdminSettingsPage'
import {
  AdminTicketDetailPage,
  AdminTicketsPage,
} from './pages/AdminTicketsPage'
import {
  TenantSupportDetailPage,
  TenantSupportPage,
} from './pages/TenantSupportPage'
import { UsersPage } from './pages/UsersPage'
import { CalendarPage } from './pages/CalendarPage'
import { AdminTenantUsersPage } from './pages/AdminTenantUsersPage'
import { PortalRoutes } from './portal/PortalRoutes'
import { MobileRoutes } from './mobile/MobileRoutes'
import { StandaloneMobileGuard } from './mobile/StandaloneMobileGuard'
import { MobileInstallPrompt } from './mobile/MobileInstallPrompt'
import { AdminInstallPrompt } from './components/AdminInstallPrompt'
import { PushEnablePrompt } from './components/PushEnablePrompt'
import { useBranding } from './branding/BrandingContext'
import {
  applyAdminPwaManifest,
  applyTechPwaManifest,
  syncPwaKindFromLocation,
} from './lib/pwa'
import { PLATFORM_ROLES } from './lib/api'

/** Un solo punto: manifest Técnico en /movil, Administración en el resto. */
function DualPwaHost() {
  const location = useLocation()
  const branding = useBranding()
  const isTech = location.pathname.startsWith('/movil')
  const isPortal =
    location.pathname.includes('/portal') ||
    /^\/[^/]+\/portal/.test(location.pathname)

  useEffect(() => {
    syncPwaKindFromLocation()
    if (isPortal) return
    if (isTech) applyTechPwaManifest(branding)
    else applyAdminPwaManifest(branding)
  }, [branding, isTech, isPortal])

  if (isPortal) return null
  if (isTech) return <MobileInstallPrompt />
  return <AdminInstallPrompt />
}

export default function App() {
  return (
    <AuthProvider>
      <NotifyProvider>
        <StandaloneMobileGuard>
        <DualPwaHost />
        <PushEnablePrompt />
        <Routes>
          <Route path="/:slug/portal/*" element={<PortalRoutes />} />

          <Route element={<GuestRoute />}>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/recuperar" element={<ForgotPasswordPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />
          </Route>

          <Route element={<ProtectedRoute roles={[...PLATFORM_ROLES]} />}>
            <Route path="/admin" element={<AdminDashboardPage />} />
            <Route path="/admin/tenants" element={<AdminTenantsPage />} />
            <Route
              path="/admin/tenants/:id"
              element={<AdminTenantDetailPage />}
            />
            <Route path="/admin/tickets" element={<AdminTicketsPage />} />
            <Route
              path="/admin/tickets/:id"
              element={<AdminTicketDetailPage />}
            />
            <Route path="/admin/onus" element={<AdminOnusPage />} />
            <Route path="/admin/modules" element={<AdminModulesPage />} />
            <Route
              path="/admin/tenant-users"
              element={<AdminTenantUsersPage />}
            />
            <Route path="/admin/settings" element={<AdminSettingsPage />} />
            <Route
              path="/admin/payment-methods"
              element={<AdminPaymentMethodsPage />}
            />
          </Route>

          <Route element={<ProtectedRoute roles={['tenant_user']} />}>
            <Route path="/app" element={<TenantDashboardPage />} />
            <Route path="/app/clients" element={<ClientsPage />} />
            <Route path="/app/clients/:id" element={<ClientDetailPage />} />
            <Route path="/app/calendar" element={<CalendarPage />} />
            <Route path="/app/users" element={<UsersPage />} />
            <Route
              path="/app/plans"
              element={<Navigate to="/app/settings?tab=plans" replace />}
            />
            <Route path="/app/topology" element={<TopologyPage />} />
            <Route path="/app/network-map" element={<NetworkMapPage />} />
            <Route path="/app/inventory" element={<InventoryPage />} />
            <Route path="/app/support" element={<TenantSupportPage />} />
            <Route
              path="/app/support/:id"
              element={<TenantSupportDetailPage />}
            />
            <Route path="/app/settings" element={<SettingsPage />} />
          </Route>

          <Route path="/movil/*" element={<MobileRoutes />} />

          <Route path="/" element={<Navigate to="/login" replace />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
        </StandaloneMobileGuard>
      </NotifyProvider>
    </AuthProvider>
  )
}
