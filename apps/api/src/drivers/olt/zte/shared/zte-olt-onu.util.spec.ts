import {
  countUncfgDataLines,
  parseOnuUncfg,
  parseRemoteOnuEquip,
} from './zte-olt-onu.util';

describe('zte-olt-onu.util uncfg', () => {
  it('parses the OnuIndex table format', () => {
    const text = `
OnuIndex             Sn                     State
-------------------------------------------------
gpon-onu_1/2/1:1     ZTEGC1234567           unknown
gpon-onu_1/2/3:5     ZTEGC7654321           unknown
ZXAN#`;
    const rows = parseOnuUncfg(text);
    expect(rows.map((r) => r.sn)).toEqual(['ZTEGC1234567', 'ZTEGC7654321']);
    expect(rows[0].oltIf).toBe('gpon-olt_1/2/1');
    expect(countUncfgDataLines(text)).toBe(2);
  });

  it('flags SN-only output as unparsed when no port context is given', () => {
    const text = `
ZTEGC1234567     unknown
ZTEGC7654321     unknown
ZXAN#`;
    // Sin defaultOltIf el parser no puede construir el oltIf: el conteo de
    // líneas es el que delata que hay filas perdidas.
    expect(parseOnuUncfg(text)).toHaveLength(0);
    expect(countUncfgDataLines(text)).toBe(2);
    expect(parseOnuUncfg(text, 'gpon-olt_1/2/1')).toHaveLength(2);
  });

  it('ignores headers, totals and the prompt', () => {
    const text = `
OnuIndex   Sn   State
---------------------
Total: 0
ZXAN(config)#`;
    expect(countUncfgDataLines(text)).toBe(0);
  });
});

describe('parseRemoteOnuEquip', () => {
  it('toma Model y Equipment ID; ignora N/A en otras hojas', () => {
    const text = `
Vendor ID:                 HWTC
Model:                     EG8145X6-10
Equipment ID:              EG8145X6-10
Survival time:             N/A
Product SN:                N/A
Region code:               N/A
`;
    const e = parseRemoteOnuEquip(text);
    expect(e.model).toBe('EG8145X6-10');
    expect(e.equipId).toBe('EG8145X6-10');
  });

  it('si Model es N/A usa Equipment ID', () => {
    const text = `
Model:                     N/A
Equipment ID:              EG8145X6-10
Product SN:                N/A
`;
    const e = parseRemoteOnuEquip(text);
    expect(e.model).toBe('EG8145X6-10');
    expect(e.equipId).toBe('EG8145X6-10');
  });

  it('no inventa modelo cuando todo es N/A', () => {
    const text = `
Model:                     N/A
Equipment ID:              N/A
Product SN:                N/A
`;
    const e = parseRemoteOnuEquip(text);
    expect(e.model).toBeNull();
    expect(e.equipId).toBeNull();
  });
});
