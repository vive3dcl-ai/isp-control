/**
 * Planes de plataforma por cupo de ONUs («usuarios») + bloques extra de 50.
 * Facturación siempre mensual, alineada a mes calendario (UTC).
 */

export const EXTRA_USER_BLOCK_SIZE = 50;

export const USER_PLAN_TIERS = [
  { code: 'users_15', userLimit: 15, label: '15 usuarios', sortOrder: 1 },
  { code: 'users_50', userLimit: 50, label: '50 usuarios', sortOrder: 2 },
  { code: 'users_100', userLimit: 100, label: '100 usuarios', sortOrder: 3 },
  { code: 'users_200', userLimit: 200, label: '200 usuarios', sortOrder: 4 },
  { code: 'users_500', userLimit: 500, label: '500 usuarios', sortOrder: 5 },
] as const;

export type UserPlanCode = (typeof USER_PLAN_TIERS)[number]['code'];

export const USER_PLAN_CODES = USER_PLAN_TIERS.map((t) => t.code);

export function getUserPlanTier(code: string) {
  return USER_PLAN_TIERS.find((t) => t.code === code);
}

export function isUserPlanCode(code: string): code is UserPlanCode {
  return (USER_PLAN_CODES as readonly string[]).includes(code);
}

/** Precio mensual USD por defecto de cada plan. */
export const DEFAULT_USER_PLAN_PRICES: Record<UserPlanCode, number> = {
  users_15: 49,
  users_50: 99,
  users_100: 179,
  users_200: 299,
  users_500: 499,
};

/** Precio mensual USD por defecto de un bloque extra de 50 usuarios. */
export const DEFAULT_EXTRA_BLOCK_PRICE_USD = 40;

export type ModuleContractMode = 'one_time' | 'recurring';
export type ModuleContractStatus = 'active' | 'expired' | 'cancelled';

export function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

export function daysBetweenUtc(from: Date, to: Date): number {
  const a = Date.UTC(
    from.getUTCFullYear(),
    from.getUTCMonth(),
    from.getUTCDate(),
  );
  const b = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

export function startOfUtcDay(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

/** Primer instante del mes calendario siguiente (UTC). */
export function startOfNextUtcMonth(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1),
  );
}

/** Fin del mes calendario actual (último instante del último día, UTC). */
export function endOfUtcMonth(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1) - 1,
  );
}

export function daysInUtcMonth(date: Date): number {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0),
  ).getUTCDate();
}

/**
 * Prorrateo lineal del precio mensual hasta el fin del mes calendario (UTC).
 * Incluye el día actual.
 */
export function prorateUntilMonthEnd(
  monthlyUsd: number,
  now = new Date(),
): number {
  const daysInMonth = daysInUtcMonth(now);
  const day = now.getUTCDate();
  const remaining = Math.max(1, daysInMonth - day + 1);
  return roundMoney((monthlyUsd * remaining) / daysInMonth);
}

/** Valor residual lineal del período actual. */
export function unusedPeriodCredit(
  paidForPeriodUsd: number,
  periodStart: Date,
  periodEnd: Date,
  now = new Date(),
): number {
  if (now >= periodEnd) return 0;
  if (now <= periodStart) return paidForPeriodUsd;
  const total = daysBetweenUtc(periodStart, periodEnd);
  if (total <= 0) return 0;
  const left = daysBetweenUtc(now, periodEnd);
  return roundMoney((paidForPeriodUsd * left) / total);
}

/**
 * Prorrateo lineal sobre un período arbitrario (p. ej. ciclo del tenant).
 * Usado por módulos recurrentes.
 */
export function prorateToPeriodEnd(
  fullCycleUsd: number,
  periodStart: Date,
  periodEnd: Date,
  now = new Date(),
): number {
  return unusedPeriodCredit(fullCycleUsd, periodStart, periodEnd, now);
}

export function addMonthsUtc(date: Date, months: number): Date {
  const d = new Date(date.getTime());
  const day = d.getUTCDate();
  d.setUTCMonth(d.getUTCMonth() + months);
  if (d.getUTCDate() < day) {
    d.setUTCDate(0);
  }
  return d;
}

export function onuCapacity(userLimit: number, extraBlocks: number): number {
  return userLimit + Math.max(0, extraBlocks) * EXTRA_USER_BLOCK_SIZE;
}

export function monthlyRecurringUsd(
  planPriceUsd: number,
  extraBlocks: number,
  blockPriceUsd: number,
): number {
  return roundMoney(
    planPriceUsd + Math.max(0, extraBlocks) * blockPriceUsd,
  );
}

/* —— Compat: ciclos antiguos (solo módulos / migración) —— */

/** @deprecated Preferir USER_PLAN_TIERS. */
export const BILLING_CYCLES = [
  { id: 'monthly', label: 'Mensual', months: 1 },
  { id: 'quarterly', label: 'Trimestral', months: 3 },
  { id: 'semiannual', label: 'Semestral', months: 6 },
  { id: 'annual', label: 'Anual', months: 12 },
] as const;

/** @deprecated */
export type BillingCycleId = (typeof BILLING_CYCLES)[number]['id'];

/** @deprecated */
export const BILLING_CYCLE_IDS = BILLING_CYCLES.map((c) => c.id);

/** @deprecated */
export function getBillingCycle(id: string) {
  return BILLING_CYCLES.find((c) => c.id === id);
}

/** @deprecated */
export function isBillingCycleId(id: string): id is BillingCycleId {
  return (BILLING_CYCLE_IDS as readonly string[]).includes(id);
}

/** @deprecated */
export const DEFAULT_SYSTEM_PLAN_PRICES: Record<BillingCycleId, number> = {
  monthly: 49,
  quarterly: 139,
  semiannual: 259,
  annual: 479,
};
