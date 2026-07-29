import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { isTechPwaSession, syncPwaKindFromLocation } from '../lib/pwa'

/**
 * Solo la PWA “Técnico ISP” (scope /movil) debe quedarse en /movil.
 * La PWA “Administración ISP” puede navegar el panel completo.
 */
export function StandaloneMobileGuard({
  children,
}: {
  children: React.ReactNode
}) {
  const location = useLocation()
  const navigate = useNavigate()

  useEffect(() => {
    syncPwaKindFromLocation()
    if (!isTechPwaSession()) return
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
