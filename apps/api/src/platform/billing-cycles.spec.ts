import {
  EXTRA_USER_BLOCK_SIZE,
  daysInUtcMonth,
  monthlyRecurringUsd,
  onuCapacity,
  prorateUntilMonthEnd,
  roundMoney,
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
