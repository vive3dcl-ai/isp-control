/**
 * Catálogo de módulos de plataforma.
 *
 * - `alwaysEnabled`: no se puede desactivar desde Admin (p. ej. SMTP).
 * - `billable`: módulos de pago; Admin puede habilitarlos por tenant.
 * - `priceMonthly` + `priceCurrency`: tarifa del add-on (null si gratis).
 * - `hasConfig`: si false, Integraciones no muestra «Configurar» (solo contratar).
 * - La config operativa de cada módulo vive en el schema del tenant
 *   (`module_configs`), no en `public.tenants`.
 *
 * Separación de pagos:
 * - Plataforma (`platform_payment_methods`): cobro de suscripciones ISP Control.
 * - Tenant (módulo `mercadopago`): cobro a los clientes finales del ISP.
 */
export type ModuleId =
  | 'smtp'
  | 'mercadopago'
  | 'mapa_red'
  | 'whatsapp'
  | 'onu_unlock'
  | 'client_portal';

export type ModuleDefinition = {
  id: ModuleId;
  name: string;
  description: string;
  alwaysEnabled: boolean;
  billable: boolean;
  /** Precio mensual del módulo (null = incluido / sin cargo). Cobrado en esta moneda (plataforma usa USD). */
  priceMonthly: number | null;
  priceCurrency: string | null;
  /**
   * Si está definido, el módulo solo se puede habilitar a tenants con esos países.
   * Mercado Pago Checkout Pro → países oficiales MP.
   */
  availableCountries: string[] | null;
  /** Si es false, el módulo no tiene modal de configuración (solo entitlement). */
  hasConfig?: boolean;
};

/**
 * Países con Checkout Pro (docs oficiales Mercado Pago Developers).
 * @see https://www.mercadopago.com.br/developers/en/docs/checkout-pro/overview
 */
export const MERCADOPAGO_CHECKOUT_PRO_COUNTRIES = [
  'AR',
  'BR',
  'CL',
  'CO',
  'MX',
  'PE',
  'UY',
] as const;

export type MercadoPagoCheckoutProCountry =
  (typeof MERCADOPAGO_CHECKOUT_PRO_COUNTRIES)[number];

export const MERCADOPAGO_CHECKOUT_PRO_COUNTRY_LABELS: Record<
  MercadoPagoCheckoutProCountry,
  string
> = {
  AR: 'Argentina',
  BR: 'Brasil',
  CL: 'Chile',
  CO: 'Colombia',
  MX: 'México',
  PE: 'Perú',
  UY: 'Uruguay',
};

/** Portal Developers por país (credenciales sandbox/producción). */
export const MERCADOPAGO_DEVELOPERS_URL: Record<
  MercadoPagoCheckoutProCountry,
  string
> = {
  AR: 'https://www.mercadopago.com.ar/developers',
  BR: 'https://www.mercadopago.com.br/developers',
  CL: 'https://www.mercadopago.cl/developers',
  CO: 'https://www.mercadopago.com.co/developers',
  MX: 'https://www.mercadopago.com.mx/developers',
  PE: 'https://www.mercadopago.com.pe/developers',
  UY: 'https://www.mercadopago.com.uy/developers',
};

export function isMercadoPagoCheckoutProCountry(
  code: string | null | undefined,
): code is MercadoPagoCheckoutProCountry {
  if (!code) return false;
  return (MERCADOPAGO_CHECKOUT_PRO_COUNTRIES as readonly string[]).includes(
    code.toUpperCase(),
  );
}

export function formatMercadoPagoCountries(): string {
  return MERCADOPAGO_CHECKOUT_PRO_COUNTRIES.map(
    (c) => MERCADOPAGO_CHECKOUT_PRO_COUNTRY_LABELS[c],
  ).join(', ');
}

