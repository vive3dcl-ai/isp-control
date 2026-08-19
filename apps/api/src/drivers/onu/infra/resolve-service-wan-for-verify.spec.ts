import {
  resolveServiceWanForVerify,
  shouldHealServiceRoute,
} from './resolve-service-wan-for-verify';
import type { WanConnectionRef } from './wan-datamodel';

function leaf(value: unknown) {
  return { _value: value };
}

/** Huawei multi-WAN: TR069 + INTERNET (el picker global a veces elige mal). */
function huaweiMultiWanDevice() {
  return {
    InternetGatewayDevice: {
      DeviceInfo: { ModelName: leaf('HG8145X6') },
      WANDevice: {
        1: {
          WANConnectionDevice: {
            1: {
              WANIPConnection: {
                1: {
                  Name: leaf('TR069'),
                  X_HW_SERVICELIST: leaf('TR069'),
                  X_HW_VLAN: leaf(401),
                  ExternalIPAddress: leaf('30.30.20.14'),
                },
                2: {
                  Name: leaf('INTERNET'),
                  X_HW_SERVICELIST: leaf('INTERNET'),
                  X_HW_VLAN: leaf(701),
                  ExternalIPAddress: leaf('40.40.20.13'),
                  DNSServers: leaf('8.8.8.8,8.8.4.4'),
                },
              },
            },
          },
        },
      },
    },
  };
}

function huaweiMgmtOnlyDevice() {
  return {
    InternetGatewayDevice: {
      DeviceInfo: { ModelName: leaf('HG8245W5') },
      WANDevice: {
        1: {
          WANConnectionDevice: {
            1: {
              WANIPConnection: {
                1: {
                  Name: leaf('TR069'),
                  X_HW_SERVICELIST: leaf('TR069'),
                  X_HW_VLAN: leaf(401),
                  ExternalIPAddress: leaf('30.30.20.14'),
                },
              },
            },
          },
        },
      },
    },
  };
}

describe('resolveServiceWanForVerify', () => {
  it('Huawei library elige INTERNET, no TR069', () => {
    const found = resolveServiceWanForVerify(huaweiMultiWanDevice(), {
      sn: 'HWTC68610FAE',
      onuType: 'HG8145X6',
      expectedIp: '40.40.20.13',
      expectedVlanId: 701,
      mgmtIp: '30.30.20.14',
    });
    expect(found?.isMgmt).toBe(false);
    expect(found?.model).toBe('tr098');
    expect(found?.conn).toContain('WANIPConnection.2');
  });

  it('Huawei library sin INTERNET → isMgmt', () => {
    const found = resolveServiceWanForVerify(huaweiMgmtOnlyDevice(), {
      sn: 'HWTC750282A6',
      onuType: 'HG8245W5',
      mgmtIp: '30.30.20.14',
    });
    expect(found?.isMgmt).toBe(true);
  });

  it('ZTE no usa picker Huawei (cae al genérico; sin árbol → null)', () => {
    const found = resolveServiceWanForVerify(
      { Device: { DeviceInfo: { ModelName: leaf('F6600P') } } },
      {
        sn: 'ZTEGD71F2028',
        onuType: 'F6600P',
        expectedIp: '40.40.20.13',
        expectedVlanId: 701,
      },
    );
    expect(found).toBeNull();
  });
});

describe('shouldHealServiceRoute', () => {
  it('solo TR-181 de servicio con driver que lo soporta', () => {
    const tr181: WanConnectionRef = {
      model: 'tr181',
      conn: 'Device.IP.Interface.3',
      connDevice: 'Device.IP.Interface.3',
      isMgmt: false,
    };
    const tr098: WanConnectionRef = {
      model: 'tr098',
      conn: 'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.2',
      connDevice:
        'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1',
      isMgmt: false,
    };
    expect(
      shouldHealServiceRoute(tr181, { supportsTr181RouteHeal: true }),
    ).toBe(true);
    expect(
      shouldHealServiceRoute(tr181, { supportsTr181RouteHeal: false }),
    ).toBe(false);
    expect(
      shouldHealServiceRoute(tr098, { supportsTr181RouteHeal: true }),
    ).toBe(false);
    expect(shouldHealServiceRoute(null)).toBe(false);
    expect(
      shouldHealServiceRoute({ ...tr181, isMgmt: true }, {
        supportsTr181RouteHeal: true,
      }),
    ).toBe(false);
  });
});
