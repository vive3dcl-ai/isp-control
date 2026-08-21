import {
  decideVerifyOutcome,
  isVerifyWindowExpired,
  mapWithConcurrency,
  RESYNC_WAKE_DELAY_MS,
  RESYNC_WAKE_MAX_ATTEMPTS,
  shouldCloseVerifyWindow,
  shouldRunVerifyTick,
  summarizeVerifyDetail,
  summarizeVerifyFailures,
  arpSoftenedByTraffic,
  assessInternetEvidence,
  countPublicDsts,
  isPublicIpv4,
  VERIFY_HEAL_MAX_ATTEMPTS,
  VERIFY_INTERVAL_MS,
  VERIFY_MAX_CONCURRENCY_PER_TENANT,
  VERIFY_MAX_GLOBAL_CONCURRENCY,
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
    dns: { ok: true, message: '8.8.8.8,8.8.4.4' },
    uplinkVlan: { ok: true, message: 'VLAN 701 en uplink' },
    traffic: { ok: true, message: '3 conexiones' },
  };

  it('pasa cuando todo cuadra', () => {
    expect(decideVerifyOutcome({ detail: good, windowExpired: false })).toBe(
      'ok',
    );
  });

  it('ARP incompleta no tumba si hay conexiones en el gateway', () => {
    expect(
      arpSoftenedByTraffic('ARP incompleta', {
        ok: true,
        message: '4 conexiones en Router Core 4011',
        meta: { connCount: 4 },
      }),
    ).toBe(true);
    expect(
      arpSoftenedByTraffic('ARP incompleta', {
        ok: false,
        message: 'sin conexiones',
      }),
    ).toBe(false);
  });

  it('summarizeVerifyFailures solo lista required fallidos', () => {
    expect(
      summarizeVerifyFailures(
        {
          arp: { ok: false, message: 'ARP incompleta' },
          wan: { ok: true, message: 'ok' },
          connreq: { ok: false, message: '401' },
          traffic: { ok: true, message: '4 conexiones' },
        },
        {
          checks: {
            arp: 'required',
            connreq: 'optional',
            wan: 'required',
            dns: 'required',
            route: 'skip',
            uplinkVlan: 'required',
            traffic: 'optional',
          },
        },
      ),
    ).toBe('arp: ARP incompleta');
  });

  it('pasa al cerrar la ventana si lo esencial está bien aunque no haya tráfico', () => {
    expect(
      decideVerifyOutcome({
        detail: { ...good, traffic: { ok: false, message: 'sin tráfico' } },
        windowExpired: true,
      }),
    ).toBe('ok');
  });

  it('TR-098: connreq optional no tumba ok si ARP+WAN están bien', () => {
    expect(
      decideVerifyOutcome({
        detail: {
          ...good,
          connreq: { ok: false, message: '401 sin reto digest' },
        },
        windowExpired: true,
        checks: {
          arp: 'required',
          connreq: 'optional',
          wan: 'required',
          dns: 'required',
          route: 'skip',
          uplinkVlan: 'required',
          traffic: 'optional',
        },
      }),
    ).toBe('ok');
  });

  it('con traffic optional pasa en cuanto lo esencial está bien (no espera tráfico)', () => {
    expect(
      decideVerifyOutcome({
        detail: { ...good, traffic: { ok: false, message: 'sin tráfico' } },
        windowExpired: false,
        checks: {
          arp: 'required',
          connreq: 'required',
          wan: 'required',
          dns: 'required',
          route: 'required',
          uplinkVlan: 'required',
          traffic: 'optional',
        },
      }),
    ).toBe('ok');
  });

  it('con traffic required sigue en test si falta tráfico y queda tiempo', () => {
    expect(
      decideVerifyOutcome({
        detail: { ...good, traffic: { ok: false, message: 'sin tráfico' } },
        windowExpired: false,
        checks: {
          arp: 'required',
          connreq: 'required',
          wan: 'required',
          dns: 'required',
          route: 'required',
          uplinkVlan: 'required',
          traffic: 'required',
        },
      }),
    ).toBe('test');
  });

  it('sigue en test si falta algo y queda tiempo', () => {
    expect(
      decideVerifyOutcome({
        detail: {
          connreq: { ok: true, message: 'acs' },
          wan: { ok: false, message: 'vlan' },
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
          connreq: { ok: true, message: 'acs' },
          wan: { ok: false, message: 'vlan' },
        },
        windowExpired: true,
      }),
    ).toBe('fail');
  });

  it('considera el DNS una comprobación esencial', () => {
    expect(
      decideVerifyOutcome({
        detail: {
          ...good,
          dns: { ok: false, message: 'vacío' },
        },
        windowExpired: true,
      }),
    ).toBe('fail');
  });

  it('considera la ruta / WAN legacy una comprobación esencial', () => {
    expect(
      decideVerifyOutcome({
        detail: {
          ...good,
          route: {
            ok: false,
            message: 'WAN legacy activa 10.0.110.16',
          },
        },
        windowExpired: true,
      }),
    ).toBe('fail');
  });

  it('considera el bind LAN/Wi‑Fi una comprobación esencial', () => {
    expect(
      decideVerifyOutcome({
        detail: {
          ...good,
          lanBind: {
            ok: false,
            message: 'bind inválido (true)',
          },
        },
        windowExpired: true,
      }),
    ).toBe('fail');
  });

  it('considera la VLAN en uplink una comprobación esencial', () => {
    expect(
      decideVerifyOutcome({
        detail: {
          ...good,
          uplinkVlan: {
            ok: false,
            message: 'VLAN 702 no actualizada en uplink — actualizar',
          },
        },
        windowExpired: true,
      }),
    ).toBe('fail');
  });

  it('tolera detalles antiguos sin uplinkVlan', () => {
    expect(
      decideVerifyOutcome({
        detail: {
          arp: { ok: true, message: 'resuelta' },
          connreq: { ok: true, message: 'acs' },
          wan: { ok: true, message: 'coincide' },
          dns: { ok: true, message: '8.8.8.8' },
          traffic: { ok: true, message: 'ok' },
        },
        windowExpired: false,
      }),
    ).toBe('ok');
  });

  it('plan/DBA mal cuadra en check, no en fail', () => {
    expect(
      decideVerifyOutcome({
        detail: good,
        windowExpired: false,
        planOk: false,
      }),
    ).toBe('check');
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

  it('con route=skip no exige route aunque esté fail', () => {
    expect(
      decideVerifyOutcome({
        detail: {
          ...good,
          route: { ok: false, message: 'legacy' },
        },
        windowExpired: false,
        checks: {
          arp: 'required',
          connreq: 'required',
          wan: 'required',
          dns: 'required',
          route: 'skip',
          uplinkVlan: 'required',
          traffic: 'optional',
        },
      }),
    ).toBe('ok');
  });

  it('expone el tope de curaciones y de concurrencia', () => {
    expect(VERIFY_HEAL_MAX_ATTEMPTS).toBe(3);
    expect(VERIFY_MAX_CONCURRENCY_PER_TENANT).toBe(5);
    expect(VERIFY_MAX_GLOBAL_CONCURRENCY).toBe(40);
  });

  it('expone el presupuesto de despertar del Resync forzado', () => {
    expect(RESYNC_WAKE_MAX_ATTEMPTS).toBe(10);
    expect(RESYNC_WAKE_DELAY_MS).toBe(15_000);
  });
});

