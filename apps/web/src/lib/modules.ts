export type ModuleId =
  | 'smtp'
  | 'mercadopago'
  | 'mapa_red'
  | 'whatsapp'
  | 'onu_unlock'
  | 'client_portal'
  | 'asistente_ia'

/** Catálogo global (Admin → Módulos). Solo módulos billable en la UI. */
export type ModuleCatalogItem = {
  id: ModuleId
  name: string
  description: string
  alwaysEnabled: boolean
  billable: boolean
  priceMonthly: number | null
  priceCurrency: string | null
  priceClp: number | null
  fxRate: number | null
  fxRateDate: string | null
  fxStale?: boolean
  availableCountries: string[] | null
  /** Solo en módulo whatsapp: cupo Baileys de plataforma. */
  baileysSlotsUsed?: number
  baileysSlotsMax?: number
}

export type TenantModulesAdminResponse = {
  modules: TenantModuleAdmin[]
  /** Permitir modo Interno del Asistente IA para este tenant. */
  aiInternalEnabled: boolean
}

export type TenantModuleAdmin = {
  id: ModuleId
  name: string
  description: string
  alwaysEnabled: boolean
  billable: boolean
  priceMonthly: number | null
  priceCurrency: string | null
  priceClp: number | null
  fxRate: number | null
  fxRateDate: string | null
  fxStale?: boolean
  availableCountries: string[] | null
  enabled: boolean
  available: boolean
  tenantCountry: string | null
  unavailableReason: string | null
}

export type TenantModuleCard = {
  id: ModuleId
  name: string
  description: string
  alwaysEnabled: boolean
  billable: boolean
  priceMonthly: number | null
  priceCurrency: string | null
  priceClp?: number | null
  fxRate?: number | null
  fxRateDate?: string | null
  configured: boolean
  available?: boolean
  contracted?: boolean
  /** Habilitado por admin o alwaysEnabled (sin cobro al tenant). */
  included?: boolean
  /** Contratado/pagado por el tenant (hay contract activo). */
  purchased?: boolean
  canContract?: boolean
  canConfigure?: boolean
  needsAttention?: boolean
  contract?: {
    id: string
    moduleId: string
    mode: 'one_time' | 'recurring'
    status: string
    monthlyPriceUsd: number
    chargedUsd: number
    startedAt: string
    expiresAt: string | null
  } | null
}

export type SmtpConfig = {
  host: string
  port: number
  secure: boolean
  username: string
  password: string
  fromEmail: string
  fromName: string
  hasPassword: boolean
}

export type MercadoPagoEnvironment = 'sandbox' | 'production'

export type MercadoPagoConfig = {
  environment: MercadoPagoEnvironment
  integration: 'checkout_pro'
  publicKey: string
  accessToken: string
  webhookSecret: string
  hasAccessToken: boolean
  hasWebhookSecret: boolean
  /** País del tenant (ISO); define portal Developers sandbox/producción. */
  country?: string | null
  countryLabel?: string | null
  developersUrl?: string | null
}

export type PayPalEnvironment = 'sandbox' | 'production'

export type PayPalConfig = {
  environment: PayPalEnvironment
  integration: 'checkout'
  clientId: string
  clientSecret: string
  webhookId: string
  hasClientSecret: boolean
  hasWebhookId: boolean
}

export type WhatsAppProvider = 'cloud_api' | 'baileys'
export type WhatsAppBaileysStatus =
  | 'disconnected'
  | 'qr'
  | 'connected'
  | 'connecting'

export type WhatsAppConfig = {
  provider: WhatsAppProvider
  phoneNumberId: string
  businessAccountId: string
  accessToken: string
  webhookVerifyToken: string
  templateName: string
  templateLanguage: string
  hasAccessToken: boolean
  baileysStatus: WhatsAppBaileysStatus
  lastDisconnectAt: string | null
  lastDisconnectReason: string | null
  needsAttention: boolean
  baileysSlots: { used: number; max: number }
  qrDataUrl?: string | null
}

export type AsistenteIaMode = 'own' | 'internal'
export type AsistenteIaOwnProvider =
  | 'openai'
  | 'anthropic'
  | 'grok'
  | 'gemini'
  | 'deepseek'
  | 'latinrouter'

export type AiVendorOption = {
  id: AsistenteIaOwnProvider
  label: string
  models: string[]
  defaultModel: string
}

export type AsistenteIaConfig = {
  mode: AsistenteIaMode
  provider: AsistenteIaOwnProvider
  model: string
  apiKey: string
  enabled: boolean
  hasApiKey: boolean
  /** false = Admin deshabilitó el proveedor interno para este tenant. */
  internalAllowed?: boolean
  vendors?: AiVendorOption[]
  quota?: {
    requestsUsed: number
    requestsLimit: number
    tokensUsed: number
    tokensLimit: number
    platformEnabled: boolean
    platformProvider: string | null
    platformModel: string | null
  }
}

export type PlatformAiSettings = {
  enabled: boolean
  provider: AsistenteIaOwnProvider
  model: string
  apiKey: string
  hasApiKey: boolean
  dailyRequestLimit: number
  dailyTokenLimit: number
  configured: boolean
  vendors?: AiVendorOption[]
}

export type PlatformPaymentMethod = {
  id: string
  provider: 'mercadopago' | 'paypal'
  name: string
  description: string
  enabled: boolean
  environment: MercadoPagoEnvironment | PayPalEnvironment
  integration: string
  configured: boolean
  updatedAt: string
  /** Mercado Pago */
  publicKey?: string
  hasAccessToken?: boolean
  hasWebhookSecret?: boolean
  accessToken?: string
  webhookSecret?: string
  /** PayPal */
  clientId?: string
  hasClientSecret?: boolean
  hasWebhookId?: boolean
  clientSecret?: string
  webhookId?: string
}

export function formatModulePrice(
  priceMonthly: number | null,
  priceCurrency: string | null,
): string | null {
  if (priceMonthly == null || !priceCurrency) return null
  try {
    return new Intl.NumberFormat('es', {
      style: 'currency',
      currency: priceCurrency,
      maximumFractionDigits: priceCurrency === 'CLP' ? 0 : 2,
    }).format(priceMonthly)
  } catch {
    return `${priceMonthly} ${priceCurrency}`
  }
}

export function formatClp(amount: number | null | undefined): string | null {
  if (amount == null || !Number.isFinite(amount)) return null
  return new Intl.NumberFormat('es-CL', {
    style: 'currency',
    currency: 'CLP',
    maximumFractionDigits: 0,
  }).format(amount)
}
