import { counterDelta, octetsRateBytesPerSec } from './onu-traffic-rate.util';

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