export const MODULE_CATALOG: ModuleDefinition[] = [
  {
    id: 'smtp',
    name: 'SMTP',
    description:
      'Envío de correos con el servidor propio de la empresa (facturas, avisos y notificaciones).',
    alwaysEnabled: true,
    billable: false,
    priceMonthly: null,
    priceCurrency: null,
    availableCountries: null,
  },
  {
    id: 'mercadopago',
    name: 'Mercado Pago',
    description:
      'Cobros a tus clientes con Checkout Pro (sandbox y producción). Disponible en Argentina, Brasil, Chile, Colombia, México, Perú y Uruguay.',
    alwaysEnabled: false,
    billable: true,
    priceMonthly: 19.9,
    priceCurrency: 'USD',
    availableCountries: [...MERCADOPAGO_CHECKOUT_PRO_COUNTRIES],
  },
  {
    id: 'mapa_red',
    name: 'Mapa de red',
    description:
      'Visualiza tu red sobre OpenStreetMap: clientes, ONUs, nodos y cobertura en un mapa interactivo para operaciones en campo.',
    alwaysEnabled: false,
    billable: true,
    priceMonthly: 24.9,
    priceCurrency: 'USD',
    availableCountries: null,
    hasConfig: false,
  },
  {
    id: 'whatsapp',
    name: 'WhatsApp',
    description:
      'Envío a clientes por WhatsApp Cloud API (oficial) o Baileys (QR, no oficial). Cupo de plataforma: 30 sesiones Baileys; Cloud API no resta cupo.',
    alwaysEnabled: false,
    billable: true,
    priceMonthly: 19.9,
    priceCurrency: 'USD',
    availableCountries: null,
  },
  {
    id: 'onu_unlock',
    name: 'Onu Unlock',
    description:
      'Modifica usuarios y configuraciones avanzadas de ONUs vía OMCI.',
    alwaysEnabled: false,
    billable: true,
    priceMonthly: 9.9,
    priceCurrency: 'USD',
    availableCountries: null,
    hasConfig: false,
  },
  {
    id: 'client_portal',
    name: 'Portal de clientes',
    description:
      'Portal self-service para que tus clientes vean servicios, consumo, señal y facturas, y paguen con tus métodos activos.',
    alwaysEnabled: false,
    billable: true,
    priceMonthly: 14.9,
    priceCurrency: 'USD',
    availableCountries: null,
    hasConfig: false,
  },
];

/** Máximo de tenants con provider Baileys a la vez en toda la plataforma. */
export const WHATSAPP_BAILEYS_MAX_SLOTS = 30;

export const MODULE_IDS = MODULE_CATALOG.map((m) => m.id);

export function getModuleDefinition(id: string): ModuleDefinition | undefined {
  return MODULE_CATALOG.find((m) => m.id === id);
}

/** Garantiza módulos alwaysEnabled y descarta IDs desconocidos. */
export function normalizeEnabledModules(
  ids: string[] | null | undefined,
): ModuleId[] {
  const known = new Set(MODULE_IDS);
  const out = new Set<ModuleId>();
  for (const m of MODULE_CATALOG) {
    if (m.alwaysEnabled) out.add(m.id);
  }
  for (const id of ids ?? []) {
    if (known.has(id as ModuleId)) out.add(id as ModuleId);
  }
  return [...out];
}

export type SmtpModuleConfig = {
  host: string;
  port: number;
  secure: boolean;
  username: string;
  /** Vacío en respuestas = no cambiar; en BD se guarda el valor real. */
  password: string;
  fromEmail: string;
  fromName: string;
};

export const EMPTY_SMTP_CONFIG: SmtpModuleConfig = {
  host: '',
  port: 587,
  secure: false,
  username: '',
  password: '',
  fromEmail: '',
  fromName: '',
};

export function isSmtpConfigured(
  cfg: Partial<SmtpModuleConfig> | null | undefined,
): boolean {
  if (!cfg) return false;
  return !!(cfg.host?.trim() && cfg.fromEmail?.trim());
}

export type MercadoPagoEnvironment = 'sandbox' | 'production';

/**
 * Credenciales Mercado Pago Checkout Pro.
 * accessToken no se expone; se usa hasAccessToken en la API.
 */
export type MercadoPagoModuleConfig = {
  environment: MercadoPagoEnvironment;
  /** Checkout Pro (preferencias + redirección al checkout de MP). */
  integration: 'checkout_pro';
  publicKey: string;
  accessToken: string;
  /** Secreto de webhooks / notificaciones (opcional). */
  webhookSecret: string;
};

