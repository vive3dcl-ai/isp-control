export type BillingRegime = 'calendar_month' | 'from_install';

export function parseIsoDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1));
}

export function formatIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d.getTime());
  x.setUTCDate(x.getUTCDate() + n);
  return x;
}

export function daysInMonthUtc(d: Date): number {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
}

export function endOfMonthUtc(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
}

/** Keep the same day-of-month when adding months; clamp to month length (31 → 28). */
export function addMonthsClamp(d: Date, months: number): Date {
  const day = d.getUTCDate();
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1));
  x.setUTCDate(Math.min(day, daysInMonthUtc(x)));
  return x;
}

export function dateOnDayOfMonth(baseIso: string, day: number): string {
  const d = parseIsoDate(baseIso);
  const clamped = Math.min(Math.max(1, Math.floor(day)), daysInMonthUtc(d));
  d.setUTCDate(clamped);
  return formatIsoDate(d);
}

export function daysInclusive(startIso: string, endIso: string): number {
  const a = parseIsoDate(startIso).getTime();
  const b = parseIsoDate(endIso).getTime();
  return Math.floor((b - a) / 86_400_000) + 1;
}

export function effectiveBillingRegime(
  company: string | null | undefined,
): BillingRegime {
  return company === 'from_install' ? 'from_install' : 'calendar_month';
}

export function computeFirstPeriod(
  activeFrom: string,
  regime: BillingRegime,
): { periodStart: string; periodEnd: string; nextBillingDate: string } {
  const start = parseIsoDate(activeFrom);
  if (regime === 'calendar_month') {
    const end = endOfMonthUtc(start);
    return {
      periodStart: activeFrom,
      periodEnd: formatIsoDate(end),
      nextBillingDate: formatIsoDate(addDays(end, 1)),
    };
  }
  const end = addMonthsClamp(start, 1);
  end.setUTCDate(end.getUTCDate() - 1);
  return {
    periodStart: activeFrom,
    periodEnd: formatIsoDate(end),
    nextBillingDate: formatIsoDate(addDays(end, 1)),
  };
}

export function rollPeriod(
  periodEndIso: string,
  regime: BillingRegime,
): { periodStart: string; periodEnd: string; nextBillingDate: string } {
  const nextStart = addDays(parseIsoDate(periodEndIso), 1);
  let periodEnd: Date;
  if (regime === 'calendar_month') {
    periodEnd = endOfMonthUtc(nextStart);
  } else {
    periodEnd = addMonthsClamp(nextStart, 1);
    periodEnd.setUTCDate(periodEnd.getUTCDate() - 1);
  }
  return {
    periodStart: formatIsoDate(nextStart),
    periodEnd: formatIsoDate(periodEnd),
    nextBillingDate: formatIsoDate(addDays(periodEnd, 1)),
  };
}
