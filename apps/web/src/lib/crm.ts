export type ClientServiceStatus =
  | 'prepared'
  | 'active'
  | 'suspended'
  | 'ended'

export interface Client {
  id: string
  firstName: string
  lastName: string
  companyName: string
  documentType: string
  documentNumber: string
  isCompany: boolean
  companyTaxId: string
  isLead: boolean
  email: string
  phone: string
  street: string
  city: string
  zipCode: string
  latitude: number | null
  longitude: number | null
  note: string
  isActive: boolean
  zoneId: string | null
  /** Interno: cliente de migración (sin badge en UI). */
  migratedAt: string | null
  createdAt: string
  updatedAt: string
}

export type PlanBillingAnchor = 'installation' | 'calendar_month'
export type PlanBillingCycleDay = 'first' | 'last'
export type PlanServiceType = 'internet' | 'tv' | 'telephony'

export interface ServicePlanSpeedProfile {
  id: string
  name: string
  downloadMbps: number
  uploadMbps: number
  isActive: boolean
}

export interface ServicePlan {
  id: string
  name: string
  price: string
  installationFee: string
  installationFeeOnFirstInvoice: boolean
  invoiceLabel: string
  downloadSpeed: number
  uploadSpeed: number
  speedProfileId: string | null
  speedProfile?: ServicePlanSpeedProfile | null
  invoicingPeriod: number
  invoicingPeriodType: string
  billingAnchor: PlanBillingAnchor
  billingCycleDay: PlanBillingCycleDay
  serviceTypes: PlanServiceType[]
  type: string
  decoCount: number
  additionalDecoPrice: string
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export interface ClientService {
  id: string
  clientId: string
  servicePlanId: string
  servicePlan?: ServicePlan
  name: string
  price: string
  activeFrom: string | null
  activeTo: string | null
  status: ClientServiceStatus
  street: string
  city: string
  zipCode: string
  note: string
  onuId: string | null
  latitude: number | null
  longitude: number | null
  /** Interno: servicio de migración (sin badge en UI). */
  migratedAt: string | null
  /** One-shot sync de nombre ONU ya hecho. */
  onuNameSyncedAt: string | null
  createdAt: string
  updatedAt: string
}

export type ClientDetail = Client & { services: ClientService[] }

export function clientDisplayName(
  c: Pick<Client, 'firstName' | 'lastName' | 'companyName' | 'isCompany'>,
) {
  if (c.isCompany && c.companyName?.trim()) return c.companyName.trim()
  const person = [c.firstName, c.lastName].filter(Boolean).join(' ').trim()
  if (person && c.companyName?.trim()) {
    return `${person} (${c.companyName.trim()})`
  }
  return person || c.companyName?.trim() || 'Sin nombre'
}

export const CRM_WRITE_ROLES = ['owner', 'admin', 'administrativo'] as const

/** Roles that can run field install (/movil Instalar). */
export const FIELD_INSTALL_ROLES = [
  'owner',
  'admin',
  'administrativo',
  'tecnico',
] as const

export function canWriteCrm(tenantRole?: string | null) {
  return !!tenantRole && (CRM_WRITE_ROLES as readonly string[]).includes(tenantRole)
}

export function canInstallField(tenantRole?: string | null) {
  return (
    !!tenantRole &&
    (FIELD_INSTALL_ROLES as readonly string[]).includes(tenantRole)
  )
}

export const serviceStatusLabel: Record<ClientServiceStatus, string> = {
  prepared: 'Preparando',
  active: 'Activo',
  suspended: 'Suspendido',
  ended: 'Finalizado',
}