export const EMPTY_MERCADOPAGO_CONFIG: MercadoPagoModuleConfig = {
  environment: 'sandbox',
  integration: 'checkout_pro',
  publicKey: '',
  accessToken: '',
  webhookSecret: '',
};

export function isMercadoPagoConfigured(
  cfg: Partial<MercadoPagoModuleConfig> | null | undefined,
): boolean {
  if (!cfg) return false;
  return !!(cfg.publicKey?.trim() && cfg.accessToken?.trim());
}

export type WhatsAppProvider = 'cloud_api' | 'baileys';
export type WhatsAppBaileysStatus =
  'disconnected' | 'qr' | 'connected' | 'connecting';

/**
 * Config módulo WhatsApp.
 * accessToken (Cloud API) no se expone; se usa hasAccessToken.
 */
export type WhatsAppModuleConfig = {
  provider: WhatsAppProvider;
  phoneNumberId: string;
  businessAccountId: string;
  accessToken: string;
  webhookVerifyToken: string;
  /** Plantilla Meta aprobada con encabezado tipo DOCUMENT. */
  templateName: string;
  templateLanguage: string;
  baileysStatus: WhatsAppBaileysStatus;
  lastDisconnectAt: string | null;
  lastDisconnectReason: string | null;
  /** Evita spam de emails por el mismo corte. */
  lastAlertAt: string | null;
};

export const EMPTY_WHATSAPP_CONFIG: WhatsAppModuleConfig = {
  provider: 'cloud_api',
  phoneNumberId: '',
  businessAccountId: '',
  accessToken: '',
  webhookVerifyToken: '',
  templateName: 'factura_pdf',
  templateLanguage: 'es',
  baileysStatus: 'disconnected',
  lastDisconnectAt: null,
  lastDisconnectReason: null,
  lastAlertAt: null,
};

export function isWhatsAppConfigured(
  cfg: Partial<WhatsAppModuleConfig> | null | undefined,
): boolean {
  if (!cfg) return false;
  if (cfg.provider === 'baileys') {
    return cfg.baileysStatus === 'connected';
  }
  // cloud_api (default)
  return !!(
    cfg.phoneNumberId?.trim() &&
    cfg.accessToken?.trim() &&
    cfg.templateName?.trim() &&
    cfg.templateLanguage?.trim()
  );
}

/** Banner / modal: unexpected drop — not intentional logout or fresh QR pair. */
export function baileysNeedsAttention(
  cfg: Partial<WhatsAppModuleConfig> | null | undefined,
): boolean {
  if (!cfg || cfg.provider !== 'baileys') return false;
  if (cfg.baileysStatus === 'connected' || cfg.baileysStatus === 'connecting') {
    return false;
  }
  const reason = (cfg.lastDisconnectReason || '').toLowerCase();
  if (
    reason.includes('manualmente') ||
    reason === 'sesión cerrada' ||
    reason.includes('cerrada manualmente')
  ) {
    return false;
  }
  if (cfg.baileysStatus === 'qr') {
    // User clicked “Conectar” → reason is just “Escanea el código QR”.
    // Banner only if WhatsApp kicked the session and we need to pair again.
    return (
      reason.includes('teléfono') ||
      reason.includes('conexión cerrada') ||
      reason.includes('code=')
    );
  }
  if (cfg.baileysStatus !== 'disconnected') return false;
  // Fresh Baileys provider with no disconnect event yet.
  if (!cfg.lastDisconnectAt || !cfg.lastDisconnectReason) return false;
  return true;
}

/** Proveedores disponibles como método de pago de plataforma. */
export const PLATFORM_PAYMENT_PROVIDERS = [
  {
    id: 'mercadopago' as const,
    name: 'Mercado Pago',
    description:
      'Cobro de suscripciones de la plataforma con Checkout Pro (sandbox y producción).',
    integration: 'checkout_pro' as const,
  },
];

export type PlatformPaymentProviderId =
  (typeof PLATFORM_PAYMENT_PROVIDERS)[number]['id'];
