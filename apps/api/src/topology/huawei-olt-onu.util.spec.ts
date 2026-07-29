import {
  canonicalizeHuaweiPonIfName,
  isHuaweiEponCard,
  isHuaweiGponCard,
  parseHuaweiOltIf,
  parseHuaweiOnuIf,
  parseHuaweiTrafficRates,
} from './huawei-olt-onu.util';
import { buildHuaweiPonPorts } from './huawei-olt-pon.util';

describe('Huawei OLT GPON-only utilities', () => {
  it.each([
    ['GPON0/1/2', 'gpon-olt_0/1/2'],
    ['gpon_0/1/2', 'gpon-olt_0/1/2'],
    ['xgpon 0/1/2', 'gpon-olt_0/1/2'],
    ['gpon-olt_0/1/2', 'gpon-olt_0/1/2'],
  ])('canonicalizes SNMP ifName %s', (input, expected) => {
    expect(canonicalizeHuaweiPonIfName(input)).toBe(expected);
  });

  it('rejects EPON interface names at every parser boundary', () => {
    expect(canonicalizeHuaweiPonIfName('EPON0/1/2')).toBeNull();
    expect(parseHuaweiOltIf('epon-olt_0/1/2')).toBeNull();
    expect(parseHuaweiOnuIf('epon-onu_0/1/2:3')).toBeNull();
  });

  it('identifies GPON and EPON cards without advertising EPON ports', () => {
    expect(isHuaweiGponCard('GPFD')).toBe(true);
    expect(isHuaweiGponCard('XGHD')).toBe(true);
    expect(isHuaweiEponCard('EPFD')).toBe(true);
    const ports = buildHuaweiPonPorts([
      { slot: '1', cfgType: 'GPFD', realType: 'GPFD', ports: 1 },
      { slot: '2', cfgType: 'EPFD', realType: 'EPFD', ports: 1 },
    ]);
    expect(ports).toHaveLength(1);
    expect(ports[0]).toMatchObject({
      ifName: 'gpon-olt_0/1/0',
      ponType: 'gpon',
      adminEnabled: false,
      status: 'Down',
    });
  });

  it('parses actual CLI traffic rates into bytes/s and packets/s', () => {
    expect(
      parseHuaweiTrafficRates(`
        Upstream rate : 8000 kbit/s
        Downstream rate : 16 Mbit/s
        Upstream packets/s : 120
        Downstream packets/s : 240
      `),
    ).toEqual({
      uploadBps: 1_000_000,
      downloadBps: 2_000_000,
      uploadPps: 120,
      downloadPps: 240,
    });
  });
});
