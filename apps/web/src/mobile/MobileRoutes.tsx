import { useEffect } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { useBranding } from '../branding/BrandingContext'
import { applyMobilePwaManifest } from '../lib/mobilePwa'
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
import { MobileInstallPrompt } from './MobileInstallPrompt'

function MobilePwaEffects() {
  const branding = useBranding()
  useEffect(() => {
    applyMobilePwaManifest(branding)
  }, [branding])
  return <MobileInstallPrompt />
}

export function MobileRoutes() {
  return (
    <>
      <MobilePwaEffects />
      <Routes>
        <Route path="login" element={<MobileLoginPage />} />
        <Route element={<MobileRequireAuth />}>
          <Route element={<MobileShell />}>
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
    </>
  )
}
