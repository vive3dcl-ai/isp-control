import {
  clearPortalToken,
  getPortalToken,
  setPortalToken,
  type LoginResponse,
} from './api'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api'

export type PortalBranding = {
  slug: string
  name: string
  logoUrl: string | null
  currency: string
}

export type PortalPaymentMethod = {
  id: string
  name: string
  configured: boolean
}

export type PortalMe = {
  id: string
  email: string
  name: string
  clientId: string
  tenantId: string
  tenantSlug: string | null
  tenantName: string | null
  status: string
  paymentMethods: PortalPaymentMethod[]
}

export type PortalService = {
  id: string
  name: string
  status: string
  price: string
  planName: string | null
  street: string
  city: string
  onuId: string | null
  onuName: string | null
  onuSn: string | null
  signalDbm: number | null
}

export type PortalInvoice = {
  id: string
  number: string
  status: string
  type: string
  currency: string
  total: string
  issueDate: string
  dueDate: string | null
  payable: boolean
  items: Array<{
    id: string
    description: string
    quantity: string
    unitPrice: string
    amount: string
  }>
}

async function portalFetch<T>(
  path: string,
  options: RequestInit = {},
  auth = true,
): Promise<T> {
  const headers = new Headers(options.headers)
  if (!(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json')
  }
  if (auth) {
    const token = getPortalToken()
    if (token) headers.set('Authorization', `Bearer ${token}`)
  }
  const res = await fetch(`${API_URL}${path}`, { ...options, headers })
  if (!res.ok) {
    let message = 'Error'
    try {
      const body = (await res.json()) as { message?: string | string[] }
      message = Array.isArray(body.message)
        ? body.message.join(', ')
        : body.message || message
    } catch {
      /* ignore */
    }
    throw new Error(message)
  }
  if (res.status === 204) return undefined as T
  const ct = res.headers.get('content-type') || ''
  if (ct.includes('application/json')) return res.json() as Promise<T>
  return res as unknown as T
}

export async function fetchPortalBranding(slug: string) {
  return portalFetch<PortalBranding>(
    `/public/client-portal/${encodeURIComponent(slug)}/branding`,
    {},
    false,
  )
}

export async function portalLogin(
  slug: string,
  email: string,
  password: string,
) {
  const result = await portalFetch<LoginResponse>(
    `/public/client-portal/${encodeURIComponent(slug)}/login`,
    {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    },
    false,
  )
  setPortalToken(result.accessToken)
  return result
}

export async function fetchInvite(token: string) {
  return portalFetch<{
    email: string
    name: string
    companyName: string
    slug: string
    expiresAt: string
  }>(`/public/client-portal/invite/${encodeURIComponent(token)}`, {}, false)
}

export async function activateInvite(token: string, password: string) {
  const result = await portalFetch<LoginResponse>(
    `/public/client-portal/invite/${encodeURIComponent(token)}/activate`,
    {
      method: 'POST',
      body: JSON.stringify({ password }),
    },
    false,
  )
  setPortalToken(result.accessToken)
  return result
}

export async function portalMe() {
  return portalFetch<PortalMe>('/portal/me')
}

export async function portalUpdateMe(body: { name?: string; email?: string }) {
  return portalFetch<PortalMe>('/portal/me', {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

export async function portalChangePassword(
  currentPassword: string,
  newPassword: string,
) {
  return portalFetch<{ ok: true }>('/portal/change-password', {
    method: 'POST',
    body: JSON.stringify({ currentPassword, newPassword }),
  })
}

export async function portalServices() {
  return portalFetch<PortalService[]>('/portal/services')
}

export async function portalServiceMetrics(id: string, hours = 24) {
  return portalFetch<{
    serviceId: string
    onuId: string | null
    hours: number
    samples: Array<{ kind: string; value: number; sampledAt: string }>
  }>(`/portal/services/${id}/metrics?hours=${hours}`)
}

export async function portalInvoices() {
  return portalFetch<{
    invoices: PortalInvoice[]
    paymentMethods: PortalPaymentMethod[]
  }>('/portal/invoices')
}

export async function portalPayInvoice(id: string) {
  return portalFetch<{
    ok: boolean
    checkoutUrl: string
    provider: string
  }>(`/portal/invoices/${id}/pay`, { method: 'POST' })
}

export function portalInvoicePdfUrl(id: string) {
  const token = getPortalToken()
  return `${API_URL}/portal/invoices/${id}/pdf${token ? `?access_token=` : ''}`
}

/** Download PDF with bearer token via blob. */
export async function downloadPortalInvoicePdf(id: string, filename: string) {
  const token = getPortalToken()
  const res = await fetch(`${API_URL}/portal/invoices/${id}/pdf`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  if (!res.ok) throw new Error('No se pudo descargar el PDF')
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.target = '_blank'
  a.click()
  URL.revokeObjectURL(url)
}

export function logoutPortal() {
  clearPortalToken()
}
