/**
 * Ciclos de facturación prepago de la plataforma (ISP Control → empresas).
 */
export const BILLING_CYCLES = [
  { id: 'monthly', label: 'Mensual', months: 1 },
  { id: 'quarterly', label: 'Trimestral', months: 3 },
  { id: 'semiannual', label: 'Semestral', months: 6 },
  { id: 'annual', label: 'Anual', months: 12 },
] as const;

export type BillingCycleId = (typeof BILLING_CYCLES)[number]['id'];

export const BILLING_CYCLE_IDS = BILLING_CYCLES.map((c) => c.id);

export function getBillingCycle(id: string) {
  return BILLING_CYCLES.find((c) => c.id === id);
}

export function isBillingCycleId(id: string): id is BillingCycleId {
  return (BILLING_CYCLE_IDS as readonly string[]).includes(id);
}

/** Precios por defecto del valor del sistema (USD / ciclo). */
export const DEFAULT_SYSTEM_PLAN_PRICES: Record<BillingCycleId, number> = {
  monthly: 49,
  quarterly: 139,
  semiannual: 259,
  annual: 479,
};

export type ModuleContractMode = 'one_time' | 'recurring';

export type ModuleContractStatus = 'active' | 'expired' | 'cancelled';

/**
 * Prorrateo lineal del costo de un módulo sobre el ciclo prepago del tenant.
 * `fullCycleUsd` = precio mensual × meses del plan.
 * Cobra solo la fracción restante hasta `periodEnd`.
 */
export function prorateToPeriodEnd(
  fullCycleUsd: number,
  periodStart: Date,
  periodEnd: Date,
  now = new Date(),
): number {
  return unusedPeriodCredit(fullCycleUsd, periodStart, periodEnd, now);
}

/**
 * @deprecated Preferir prorateToPeriodEnd alineado al ciclo del tenant.
 * Prorrateo lineal del precio mensual hasta el fin del mes calendario (UTC).
 */
export function prorateUntilMonthEnd(
  monthlyUsd: number,
  now = new Date(),
): number {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const day = now.getUTCDate();
  const remaining = Math.max(1, daysInMonth - day + 1);
  return roundMoney((monthlyUsd * remaining) / daysInMonth);
}

export function addMonthsUtc(date: Date, months: number): Date {
  const d = new Date(date.getTime());
  const day = d.getUTCDate();
  d.setUTCMonth(d.getUTCMonth() + months);
  // Evita overflow (31 ene → mar)
  if (d.getUTCDate() < day) {
    d.setUTCDate(0);
  }
  return d;
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

export function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Valor residual lineal del período prepago actual. */
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