describe('evidencia de Internet', () => {
  it('rechaza pocas conexiones sin destinos públicos', () => {
    expect(
      assessInternetEvidence({ connCount: 4, publicDstCount: 0, bytesRecv: 1200 })
        .ok,
    ).toBe(false);
  });

  it('acepta varios destinos públicos', () => {
    expect(
      assessInternetEvidence({ connCount: 5, publicDstCount: 2 }).ok,
    ).toBe(true);
  });

  it('acepta volumen WAN significativo', () => {
    expect(assessInternetEvidence({ bytesRecv: 90_000 }).ok).toBe(true);
  });

  it('isPublicIpv4 filtra RFC1918', () => {
    expect(isPublicIpv4('8.8.8.8')).toBe(true);
    expect(isPublicIpv4('192.168.1.1')).toBe(false);
    expect(isPublicIpv4('10.0.0.1')).toBe(false);
    expect(countPublicDsts(['8.8.8.8:53', '1.1.1.1:443', '10.0.0.1:80'])).toBe(
      2,
    );
  });
});

describe('resumen', () => {
  it('arma un texto legible para el tooltip', () => {
    expect(
      summarizeVerifyDetail({
        arp: { ok: true, message: 'resuelta' },
        wan: { ok: false, message: 'vlan 80' },
        dns: { ok: false, message: 'vacío' },
        healed: ['credenciales'],
      }),
    ).toContain('dns: fail');
  });
});

describe('cola con tope de concurrencia', () => {
  it('nunca supera el límite y procesa todos', async () => {
    let live = 0;
    let peak = 0;
    const items = Array.from({ length: 50 }, (_, i) => i);

    const results = await mapWithConcurrency(items, 5, async (n) => {
      live += 1;
      peak = Math.max(peak, live);
      await new Promise((r) => setTimeout(r, 5));
      live -= 1;
      return n * 2;
    });

    expect(peak).toBeLessThanOrEqual(5);
    expect(results).toHaveLength(50);
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    expect(
      results.map((r) => (r.status === 'fulfilled' ? r.value : null)),
    ).toEqual(items.map((n) => n * 2));
  });

  it('aisla rechazos sin tumbar el resto de la cola', async () => {
    const results = await mapWithConcurrency([1, 2, 3], 2, async (n) => {
      if (n === 2) throw new Error('boom');
      return n;
    });
    expect(results[0]).toEqual({ status: 'fulfilled', value: 1 });
    expect(results[1].status).toBe('rejected');
    expect(results[2]).toEqual({ status: 'fulfilled', value: 3 });
  });
});
