export type UserPlanCode =
  | 'users_15'
  | 'users_50'
  | 'users_100'
  | 'users_200'
  | 'users_500'

export type SystemPlan = {
  id: string
  code: UserPlanCode
  /** Alias histórico */
  cycle?: UserPlanCode
  userLimit: number
  months: number
  label: string
  priceUsd: number
  /** Si true, landing y cobro tratan el plan como gratis. */
  isFree?: boolean
  enabled: boolean
  sortOrder?: number
}

export type SystemPlansAdmin = {
  plans: SystemPlan[]
  extraBlockSize: number
  extraBlockPriceUsd: number
}

export type PlatformChargeRow = {
  id: string
  kind: string
  description: string
  amountUsd: number
  status: string
  coversFrom: string | null
  coversTo: string | null
  dueAt: string | null
  paidAt: string | null
  createdAt: string
  canPay: boolean
}

export type TenantSubscription = {
  planCode: UserPlanCode | null
  billingCycle: UserPlanCode | null
  status: string
  periodStart: string | null
  periodEnd: string | null
  periodPriceUsd: number | null
  daysUntilEnd?: number | null
  plans: SystemPlan[]
  extraBlocks: number
  extraBlockSize: number
  extraBlockPriceUsd: number
  onuUsed: number
  onuLimit: number | null
  planMonthlyUsd: number | null
  blocksMonthlyUsd: number
  baseMonthlyUsd: number | null
  recurringModules: Array<{
    moduleId: string
    monthlyPriceUsd: number
    name: string
  }>
  modulesMonthlyUsd: number
  nextCycleEstimateUsd: number | null
  pendingChargeId?: string | null
  charges?: PlatformChargeRow[]
}

export type PlanChangeQuote = {
  code: UserPlanCode
  label: string
  userLimit: number
  extraBlocks: number
  onuUsed: number
  onuLimit: number
  newMonthlyUsd: number
  creditUsd: number
  chargeUsd: number
  periodStart: string
  periodEnd: string
  note?: string
}

export type ExtraBlocksQuote = {
  currentBlocks: number
  blocks: number
  delta: number
  extraBlockSize: number
  extraBlockPriceUsd: number
  onuUsed: number
  onuLimit: number
  chargeUsd: number
  creditUsd: number
  newMonthlyUsd: number
  periodEnd: string
  note?: string
}

export type ModuleContractQuote = {
  mode: 'one_time' | 'recurring'
  moduleId: string
  name: string
  monthlyPriceUsd: number
  chargeUsd: number
  chargeLabel: string
  startsAt: string
  expiresAt: string | null
  note: string
}

export type ModuleContract = {
  id: string
  moduleId: string
  mode: 'one_time' | 'recurring'
  status: string
  monthlyPriceUsd: number
  chargedUsd: number
  startedAt: string
  expiresAt: string | null
}

export function formatUsd(amount: number | null | undefined): string {
  if (amount == null || !Number.isFinite(amount)) return '—'
  return new Intl.NumberFormat('es', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(amount)
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString('es', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  } catch {
    return iso
  }
}

export function chargeKindLabel(kind: string): string {
  switch (kind) {
    case 'renewal':
      return 'Renovación'
    case 'initial':
      return 'Alta'
    case 'plan_change':
      return 'Cambio de plan'
    case 'service':
      return 'Factura de servicio'
    case 'extra_blocks_add':
      return 'Usuarios extra (+)'
    case 'extra_blocks_remove':
      return 'Usuarios extra (−)'
    case 'module_one_time':
      return 'Módulo (pago único)'
    case 'module_prorate':
      return 'Módulo (prorrateo)'
    default:
      return kind
  }
}

export function chargeStatusLabel(status: string): string {
  switch (status) {
    case 'pending':
      return 'Pendiente'
    case 'paid':
    case 'recorded':
      return 'Pagado'
    case 'failed':
      return 'Fallido'
    case 'cancelled':
      return 'Cancelado'
    default:
      return status
  }
}
