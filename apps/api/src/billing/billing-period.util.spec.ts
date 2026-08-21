import {
  computeFirstPeriod,
  computeServiceFirstPeriod,
  dateOnDayOfMonth,
  effectiveBillingRegime,
  nextBillingOnCycleDay,
  rollPeriod,
  rollServicePeriod,
} from './billing-period.util';

describe('effectiveBillingRegime', () => {
  it('por defecto es mes calendario', () => {
    expect(effectiveBillingRegime(undefined)).toBe('calendar_month');
    expect(effectiveBillingRegime('calendar_month')).toBe('calendar_month');
  });

  it('acepta desde instalación', () => {
    expect(effectiveBillingRegime('from_install')).toBe('from_install');
  });
});

describe('computeFirstPeriod', () => {
  it('mes calendario prorratea hasta fin de mes', () => {
    expect(computeFirstPeriod('2026-08-19', 'calendar_month')).toEqual({
      periodStart: '2026-08-19',
      periodEnd: '2026-08-31',
      nextBillingDate: '2026-09-01',
    });
  });

  it('mes calendario respeta día de ciclo', () => {
    expect(computeFirstPeriod('2026-08-19', 'calendar_month', 5)).toEqual({
      periodStart: '2026-08-19',
      periodEnd: '2026-08-31',
      nextBillingDate: '2026-09-05',
    });
  });

  it('desde instalación usa un mes completo desde el alta', () => {
    expect(computeFirstPeriod('2026-08-19', 'from_install')).toEqual({
      periodStart: '2026-08-19',
      periodEnd: '2026-09-18',
      nextBillingDate: '2026-09-19',
    });
  });
});

describe('computeServiceFirstPeriod', () => {
  it('desde instalación con prorrateo alinea al calendario día 1', () => {
    expect(
      computeServiceFirstPeriod('2026-08-19', 'from_install', true, 15),
    ).toEqual({
      periodStart: '2026-08-19',
      periodEnd: '2026-08-31',
      nextBillingDate: '2026-09-01',
    });
  });

  it('desde instalación sin prorrateo conserva aniversario', () => {
    expect(
      computeServiceFirstPeriod('2026-08-19', 'from_install', false, 15),
    ).toEqual({
      periodStart: '2026-08-19',
      periodEnd: '2026-09-18',
      nextBillingDate: '2026-09-19',
    });
  });
});

describe('rollPeriod', () => {
  it('calendario avanza al mes civil siguiente', () => {
    expect(rollPeriod('2026-08-31', 'calendar_month')).toEqual({
      periodStart: '2026-09-01',
      periodEnd: '2026-09-30',
      nextBillingDate: '2026-10-01',
    });
  });

  it('desde instalación conserva el aniversario', () => {
    expect(rollPeriod('2026-09-18', 'from_install')).toEqual({
      periodStart: '2026-09-19',
      periodEnd: '2026-10-18',
      nextBillingDate: '2026-10-19',
    });
  });
});

describe('rollServicePeriod', () => {
  it('prorrateo desde instalación pasa a mes calendario', () => {
    expect(
      rollServicePeriod('2026-08-31', 'from_install', true, 15),
    ).toEqual({
      periodStart: '2026-09-01',
      periodEnd: '2026-09-30',
      nextBillingDate: '2026-10-01',
    });
  });
});

describe('dateOnDayOfMonth', () => {
  it('clampa el 31 en febrero', () => {
    expect(dateOnDayOfMonth('2026-02-01', 31)).toBe('2026-02-28');
  });

  it('usa el día pedido', () => {
    expect(dateOnDayOfMonth('2026-08-01', 15)).toBe('2026-08-15');
  });
});

describe('nextBillingOnCycleDay', () => {
  it('emite el día del mes siguiente al cierre', () => {
    expect(nextBillingOnCycleDay('2026-08-31', 5)).toBe('2026-09-05');
  });
});
