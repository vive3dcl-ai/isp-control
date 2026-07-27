import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import {
  logoutPortal,
  portalMe,
  type PortalMe,
} from '../lib/client-portal'
import { getPortalToken } from '../lib/api'

type PortalAuthValue = {
  user: PortalMe | null
  loading: boolean
  refresh: () => Promise<void>
  logout: () => void
  setUser: (u: PortalMe | null) => void
}

const PortalAuthContext = createContext<PortalAuthValue | null>(null)

export function PortalAuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<PortalMe | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    const token = getPortalToken()
    if (!token) {
      setUser(null)
      return
    }
    const me = await portalMe()
    setUser(me)
  }, [])

  useEffect(() => {
    const token = getPortalToken()
    if (!token) {
      setLoading(false)
      return
    }
    portalMe()
      .then(setUser)
      .catch(() => {
        logoutPortal()
        setUser(null)
      })
      .finally(() => setLoading(false))
  }, [])

  const logout = useCallback(() => {
    logoutPortal()
    setUser(null)
  }, [])

  const value = useMemo(
    () => ({ user, loading, refresh, logout, setUser }),
    [user, loading, refresh, logout],
  )

  return (
    <PortalAuthContext.Provider value={value}>
      {children}
    </PortalAuthContext.Provider>
  )
}

export function usePortalAuth() {
  const ctx = useContext(PortalAuthContext)
  if (!ctx) throw new Error('usePortalAuth outside provider')
  return ctx
}
