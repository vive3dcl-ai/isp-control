import {
  assessServiceLanBind,
  FH_HG6143D_DEFAULT_LAN_BIND,
  TENDA_HG9_DEFAULT_LAN_BIND,
  lanWifiStringBindOk,
} from './lan-bind';

function leaf(value: unknown) {
  return { _value: value };
}

const CONN =
  'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1';

describe('assessServiceLanBind', () => {
  it('FiberHome boolean true es bind roto y cura con lista de paths', () => {
    const device = {
      InternetGatewayDevice: {
        WANDevice: {
          1: {
            WANConnectionDevice: {
              1: {
                WANIPConnection: {
                  1: { X_FH_LanInterface: leaf(true) },
                },
              },
            },
          },
        },
      },
    };
    const a = assessServiceLanBind(device, CONN);
    expect(a.ok).toBe(false);
    expect(a.message).toMatch(/inválido/);
    expect(a.heal?.[0]?.[1]).toBe(FH_HG6143D_DEFAULT_LAN_BIND);
    expect(a.heal?.[0]?.[2]).toBe('xsd:string');
  });

  it('FiberHome con eth + WLAN está ok', () => {
    const device = {
      InternetGatewayDevice: {
        WANDevice: {
          1: {
            WANConnectionDevice: {
              1: {
                WANIPConnection: {
                  1: {
                    X_FH_LanInterface: leaf(
                      'InternetGatewayDevice.LANDevice.1.LANEthernetInterfaceConfig.1,InternetGatewayDevice.LANDevice.1.WLANConfiguration.1',
                    ),
                  },
                },
              },
            },
          },
        },
      },
    };
    expect(assessServiceLanBind(device, CONN).ok).toBe(true);
  });

  it('no reinyecta eth que ya está en WAN IPTV', () => {
    const eth4 =
      'InternetGatewayDevice.LANDevice.1.LANEthernetInterfaceConfig.4';
    const device = {
      InternetGatewayDevice: {
        WANDevice: {
          1: {
            WANConnectionDevice: {
              1: {
                WANIPConnection: {
                  1: { X_FH_LanInterface: leaf(true) },
                },
              },
              2: {
                WANIPConnection: {
                  1: { X_FH_LanInterface: leaf(eth4) },
                },
              },
            },
          },
        },
      },
    };
    const expected = String(
      assessServiceLanBind(device, CONN).heal?.[0]?.[1] ?? '',
    );
    expect(expected).not.toContain(eth4);
    expect(expected).toContain('WLANConfiguration');
  });

  it('Huawei sin ningún SSID ligado falla', () => {
    const device = {
      InternetGatewayDevice: {
        WANDevice: {
          1: {
            WANConnectionDevice: {
              1: {
                WANIPConnection: {
                  1: {
                    X_HW_LANBIND: {
                      Lan1Enable: leaf(1),
                      SSID1Enable: leaf(0),
                      SSID2Enable: leaf(0),
                    },
                  },
                },
              },
            },
          },
        },
      },
    };
    const a = assessServiceLanBind(device, CONN);
    expect(a.ok).toBe(false);
    expect(a.heal?.some((p) => p[0].endsWith('SSID1Enable'))).toBe(true);
  });

  it('Huawei con LAN+SSID1 ok aunque SSID2 esté en 0', () => {
    const device = {
      InternetGatewayDevice: {
        WANDevice: {
          1: {
            WANConnectionDevice: {
              1: {
                WANIPConnection: {
                  1: {
                    X_HW_LANBIND: {
                      Lan1Enable: leaf(1),
                      SSID1Enable: leaf(1),
                      SSID2Enable: leaf(0),
                    },
                  },
                },
              },
            },
          },
        },
      },
    };
    expect(assessServiceLanBind(device, CONN).ok).toBe(true);
  });

  it('Tenda sólo-Wi‑Fi pide LAN1–4', () => {
    const device = {
      InternetGatewayDevice: {
        WANDevice: {
          1: {
            WANConnectionDevice: {
              1: {
                WANIPConnection: {
                  1: {
                    X_TDTC_LanInterfaceBind: leaf(
                      'WLAN0-AP1,WLAN0-AP2,WLAN1-AP1',
                    ),
                  },
                },
              },
            },
          },
        },
      },
    };
    const a = assessServiceLanBind(device, CONN);
    expect(a.ok).toBe(false);
    expect(String(a.heal?.[0]?.[1])).toContain('LAN1');
    expect(String(a.heal?.[0]?.[1])).toContain('WLAN0-AP1');
  });

  it('sin hoja ACS se omite (puente OMCI)', () => {
    const a = assessServiceLanBind({ InternetGatewayDevice: {} }, CONN);
    expect(a.ok).toBe(true);
    expect(a.skip).toBe(true);
  });
});

describe('lanWifiStringBindOk', () => {
  it('rechaza true/vacío y acepta lista LAN+WLAN', () => {
    expect(lanWifiStringBindOk('true')).toBe(false);
    expect(lanWifiStringBindOk('')).toBe(false);
    expect(lanWifiStringBindOk(TENDA_HG9_DEFAULT_LAN_BIND)).toBe(true);
    expect(lanWifiStringBindOk(FH_HG6143D_DEFAULT_LAN_BIND)).toBe(true);
  });
});
