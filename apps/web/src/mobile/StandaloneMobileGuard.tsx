import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { isMobilePwaInstalled } from '../lib/mobilePwa'

/**
 * Si la app está instalada (standalone), fuerza vivir solo en /movil.
 * Evita ir a /app, /login o /admin desde el icono PWA.
 */
export function StandaloneMobileGuard({
  children,
}: {
  children: React.ReactNode
}) {
  const location = useLocation()
  const navigate = useNavigate()

  useEffect(() => {
    if (!isMobilePwaInstalled()) return
    const path = location.pathname
    if (path.startsWith('/movil')) return
    // Portal de clientes puede quedar fuera del scope móvil.
    if (path.startsWith('/portal')) return
    if (path === '/login' || path.startsWith('/login/')) {
      navigate('/movil/login', { replace: true })
      return
    }
    navigate('/movil', { replace: true })
  }, [location.pathname, navigate])

  return <>{children}</>
}
