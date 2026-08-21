/**
 * Planes de plataforma por cupo de ONUs («usuarios») + bloques extra de 50.
 * Facturación mensual (salvo `lifetime`, pago único).
 */

export const EXTRA_USER_BLOCK_SIZE = 50;

/** Fin de vigencia simbólico para planes lifetime (UTC). */
export const LIFETIME_PERIOD_END = new Date(Date.UTC(2099, 11, 31, 23, 59, 59));

export const USER_PLAN_TIERS = [
  { code: 'users_15', userLimit: 15, label: '15 usuarios', sortOrder: 1 },
  { code: 'users_50', userLimit: 50, label: '50 usuarios', sortOrder: 2 },
  { code: 'users_100', userLimit: 100, label: '100 usuarios', sortOrder: 3 },
  { code: 'users_200', userLimit: 200, label: '200 usuarios', sortOrder: 4 },
  { code: 'users_500', userLimit: 500, label: '500 usuarios', sortOrder: 5 },
  {
    code: 'lifetime',
    userLimit: 10_000,
    label: 'Lifetime',
    sortOrder: 6,
  },
] as const;

export type UserPlanCode = (typeof USER_PLAN_TIERS)[number]['code'];

export const USER_PLAN_CODES = USER_PLAN_TIERS.map((t) => t.code);

export function getUserPlanTier(code: string) {
  return USER_PLAN_TIERS.find((t) => t.code === code);
}

export function isUserPlanCode(code: string): code is UserPlanCode {
  return (USER_PLAN_CODES as readonly string[]).includes(code);
}

export function isLifetimePlanCode(code: string | null | undefined): boolean {
  return code === 'lifetime';
}

/** Precio USD por defecto de cada plan (mensual, o único si lifetime). */
export const DEFAULT_USER_PLAN_PRICES: Record<UserPlanCode, number> = {
  users_15: 49,
  users_50: 99,
  users_100: 179,
  users_200: 299,
  users_500: 499,
  lifetime: 4_999,
};

/** Precio mensual USD por defecto de un bloque extra de 50 usuarios. */
export const DEFAULT_EXTRA_BLOCK_PRICE_USD = 40;

/**
 * Factura de renovación: se emite N días antes del aniversario (día de contrato).
 * Vence el aniversario; gracia adicional antes del bloqueo del panel.
 */
export const SUBSCRIPTION_INVOICE_LEAD_DAYS = 10;
export const SUBSCRIPTION_GRACE_DAYS = 5;

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

export function addDaysUtc(date: Date, days: number): Date {
  const d = new Date(date.getTime());
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

/** Fin del período mensual por aniversario de contrato (+1 mes desde el inicio). */
export function anniversaryPeriodEnd(periodStart: Date): Date {
  return addMonthsUtc(periodStart, 1);
}

/** Siguiente ciclo tras el aniversario actual. */
export function nextAnniversaryPeriod(periodEnd: Date): {
  coversFrom: Date;
  coversTo: Date;
} {
  return {
    coversFrom: periodEnd,
    coversTo: addMonthsUtc(periodEnd, 1),
  };
}

/** Momento en que el cron puede emitir la factura de renovación. */
export function subscriptionInvoiceIssueAt(periodEnd: Date): Date {
  return addDaysUtc(periodEnd, -SUBSCRIPTION_INVOICE_LEAD_DAYS);
}

/** Fin de la gracia tras el vencimiento (día de contrato). */
export function subscriptionGraceEndsAt(dueAt: Date): Date {
  return addDaysUtc(dueAt, SUBSCRIPTION_GRACE_DAYS);
}

export function isSubscriptionPastGrace(
  dueAt: Date,
  now = new Date(),
): boolean {
  return now > subscriptionGraceEndsAt(dueAt);
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

/**
 * Flags de acceso a partir de un cobro de renovación pending.
 * - overdue: dueAt <= now (modal nag)
 * - blocked: past grace (panel lock)
 */
export function subscriptionAccessFromDueAt(
  dueAt: Date | null | undefined,
  now = new Date(),
): {
  invoiceOverdue: boolean;
  accessBlocked: boolean;
  graceEndsAt: Date | null;
  daysUntilDue: number | null;
  daysOverdue: number | null;
} {
  if (!dueAt) {
    return {
      invoiceOverdue: false,
      accessBlocked: false,
      graceEndsAt: null,
      daysUntilDue: null,
      daysOverdue: null,
    };
  }
  const graceEndsAt = subscriptionGraceEndsAt(dueAt);
  const overdue = now.getTime() >= dueAt.getTime();
  const blocked = isSubscriptionPastGrace(dueAt, now);
  return {
    invoiceOverdue: overdue,
    accessBlocked: blocked,
    graceEndsAt,
    daysUntilDue: overdue ? 0 : daysBetweenUtc(now, dueAt),
    daysOverdue: overdue ? daysBetweenUtc(dueAt, now) : null,
  };
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
