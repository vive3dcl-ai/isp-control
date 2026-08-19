import { vendorFromSn } from './vendor-from-sn';

describe('vendorFromSn', () => {
  it('detecta Huawei / ZTE / FiberHome por prefijo', () => {
    expect(vendorFromSn('HWTC12345678')).toBe('huawei');
    expect(vendorFromSn('HWHTABCDEF01')).toBe('huawei');
    expect(vendorFromSn('ZTEG12345678')).toBe('zte');
    expect(vendorFromSn('FHTT964E6978')).toBe('fiberhome');
    expect(vendorFromSn('FHTC00000001')).toBe('fiberhome');
  });

  it('devuelve other si no hay SN o prefijo desconocido', () => {
    expect(vendorFromSn(null)).toBe('other');
    expect(vendorFromSn('')).toBe('other');
    expect(vendorFromSn('ABCD1234')).toBe('other');
  });
});
