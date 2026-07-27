import { Navigate, Route, Routes, useParams } from 'react-router-dom'
import { PortalAuthProvider } from './PortalAuthContext'
import { PortalShell } from './PortalShell'
import { PortalLoginPage } from './PortalLoginPage'
import { PortalActivatePage } from './PortalActivatePage'
import { PortalServicesPage } from './PortalServicesPage'
import { PortalInvoicesPage } from './PortalInvoicesPage'
import { PortalAccountPage } from './PortalAccountPage'

function PortalIndexRedirect() {
  const { slug = '' } = useParams()
  return <Navigate to={`/${slug}/portal/servicios`} replace />
}

export function PortalRoutes() {
  return (
    <PortalAuthProvider>
      <Routes>
        <Route index element={<PortalLoginPage />} />
        <Route path="activar" element={<PortalActivatePage />} />
        <Route element={<PortalShell />}>
          <Route path="servicios" element={<PortalServicesPage />} />
          <Route path="facturas" element={<PortalInvoicesPage />} />
          <Route path="cuenta" element={<PortalAccountPage />} />
          <Route path="home" element={<PortalIndexRedirect />} />
        </Route>
        <Route path="*" element={<PortalLoginPage />} />
      </Routes>
    </PortalAuthProvider>
  )
}
