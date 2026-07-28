import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { isMobilePwaInstalled } from '../lib/mobilePwa'

/**
 * Si la app está instalada (standalone), fuerza vivir solo en /movil.
 * Evita ir a /app, /login o /admin desde el icono PWA.
 * Conserva query (p. ej. token de reset) al redirigir rutas de recuperación.
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
    if (path === '/recuperar' || path.startsWith('/recuperar/')) {
      navigate(`/movil/recuperar${location.search}`, { replace: true })
      return
    }
    if (path === '/reset-password' || path.startsWith('/reset-password/')) {
      navigate(`/movil/reset-password${location.search}`, { replace: true })
      return
    }
    navigate('/movil', { replace: true })
  }, [location.pathname, location.search, navigate])

  return <>{children}</>
}
