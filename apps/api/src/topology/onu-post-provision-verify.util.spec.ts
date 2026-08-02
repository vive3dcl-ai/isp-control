import {
  decideVerifyOutcome,
  isVerifyWindowExpired,
  shouldCloseVerifyWindow,
  shouldRunVerifyTick,
  summarizeVerifyDetail,
  VERIFY_HEAL_MAX_ATTEMPTS,
  VERIFY_INTERVAL_MS,
  VERIFY_WINDOW_MS,
} from './onu-post-provision-verify.util';

describe('ventanas del chequeo', () => {
  const t0 = new Date('2026-08-02T12:00:00Z');

  it('corre el primer tick sin checkedAt', () => {
    expect(
      shouldRunVerifyTick({ status: 'test', checkedAt: null, now: t0 }),
    ).toBe(true);
  });

  it('espera 3 minutos entre ticks', () => {
    expect(
      shouldRunVerifyTick({
        status: 'test',
        checkedAt: t0,
        now: new Date(t0.getTime() + VERIFY_INTERVAL_MS - 1),
      }),
    ).toBe(false);
    expect(
      shouldRunVerifyTick({
        status: 'test',
        checkedAt: t0,
        now: new Date(t0.getTime() + VERIFY_INTERVAL_MS),
      }),
    ).toBe(true);
  });

  it('no toca ONUs que no están en test', () => {
    expect(
      shouldRunVerifyTick({ status: 'ok', checkedAt: null, now: t0 }),
    ).toBe(false);
    expect(
      shouldRunVerifyTick({ status: 'fail', checkedAt: null, now: t0 }),
    ).toBe(false);
    expect(
      shouldRunVerifyTick({ status: 'idle', checkedAt: null, now: t0 }),
    ).toBe(false);
  });

  it('marca la ventana caducada a los 15 minutos', () => {
    expect(
      isVerifyWindowExpired({
        startedAt: t0,
        now: new Date(t0.getTime() + VERIFY_WINDOW_MS - 1),
      }),
    ).toBe(false);
    expect(
      isVerifyWindowExpired({
        startedAt: t0,
        now: new Date(t0.getTime() + VERIFY_WINDOW_MS),
      }),
    ).toBe(true);
  });

  it('no cierra en fail en el mismo tick que aplicó una curación', () => {
    expect(
      shouldCloseVerifyWindow({
        windowExpired: true,
        healingApplied: true,
      }),
    ).toBe(false);
    expect(
      shouldCloseVerifyWindow({
        windowExpired: true,
        healingApplied: false,
      }),
    ).toBe(true);
  });
});

describe('criterio de pase/fallo', () => {
  const good = {
    arp: { ok: true, message: 'resuelta' },
    connreq: { ok: true, message: 'acs' },
    wan: { ok: true, message: 'coincide' },
    traffic: { ok: true, message: '3 conexiones' },
  };

  it('pasa cuando todo cuadra', () => {
    expect(decideVerifyOutcome({ detail: good, windowExpired: false })).toBe(
      'ok',
    );
  });

  it('pasa al cerrar la ventana si lo esencial está bien aunque no haya tráfico', () => {
    expect(
      decideVerifyOutcome({
        detail: { ...good, traffic: { ok: false, message: 'sin tráfico' } },
        windowExpired: true,
      }),
    ).toBe('ok');
  });

  it('sigue en test si falta algo y queda tiempo', () => {
    expect(
      decideVerifyOutcome({
        detail: {
          arp: { ok: false, message: 'ausente' },
          connreq: { ok: true, message: 'acs' },
          wan: { ok: true, message: 'coincide' },
          traffic: { ok: false, message: 'sin tráfico' },
        },
        windowExpired: false,
      }),
    ).toBe('test');
  });

  it('falla al cerrar la ventana si falta lo esencial', () => {
    expect(
      decideVerifyOutcome({
        detail: {
          arp: { ok: false, message: 'ausente' },
          connreq: { ok: true, message: 'acs' },
          wan: { ok: true, message: 'coincide' },
        },
        windowExpired: true,
      }),
    ).toBe('fail');
  });

  it('falla de inmediato ante error irrecuperable', () => {
    expect(
      decideVerifyOutcome({
        detail: good,
        windowExpired: false,
        irrecoverable: true,
      }),
    ).toBe('fail');
  });

  it('expone el tope de curaciones', () => {
    expect(VERIFY_HEAL_MAX_ATTEMPTS).toBe(3);
  });
});

describe('resumen', () => {
  it('arma un texto legible para el tooltip', () => {
    expect(
      summarizeVerifyDetail({
        arp: { ok: true, message: 'resuelta' },
        wan: { ok: false, message: 'vlan 80' },
        healed: ['credenciales'],
      }),
    ).toContain('arp: ok');
  });
});
