import {
  decodeOnuIdIfIndex,
  decodeXponOnuIfIndex,
  encodeOnuIdIfIndex,
  encodeXponOnuIfIndex,
  mapV21Status,
  parseOnuIf,
  parseWalkIndexes,
  rawOpticalToDbm,
  ZTE_V21,
} from './zte-olt-snmp.oids';

describe('zte-olt-snmp.oids', () => {
  it('encodes/decodes V2.1 ONU-ID ifIndex', () => {
    expect(encodeOnuIdIfIndex(1, 1)).toBe(285278465);
    expect(encodeOnuIdIfIndex(2, 1)).toBe(285278721);
    expect(decodeOnuIdIfIndex(285278465)).toEqual({
      shelf: 1,
      slot: 1,
      pon: 1,
    });
    expect(decodeOnuIdIfIndex(285278721)).toEqual({
      shelf: 1,
      slot: 2,
      pon: 1,
    });
  });

  it('parses walk indexes from status OID', () => {
    const oid = `${ZTE_V21.status}.285278465.5`;
    expect(parseWalkIndexes(oid, ZTE_V21.status)).toEqual({
      ponIfIndex: 285278465,
      onuId: 5,
    });
  });

  it('parses optical OID with channel suffix', () => {
    const oid = `${ZTE_V21.rxPower}.285278465.5.1`;
    expect(parseWalkIndexes(oid, ZTE_V21.rxPower)).toEqual({
      ponIfIndex: 285278465,
      onuId: 5,
    });
  });

  it('converts optical raw to dBm', () => {
    // (-20 dBm + 30) / 0.002 = 5000
    expect(rawOpticalToDbm(5000)).toBe(-20);
  });

  it('maps V2.1 online status', () => {
    expect(mapV21Status(4).online).toBe(true);
    expect(mapV21Status(7).online).toBe(false);
  });

  it('parses onuIf', () => {
    expect(parseOnuIf('gpon-onu_1/2/14:5')).toEqual({
      family: 'gpon',
      shelf: 1,
      slot: 2,
      pon: 14,
      onuId: 5,
    });
    expect(parseOnuIf('bad')).toBeNull();
  });

  it('encodes/decodes XPON ONU traffic ifIndex', () => {
    // Live OLT samples: 1/2/1:1 → 0x90200100, 1/2/1:3 → 0x90200300
    expect(encodeXponOnuIfIndex(2, 1, 1)).toBe(0x90200100);
    expect(encodeXponOnuIfIndex(2, 1, 3)).toBe(0x90200300);
    expect(encodeXponOnuIfIndex(2, 2, 1)).toBe(0x90210100);
    expect(decodeXponOnuIfIndex(0x90200100)).toEqual({
      slot: 2,
      pon: 1,
      onuId: 1,
    });
    expect(decodeXponOnuIfIndex(0x90210100)).toEqual({
      slot: 2,
      pon: 2,
      onuId: 1,
    });
  });
});
