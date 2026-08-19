import {
  counterDelta,
  octetsRateBytesPerSec,
  resolveSnmpOctetRates,
} from './onu-traffic-rate.util';

describe('counterDelta', () => {
  it('resta normal cuando el contador avanza', () => {
    expect(counterDelta(1_000, 3_000)).toBe(2_000);
  });

  it('maneja la vuelta de 32 bits', () => {
    expect(counterDelta(0xfffffff0, 0x0f)).toBe(0x1f);
  });
});

describe('octetsRateBytesPerSec', () => {
  it('devuelve bytes por segundo, sin convertir a bits', () => {
    // 1 MB en 1 s son 1.000.000 B/s, no 8.000.000: el x8 lo pone el frontend.
    expect(
      octetsRateBytesPerSec({
        prevOctets: 0,
        nextOctets: 1_000_000,
        seconds: 1,
      }),
    ).toBe(1_000_000);
  });

  it('reparte el delta en la ventana medida', () => {
    expect(
      octetsRateBytesPerSec({ prevOctets: 100, nextOctets: 1_100, seconds: 4 }),
    ).toBe(250);
  });

  it('descarta ventanas sin duración', () => {
    expect(
      octetsRateBytesPerSec({ prevOctets: 0, nextOctets: 500, seconds: 0 }),
    ).toBeNull();
  });

  it('descarta lecturas no numéricas', () => {
    expect(
      octetsRateBytesPerSec({
        prevOctets: Number.NaN,
        nextOctets: 500,
        seconds: 2,
      }),
    ).toBeNull();
  });
});

describe('resolveSnmpOctetRates', () => {
  const t0 = 1_000_000;

  it('solo fija baseline en la primera lectura', () => {
    const r = resolveSnmpOctetRates({
      prev: undefined,
      inOctets: 100,
      outOctets: 200,
      atMs: t0,
      minDtSec: 1.5,
    });
    expect(r.emit).toBe(false);
    expect(r.nextPrev).toEqual({ inOctets: 100, outOctets: 200, atMs: t0 });
  });

  it('no emite 0 cuando el contador no se mueve entre polls cortos', () => {
    const prev = { inOctets: 1000, outOctets: 2000, atMs: t0 };
    const r = resolveSnmpOctetRates({
      prev,
      inOctets: 1000,
      outOctets: 2000,
      atMs: t0 + 3_000,
      minDtSec: 1.5,
    });
    expect(r.emit).toBe(false);
    expect(r.nextPrev).toBe(prev);
    expect(r.uploadBps).toBeNull();
    expect(r.downloadBps).toBeNull();
  });

  it('emite tasa cuando el contador avanza (aunque haya habido polls stale)', () => {
    const prev = { inOctets: 1000, outOctets: 2000, atMs: t0 };
    // 9 s después: 9000 bytes in, 18000 out → 1000 / 9000 B/s
    const r = resolveSnmpOctetRates({
      prev,
      inOctets: 10_000,
      outOctets: 20_000,
      atMs: t0 + 9_000,
      minDtSec: 1.5,
    });
    expect(r.emit).toBe(true);
    expect(r.uploadBps).toBe(1000);
    expect(r.downloadBps).toBe(2000);
    expect(r.nextPrev.atMs).toBe(t0 + 9_000);
  });

  it('tras idle largo con contadores congelados emite 0 real', () => {
    const prev = { inOctets: 1000, outOctets: 2000, atMs: t0 };
    const r = resolveSnmpOctetRates({
      prev,
      inOctets: 1000,
      outOctets: 2000,
      atMs: t0 + 50_000,
      minDtSec: 1.5,
      idleEmitSec: 45,
    });
    expect(r.emit).toBe(true);
    expect(r.uploadBps).toBe(0);
    expect(r.downloadBps).toBe(0);
  });

  it('no avanza baseline si el poll es más corto que minDt', () => {
    const prev = { inOctets: 1000, outOctets: 2000, atMs: t0 };
    const r = resolveSnmpOctetRates({
      prev,
      inOctets: 1500,
      outOctets: 2500,
      atMs: t0 + 500,
      minDtSec: 1.5,
    });
    expect(r.emit).toBe(false);
    expect(r.nextPrev).toBe(prev);
  });
});
