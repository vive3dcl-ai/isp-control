/** Minimal 5-field cron matcher (minute hour day-of-month month weekday). */
export function cronMatches(
  expression: string,
  date: Date,
  timeZone?: string,
): boolean {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) return false;

  const partsInTz = getZonedParts(date, timeZone);
  const [min, hour, dom, mon, dow] = parts;
  return (
    fieldMatches(min, partsInTz.minute) &&
    fieldMatches(hour, partsInTz.hour) &&
    fieldMatches(dom, partsInTz.day) &&
    fieldMatches(mon, partsInTz.month) &&
    fieldMatches(dow, partsInTz.weekday)
  );
}

function getZonedParts(date: Date, timeZone?: string) {
  const tz = timeZone || 'UTC';
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      minute: 'numeric',
      hour: 'numeric',
      hourCycle: 'h23',
      day: 'numeric',
      month: 'numeric',
      weekday: 'short',
    });
    const bag: Record<string, string> = {};
    for (const p of fmt.formatToParts(date)) {
      if (p.type !== 'literal') bag[p.type] = p.value;
    }
    const weekdayMap: Record<string, number> = {
      Sun: 0,
      Mon: 1,
      Tue: 2,
      Wed: 3,
      Thu: 4,
      Fri: 5,
      Sat: 6,
    };
    return {
      minute: Number(bag.minute),
      hour: Number(bag.hour),
      day: Number(bag.day),
      month: Number(bag.month),
      weekday: weekdayMap[bag.weekday] ?? date.getUTCDay(),
    };
  } catch {
    return {
      minute: date.getUTCMinutes(),
      hour: date.getUTCHours(),
      day: date.getUTCDate(),
      month: date.getUTCMonth() + 1,
      weekday: date.getUTCDay(),
    };
  }
}

function fieldMatches(field: string, value: number): boolean {
  if (field === '*') return true;
  for (const piece of field.split(',')) {
    if (piece.includes('/')) {
      const [range, stepStr] = piece.split('/');
      const step = Number(stepStr);
      if (!Number.isFinite(step) || step < 1) continue;
      const start = range === '*' ? 0 : Number(range);
      if (!Number.isFinite(start)) continue;
      if (value >= start && (value - start) % step === 0) return true;
      continue;
    }
    if (piece.includes('-')) {
      const [a, b] = piece.split('-').map(Number);
      if (Number.isFinite(a) && Number.isFinite(b) && value >= a && value <= b) {
        return true;
      }
      continue;
    }
    if (Number(piece) === value) return true;
  }
  return false;
}

/** Same calendar minute as last run (avoid double-fire within the minute). */
export function alreadyRanThisMinute(
  lastRun: Date | null | undefined,
  now: Date,
): boolean {
  if (!lastRun) return false;
  return (
    lastRun.getUTCFullYear() === now.getUTCFullYear() &&
    lastRun.getUTCMonth() === now.getUTCMonth() &&
    lastRun.getUTCDate() === now.getUTCDate() &&
    lastRun.getUTCHours() === now.getUTCHours() &&
    lastRun.getUTCMinutes() === now.getUTCMinutes()
  );
}
