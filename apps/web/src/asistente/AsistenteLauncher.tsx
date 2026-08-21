import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { AsistenteChatPanel } from './AsistenteChatPanel'
import { useAsistenteChat } from './AsistenteChatContext'

/** Monta el panel de chat (el acceso está en el header desktop). */
export function AsistenteLauncher() {
  const { moduleEnabled, moduleLoading, mode, minimize, closeSideView } =
    useAsistenteChat()
  const location = useLocation()
  const prevPath = useRef(location.pathname)

  // Si cambia la vista principal, minimiza el agente (sin cerrar la sesión)
  useEffect(() => {
    if (prevPath.current === location.pathname) return
    prevPath.current = location.pathname
    if (mode === 'open') {
      closeSideView()
      minimize()
    }
  }, [location.pathname, mode, minimize, closeSideView])

  if (moduleLoading || !moduleEnabled) return null
  return <AsistenteChatPanel />
}
