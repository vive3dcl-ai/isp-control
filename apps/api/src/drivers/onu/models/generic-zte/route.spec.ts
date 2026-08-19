import {
  assessServiceRoute,
  findLegacySmartOltInternetIfaces,
  listTr181DefaultRoutes,
} from './route';

const leaf = (value: unknown) => ({ _value: value });

/** Árbol mínimo tipo ZTEGD7180770: legacy 10.0.110 + servicio 40.40 + defroute mal. */
function brokenLegacyDevice(): Record<string, unknown> {
  return {
    Device: {
      IP: {
        Interface: {
          7: {
            Enable: leaf(true),
            Status: leaf('Up'),
            'X_ZTE-COM_ServiceList': leaf('INTERNET'),
            IPv4Address: {
              1: {
                IPAddress: leaf('10.0.110.16'),
                SubnetMask: leaf('255.255.255.0'),
                'X_ZTE-COM_Gateway': leaf('10.0.110.1'),
              },
            },
          },
          11: {
            Enable: leaf(true),
            Status: leaf('Up'),
            'X_ZTE-COM_ServiceList': leaf('INTERNET_TR069_VoIP'),
            IPv4Address: {
              1: {
                IPAddress: leaf('40.40.21.8'),
                SubnetMask: leaf('255.255.255.0'),
                'X_ZTE-COM_Gateway': leaf('40.40.21.1'),
              },
            },
          },
        },
      },
      Routing: {
        Router: {
          1: {
            IPv4Forwarding: {
              1: {
                Enable: leaf(true),
                DestIPAddress: leaf('0.0.0.0'),
                DestSubnetMask: leaf('0.0.0.0'),
                GatewayIPAddress: leaf('10.0.110.1'),
                Interface: leaf('Device.IP.Interface.7'),
              },
            },
          },
        },
      },
    },
  };
}

function healthyDevice(): Record<string, unknown> {
  const d = brokenLegacyDevice() as ReturnType<typeof brokenLegacyDevice> & {
    Device: {
      IP: { Interface: Record<string, unknown> };
      Routing: {
        Router: {
          1: { IPv4Forwarding: { 1: Record<string, unknown> } };
        };
      };
    };
  };
  d.Device.IP.Interface[7] = {
    Enable: leaf(false),
    Status: leaf('Down'),
    'X_ZTE-COM_ServiceList': leaf('INTERNET'),
    IPv4Address: {
      1: {
        IPAddress: leaf('10.0.110.16'),
        'X_ZTE-COM_Gateway': leaf('10.0.110.1'),
      },
    },
  };
  d.Device.Routing.Router[1].IPv4Forwarding[1] = {
    Enable: leaf(true),
    DestIPAddress: leaf('0.0.0.0'),
    DestSubnetMask: leaf('0.0.0.0'),
    GatewayIPAddress: leaf('40.40.21.1'),
    Interface: leaf('Device.IP.Interface.11'),
  };
  return d;
}

describe('assessServiceRoute', () => {
  it('falla cuando la defroute apunta a la WAN SmartOLT 10.0.110', () => {
    const a = assessServiceRoute(brokenLegacyDevice(), {
      serviceConn: 'Device.IP.Interface.11',
      expectedGateway: '40.40.21.1',
      dataModel: 'tr181',
    });
    expect(a.ok).toBe(false);
    expect(a.disablePaths).toEqual(['Device.IP.Interface.7']);
    expect(a.routeFix?.[0][1]).toBe('Device.IP.Interface.11');
    expect(a.routeFix?.[1][1]).toBe('40.40.21.1');
    expect(a.message).toMatch(/legacy|defroute/i);
  });

  it('ok cuando legacy está down y la ruta apunta al servicio', () => {
    const a = assessServiceRoute(healthyDevice(), {
      serviceConn: 'Device.IP.Interface.11',
      expectedGateway: '40.40.21.1',
      dataModel: 'tr181',
    });
    expect(a.ok).toBe(true);
    expect(a.disablePaths).toEqual([]);
  });

  it('TR-098 no inspecciona Forwarding (gateway ya va en wan)', () => {
    const a = assessServiceRoute({}, {
      serviceConn: 'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1',
      expectedGateway: '40.40.21.1',
      dataModel: 'tr098',
    });
    expect(a.ok).toBe(true);
    expect(a.model).toBe('tr098');
  });

  it('findLegacySmartOltInternetIfaces ignora el servicio y TR069', () => {
    const legacy = findLegacySmartOltInternetIfaces(
      brokenLegacyDevice(),
      'Device.IP.Interface.11',
    );
    expect(legacy.map((i) => i.path)).toEqual(['Device.IP.Interface.7']);
  });
});

describe('listTr181DefaultRoutes', () => {
  it('lista solo Dest 0.0.0.0', () => {
    const routes = listTr181DefaultRoutes(brokenLegacyDevice());
    expect(routes).toHaveLength(1);
    expect(routes[0].gateway).toBe('10.0.110.1');
  });
});
