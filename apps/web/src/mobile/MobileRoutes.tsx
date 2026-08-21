import { Navigate, Route, Routes } from 'react-router-dom'
import { MobileShell } from './MobileShell'
import { MobileHomePage } from './MobileHomePage'
import { MobileInstallWizard } from './MobileInstallWizard'
import { MobileCalendarDayPage } from './MobileCalendarDayPage'
import { MobileCalendarFullPage } from './MobileCalendarFullPage'
import { MobileNetworkMapHubPage } from './MobileNetworkMapHubPage'
import { MobileNetworkMapTechPage } from './MobileNetworkMapTechPage'
import { MobileNetworkMapViewPage } from './MobileNetworkMapViewPage'
import { MobileNetworkMapPolesPage } from './MobileNetworkMapPolesPage'
import { MobileLoginPage } from './MobileLoginPage'
import { MobileRequireAuth } from './MobileRequireAuth'
import { ForgotPasswordPage } from '../pages/ForgotPasswordPage'
import { ResetPasswordPage } from '../pages/ResetPasswordPage'
import { AsistenteChatProvider } from '../asistente/AsistenteChatContext'
import { AsistenteLauncher } from '../asistente/AsistenteLauncher'

function MobileAsistenteLayout() {
  return (
    <AsistenteChatProvider>
      <MobileShell />
      <AsistenteLauncher />
    </AsistenteChatProvider>
  )
}

export function MobileRoutes() {
  return (
    <Routes>
      <Route path="login" element={<MobileLoginPage />} />
      <Route
        path="recuperar"
        element={
          <ForgotPasswordPage channel="mobile" loginPath="/movil/login" />
        }
      />
      <Route
        path="reset-password"
        element={
          <ResetPasswordPage channel="mobile" loginPath="/movil/login" />
        }
      />
      <Route element={<MobileRequireAuth />}>
        <Route element={<MobileAsistenteLayout />}>
          <Route index element={<MobileHomePage />} />
          <Route path="instalar" element={<MobileInstallWizard />} />
          <Route path="calendario" element={<MobileCalendarDayPage />} />
          <Route
            path="calendario/completo"
            element={<MobileCalendarFullPage />}
          />
          <Route path="mapa-red" element={<MobileNetworkMapHubPage />} />
          <Route
            path="mapa-red/tecnico"
            element={<MobileNetworkMapTechPage />}
          />
          <Route
            path="mapa-red/mapa"
            element={<MobileNetworkMapViewPage />}
          />
          <Route
            path="mapa-red/postes"
            element={<MobileNetworkMapPolesPage />}
          />
          <Route
            path="consultar"
            element={<Navigate to="/movil/calendario" replace />}
          />
          <Route
            path="soporte"
            element={<Navigate to="/movil/mapa-red" replace />}
          />
          <Route path="*" element={<Navigate to="/movil" replace />} />
        </Route>
      </Route>
    </Routes>
  )
}
