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
  type AuthUser,
  type LoginResponse,
  clearAdminToken,
  clearAllAuthTokens,
  getAdminToken,
  getRememberPreference,
  getToken,
  impersonateRequest,
  loginRequest,
  logoutRequest,
  meRequest,
  setAdminToken,
  setRememberedEmail,
  setToken,
} from '../lib/api'

interface AuthContextValue {
  user: AuthUser | null
  loading: boolean
  isImpersonating: boolean
  login: (
    email: string,
    password: string,
    opts?: { remember?: boolean; channel?: 'web' | 'mobile' },
  ) => Promise<AuthUser>
  logout: () => Promise<void>
  enterTenant: (tenantId: string) => Promise<AuthUser>
  exitImpersonation: () => Promise<AuthUser>
  applySession: (result: LoginResponse) => AuthUser
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const token = getToken()
    if (!token) {
      setLoading(false)
      return
    }

    meRequest()
      .then(setUser)
      .catch(() => {
        clearAllAuthTokens()
        setUser(null)
      })
      .finally(() => setLoading(false))
  }, [])

  const login = useCallback(
    async (
      email: string,
      password: string,
      opts?: { remember?: boolean; channel?: 'web' | 'mobile' },
    ) => {
      clearAdminToken()
      const remember = opts?.remember ?? getRememberPreference()
      const result = await loginRequest(email, password, {
        remember,
        channel: opts?.channel ?? 'web',
      })
      setToken(result.accessToken, remember)
      if (remember) setRememberedEmail(email)
      else setRememberedEmail(null)
      const nextUser: AuthUser = {
        ...result.user,
        redirectTo: result.redirectTo,
      }
      setUser(nextUser)
      return nextUser
    },
    [],
  )

  const logout = useCallback(async () => {
    await logoutRequest()
    setUser(null)
  }, [])

  const enterTenant = useCallback(async (tenantId: string) => {
    const current = getToken()
    if (!current) {
      throw new Error('No hay sesión de admin activa')
    }

    const result = await impersonateRequest(tenantId)
    setAdminToken(current)
    setToken(result.accessToken)

    const nextUser: AuthUser = {
      ...result.user,
      redirectTo: result.redirectTo,
    }
    setUser(nextUser)
    return nextUser
  }, [])

  const exitImpersonation = useCallback(async () => {
    const adminToken = getAdminToken()
    if (!adminToken) {
      throw new Error('No hay sesión de admin para restaurar')
    }

    setToken(adminToken)
    clearAdminToken()

    const restored = await meRequest()
    setUser(restored)
    return restored
  }, [])

  const applySession = useCallback((result: LoginResponse) => {
    setToken(result.accessToken, true)
    const nextUser: AuthUser = {
      ...result.user,
      redirectTo: result.redirectTo,
    }
    setUser(nextUser)
    return nextUser
  }, [])

  const isImpersonating = Boolean(
    user?.impersonatedBy || getAdminToken(),
  )

  const value = useMemo(
    () => ({
      user,
      loading,
      isImpersonating,
      login,
      logout,
      enterTenant,
      exitImpersonation,
      applySession,
    }),
    [
      user,
      loading,
      isImpersonating,
      login,
      logout,
      enterTenant,
      exitImpersonation,
      applySession,
    ],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider')
  }
  return ctx
}
