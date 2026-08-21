import {
  EXTRA_USER_BLOCK_SIZE,
  SUBSCRIPTION_GRACE_DAYS,
  SUBSCRIPTION_INVOICE_LEAD_DAYS,
  addDaysUtc,
  anniversaryPeriodEnd,
  daysInUtcMonth,
  isSubscriptionPastGrace,
  monthlyRecurringUsd,
  nextAnniversaryPeriod,
  onuCapacity,
  prorateUntilMonthEnd,
  roundMoney,
  subscriptionAccessFromDueAt,
  subscriptionGraceEndsAt,
  subscriptionInvoiceIssueAt,
} from './billing-cycles';

describe('platform user-plan billing', () => {
  it('computes capacity with extra blocks of 50', () => {
    expect(onuCapacity(15, 0)).toBe(15);
    expect(onuCapacity(50, 2)).toBe(50 + 2 * EXTRA_USER_BLOCK_SIZE);
  });

  it('sums plan + blocks into monthly recurring', () => {
    expect(monthlyRecurringUsd(99, 2, 40)).toBe(179);
  });

  it('prorates to calendar month end including today', () => {
    // 2026-08-15 → 17 days left in Aug (15..31)
    const now = new Date(Date.UTC(2026, 7, 15, 12, 0, 0));
    expect(daysInUtcMonth(now)).toBe(31);
    expect(prorateUntilMonthEnd(310, now)).toBe(170);
  });

  it('rounds money to cents', () => {
    expect(roundMoney(10.006)).toBe(10.01);
  });
});

describe('subscription anniversary lead/grace', () => {
  const anniversary = new Date(Date.UTC(2026, 8, 10, 12, 0, 0)); // Sep 10

  it('uses fixed lead and grace constants', () => {
    expect(SUBSCRIPTION_INVOICE_LEAD_DAYS).toBe(10);
    expect(SUBSCRIPTION_GRACE_DAYS).toBe(5);
  });

  it('issues invoice 10 days before anniversary', () => {
    const issueAt = subscriptionInvoiceIssueAt(anniversary);
    expect(issueAt.toISOString().slice(0, 10)).toBe('2026-08-31');
  });

  it('grace ends 5 days after due (anniversary)', () => {
    const graceEnds = subscriptionGraceEndsAt(anniversary);
    expect(graceEnds.toISOString().slice(0, 10)).toBe('2026-09-15');
    expect(isSubscriptionPastGrace(anniversary, anniversary)).toBe(false);
    expect(
      isSubscriptionPastGrace(anniversary, addDaysUtc(anniversary, 5)),
    ).toBe(false);
    expect(
      isSubscriptionPastGrace(anniversary, addDaysUtc(anniversary, 6)),
    ).toBe(true);
  });

  it('builds next anniversary period from period end', () => {
    const next = nextAnniversaryPeriod(anniversary);
    expect(next.coversFrom.toISOString()).toBe(anniversary.toISOString());
    expect(next.coversTo.toISOString().slice(0, 10)).toBe('2026-10-10');
  });

  it('anniversaryPeriodEnd is +1 month from start', () => {
    const start = new Date(Date.UTC(2026, 7, 20, 15, 0, 0));
    expect(anniversaryPeriodEnd(start).toISOString().slice(0, 10)).toBe(
      '2026-09-20',
    );
  });

  it('access flags: nag on due, block after grace', () => {
    const dueAt = anniversary;
    const beforeDue = addDaysUtc(dueAt, -1);
    const onDue = dueAt;
    const inGrace = addDaysUtc(dueAt, 2);
    const pastGrace = addDaysUtc(dueAt, 6);

    expect(subscriptionAccessFromDueAt(dueAt, beforeDue)).toMatchObject({
      invoiceOverdue: false,
      accessBlocked: false,
    });
    expect(subscriptionAccessFromDueAt(dueAt, onDue)).toMatchObject({
      invoiceOverdue: true,
      accessBlocked: false,
    });
    expect(subscriptionAccessFromDueAt(dueAt, inGrace)).toMatchObject({
      invoiceOverdue: true,
      accessBlocked: false,
    });
    expect(subscriptionAccessFromDueAt(dueAt, pastGrace)).toMatchObject({
      invoiceOverdue: true,
      accessBlocked: true,
    });
  });
});
