export type PlatformRole = 'superadmin' | 'admin' | 'user'
export type TenantUserRole =
  | 'owner'
  | 'admin'
  | 'user'
  | 'tecnico'
  | 'administrativo'

export type JwtRole = PlatformRole | 'tenant_user' | 'client_portal'

export const PLATFORM_ROLES: PlatformRole[] = ['superadmin', 'admin', 'user']

export function isPlatformRole(role: string): role is PlatformRole {
  return (PLATFORM_ROLES as string[]).includes(role)
}

export interface AuthUser {
  id: string
  email: string
  name: string
  role: JwtRole
  tenantId?: string
  tenantSlug?: string
  tenantRole?: TenantUserRole | string
  clientId?: string
  impersonatedBy?: string
  impersonatorEmail?: string
  redirectTo: '/admin' | '/app' | string
}

export interface LoginResponse {
  accessToken: string
  redirectTo: '/admin' | '/app' | string
  user: Omit<AuthUser, 'redirectTo'>
}

const TOKEN_KEY = 'isp_access_token'
const ADMIN_TOKEN_KEY = 'isp_admin_token'
const PORTAL_TOKEN_KEY = 'isp_portal_token'
const REMEMBER_KEY = 'isp_remember_me'
const REMEMBER_EMAIL_KEY = 'isp_remember_email'

export function getToken(): string | null {
  return (
    localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY)
  )
}

export function setToken(token: string, remember = true) {
  localStorage.removeItem(TOKEN_KEY)
  sessionStorage.removeItem(TOKEN_KEY)
  if (remember) {
    localStorage.setItem(REMEMBER_KEY, '1')
    localStorage.setItem(TOKEN_KEY, token)
  } else {
    localStorage.removeItem(REMEMBER_KEY)
    sessionStorage.setItem(TOKEN_KEY, token)
  }
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY)
  sessionStorage.removeItem(TOKEN_KEY)
}

export function getRememberPreference(): boolean {
  return localStorage.getItem(REMEMBER_KEY) === '1'
}

export function getRememberedEmail(): string {
  return localStorage.getItem(REMEMBER_EMAIL_KEY) || ''
}

export function setRememberedEmail(email: string | null) {
  if (email?.trim()) {
    localStorage.setItem(REMEMBER_EMAIL_KEY, email.trim().toLowerCase())
  } else {
    localStorage.removeItem(REMEMBER_EMAIL_KEY)
  }
}

export function getAdminToken(): string | null {
  return localStorage.getItem(ADMIN_TOKEN_KEY)
}

export function setAdminToken(token: string) {
  localStorage.setItem(ADMIN_TOKEN_KEY, token)
}

export function clearAdminToken() {
  localStorage.removeItem(ADMIN_TOKEN_KEY)
}

export function getPortalToken(): string | null {
  return localStorage.getItem(PORTAL_TOKEN_KEY)
}

export function setPortalToken(token: string) {
  localStorage.setItem(PORTAL_TOKEN_KEY, token)
}

export function clearPortalToken() {
  localStorage.removeItem(PORTAL_TOKEN_KEY)
}

export function clearAllAuthTokens() {
  clearToken()
  clearAdminToken()
  clearPortalToken()
}

// Dev: http://localhost:3000/api · Prod (nginx): /api
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api'

export async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = getToken()
  const headers = new Headers(options.headers)
  headers.set('Content-Type', 'application/json')
  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }

  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers,
  })

  if (!res.ok) {
    let message = 'Request failed'
    try {
      const body = (await res.json()) as { message?: string | string[] }
      if (Array.isArray(body.message)) {
        message = body.message.join(', ')
      } else if (body.message) {
        message = body.message
      }
    } catch {
      // ignore
    }
    throw new Error(message)
  }

  return res.json() as Promise<T>
}

export async function loginRequest(
  email: string,
  password: string,
  opts?: { remember?: boolean; channel?: 'web' | 'mobile' },
): Promise<LoginResponse> {
  return apiFetch<LoginResponse>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({
      email,
      password,
      remember: opts?.remember ?? false,
      channel: opts?.channel ?? 'web',
    }),
  })
}

export async function meRequest(): Promise<AuthUser> {
  return apiFetch<AuthUser>('/auth/me')
}

export async function impersonateRequest(
  tenantId: string,
): Promise<LoginResponse> {
  return apiFetch<LoginResponse>(`/admin/tenants/${tenantId}/impersonate`, {
    method: 'POST',
  })
}

export async function logoutRequest(): Promise<void> {
  try {
    await apiFetch('/auth/logout', { method: 'POST' })
  } finally {
    clearAllAuthTokens()
  }
}
