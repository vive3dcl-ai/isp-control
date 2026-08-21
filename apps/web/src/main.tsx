import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from './lib/queryClient'
import { BrandingProvider } from './branding/BrandingContext'
import { acquireModalVisualViewport } from './lib/modalVisualViewport'
import './index.css'
import App from './App.tsx'

// Ajuste de modales al teclado móvil (visualViewport) — activo globalmente
acquireModalVisualViewport()

/** Bloquea zoom por gesto (pinch) en Safari/iOS además del meta viewport. */
function lockIosAppZoom() {
  const block = (event: Event) => {
    event.preventDefault()
  }
  document.addEventListener('gesturestart', block, { passive: false })
  document.addEventListener('gesturechange', block, { passive: false })
  document.addEventListener('gestureend', block, { passive: false })
}

lockIosAppZoom()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <BrandingProvider>
          <App />
        </BrandingProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)
