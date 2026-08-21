import {
  findServiceWanVlanMismatch,
  preferWanVlanHealMode,
} from './service-wan-vlan';

function leaf(value: unknown) {
  return { _value: value };
}

function hwInternet(vlan: number, ip: string) {
  return {
    InternetGatewayDevice: {
      WANDevice: {
        1: {
          WANConnectionDevice: {
            1: {
              WANIPConnection: {
                1: {
                  Name: leaf('1_TR069_R_VID_401'),
                  X_HW_SERVICELIST: leaf('TR069'),
                  X_HW_VLAN: leaf(401),
                  ExternalIPAddress: leaf('30.30.20.1'),
                },
              },
            },
            3: {
              WANIPConnection: {
                1: {
                  Name: leaf(`ISPCTRL_INTERNET_${vlan}`),
                  X_HW_SERVICELIST: leaf('INTERNET'),
                  X_HW_VLAN: leaf(vlan),
                  ExternalIPAddress: leaf(ip),
                },
              },
            },
          },
        },
      },
    },
  };
}

describe('findServiceWanVlanMismatch', () => {
  it('detecta INTERNET en VLAN distinta al panel', () => {
    const m = findServiceWanVlanMismatch(hwInternet(701, '40.40.20.54'), 702);
    expect(m).toMatchObject({
      currentVlan: 701,
      expectedVlan: 702,
    });
    expect(m?.connDevice).toContain('WANConnectionDevice.3');
  });

  it('null si VLAN ya es la del panel', () => {
    expect(
      findServiceWanVlanMismatch(hwInternet(702, '40.40.21.96'), 702),
    ).toBeNull();
  });

  it('no marca TR069 como mismatch', () => {
    const device = {
      InternetGatewayDevice: {
        WANDevice: {
          1: {
            WANConnectionDevice: {
              1: {
                WANIPConnection: {
                  1: {
                    X_HW_SERVICELIST: leaf('TR069'),
                    X_HW_VLAN: leaf(401),
                    ExternalIPAddress: leaf('30.30.20.1'),
                  },
                },
              },
            },
          },
        },
      },
    };
    expect(findServiceWanVlanMismatch(device, 702)).toBeNull();
  });
});

describe('preferWanVlanHealMode', () => {
  it('huawei / tenda → recreate', () => {
    expect(preferWanVlanHealMode({ family: 'huawei_hgu' })).toBe('recreate');
    expect(preferWanVlanHealMode({ family: 'tenda' })).toBe('recreate');
  });

  it('fiberhome → change', () => {
    expect(preferWanVlanHealMode({ family: 'fiberhome_hgu' })).toBe('change');
  });
});
