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

// Dev: preferir /api (proxy Vite). Si VITE_API_URL apunta a localhost pero
// abres el panel por IP LAN, forzamos /api para que el móvil/otro PC funcione.
function resolveApiUrl(): string {
  const configured = (import.meta.env.VITE_API_URL as string | undefined)?.trim()
  if (import.meta.env.DEV && typeof window !== 'undefined') {
    const host = window.location.hostname
    const onLanHost = host !== 'localhost' && host !== '127.0.0.1'
    if (
      onLanHost &&
      (!configured || /localhost|127\.0\.0\.1/.test(configured))
    ) {
      return '/api'
    }
  }
  if (configured) return configured
  return import.meta.env.DEV ? '/api' : 'http://localhost:3000/api'
}

export const API_URL = resolveApiUrl()

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

  let res: Response
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...options,
      headers,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (/failed to fetch|networkerror|load failed/i.test(msg)) {
      throw new Error(
        'Sin respuesta del API (timeout/red). Reintenta; si persiste, revisa que isp-control-api esté arriba.',
      )
    }
    throw e instanceof Error ? e : new Error(msg)
  }

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

export async function forgotPasswordRequest(
  email: string,
  channel: 'web' | 'mobile' = 'web',
): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>('/auth/forgot-password', {
    method: 'POST',
    body: JSON.stringify({ email, channel }),
  })
}

export async function resetPasswordRequest(
  token: string,
  newPassword: string,
): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>('/auth/reset-password', {
    method: 'POST',
    body: JSON.stringify({ token, newPassword }),
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

/** Download full Postgres dump (custom format). */
export async function downloadDbBackup(): Promise<void> {
  const token = getToken()
  const res = await fetch(`${API_URL}/admin/backup/download`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  if (!res.ok) {
    let message = 'No se pudo descargar el respaldo'
    try {
      const body = (await res.json()) as { message?: string | string[] }
      if (Array.isArray(body.message)) message = body.message.join(', ')
      else if (body.message) message = body.message
    } catch {
      // ignore
    }
    throw new Error(message)
  }
  const dispo = res.headers.get('Content-Disposition') || ''
  const match = /filename="?([^";]+)"?/i.exec(dispo)
  const filename = match?.[1] || `isp-control-backup.backup`
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

/** Restore full DB from a custom-format dump (superadmin). */
export async function restoreDbBackup(file: File): Promise<{
  ok: true
  message: string
  warnings?: string
}> {
  const token = getToken()
  const form = new FormData()
  form.append('file', file)
  form.append('confirm', 'RESTORE')
  const res = await fetch(`${API_URL}/admin/backup/restore`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  })
  if (!res.ok) {
    let message = 'No se pudo restaurar el respaldo'
    try {
      const body = (await res.json()) as { message?: string | string[] }
      if (Array.isArray(body.message)) message = body.message.join(', ')
      else if (body.message) message = body.message
    } catch {
      // ignore
    }
    throw new Error(message)
  }
  return res.json() as Promise<{ ok: true; message: string; warnings?: string }>
}
