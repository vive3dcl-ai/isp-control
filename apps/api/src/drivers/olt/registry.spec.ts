import {
  OLT_DRIVER_KINDS,
  resolveOltCli,
  resolveOltDriverKind,
  resolveOltSnmp,
} from './index';

describe('resolveOltDriverKind', () => {
  it('mapea subtypes C3xx → zte-c3xx', () => {
    expect(resolveOltDriverKind({ type: 'olt', subtype: 'zte_c320' })).toBe(
      'zte-c3xx',
    );
    expect(resolveOltDriverKind({ type: 'olt', subtype: 'zte_c300' })).toBe(
      'zte-c3xx',
    );
    expect(resolveOltDriverKind({ type: 'olt', subtype: 'zte_c3xx' })).toBe(
      'zte-c3xx',
    );
  });

  it('mapea subtypes C6xx → zte-titan', () => {
    expect(resolveOltDriverKind({ type: 'olt', subtype: 'zte_c600' })).toBe(
      'zte-titan',
    );
    expect(resolveOltDriverKind({ type: 'olt', subtype: 'zte_c650' })).toBe(
      'zte-titan',
    );
  });

  it('mapea Huawei → huawei', () => {
    expect(
      resolveOltDriverKind({ type: 'olt', subtype: 'huawei_ma5800_x7' }),
    ).toBe('huawei');
  });

  it('null si no es OLT gestionada', () => {
    expect(resolveOltDriverKind({ type: 'router', subtype: 'mikrotik' })).toBe(
      null,
    );
    expect(resolveOltDriverKind({ type: 'olt', subtype: null })).toBe(null);
  });

  it('exporta las tres ramas del producto', () => {
    expect([...OLT_DRIVER_KINDS]).toEqual([
      'zte-c3xx',
      'zte-titan',
      'huawei',
    ]);
  });
});

describe('resolveOltCli / resolveOltSnmp', () => {
  const zteC3xx = { id: 'c3xx' } as never;
  const zteTitan = { id: 'titan' } as never;
  const huawei = { id: 'huawei' } as never;
  const deps = { zteC3xx, zteTitan, huawei };

  it('devuelve el client Huawei para MA5800', () => {
    expect(
      resolveOltCli({ type: 'olt', subtype: 'huawei_ma5800_x7' }, deps),
    ).toBe(huawei);
    expect(
      resolveOltSnmp({ type: 'olt', subtype: 'huawei_ma5800_x7' }, deps),
    ).toBe(huawei);
  });

  it('separa C3xx y Titan en silos distintos', () => {
    expect(
      resolveOltCli({ type: 'olt', subtype: 'zte_c320' }, deps),
    ).toBe(zteC3xx);
    expect(
      resolveOltCli({ type: 'olt', subtype: 'zte_c600' }, deps),
    ).toBe(zteTitan);
  });
});
