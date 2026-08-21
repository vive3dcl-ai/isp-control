import type { OnuVerifyHealCtx, OnuModelProvisionWanPlan } from '../../types';
import { pickHg8145VerifyStep } from './verify';

const WAN: OnuModelProvisionWanPlan = {
  wanIp: '40.40.20.35',
  wanVlan: 701,
  wanGateway: '40.40.20.1',
  wanMask: '255.255.255.0',
  wanDns1: '8.8.8.8',
  wanDns2: '8.8.4.4',
};

function leaf(value: unknown) {
  return { _value: value };
}

function baseCtx(
  device: Record<string, unknown>,
  gaps: OnuVerifyHealCtx['gaps'],
): OnuVerifyHealCtx {
  return {
    sn: 'HWTCABA847AA',
    onuType: 'HG8145X6',
    acsModel: 'HG8145X6',
    client: {} as never,
    deviceId: 'dev',
    device,
    wan: WAN,
    mgmtIp: '30.30.20.35',
    serviceVlan: 701,
    explicit: false,
    preloadConnReq: async () => 'preload',
    reboot: async () => ({ ok: true, note: 'reboot' }),
    isReachable: async () => true,
    gaps,
  };
}

function mgmtDevice(opts?: { connreq?: boolean; inform?: number }) {
  const ms: Record<string, unknown> = {
    ConnectionRequestURL: leaf('http://30.30.20.35:7547/x'),
  };
  if (opts?.connreq) {
    ms.ConnectionRequestUsername = leaf('acs');
    ms.ConnectionRequestPassword = leaf('x');
  }
  if (opts?.inform != null) {
    ms.PeriodicInformInterval = leaf(opts.inform);
    ms.PeriodicInformEnable = leaf(true);
  }
  return {
    InternetGatewayDevice: {
      ManagementServer: ms,
      WANDevice: {
        1: {
          WANConnectionDevice: {
            1: {
              WANIPConnection: {
                1: {
                  Name: leaf('OLT_C_TR069_Static_WAN'),
                  X_HW_SERVICELIST: leaf('TR069'),
                  X_HW_VLAN: leaf(401),
                  ExternalIPAddress: leaf('30.30.20.35'),
                  ConnectionStatus: leaf('Connected'),
                },
              },
            },
          },
        },
      },
    },
  };
}

describe('pickHg8145VerifyStep', () => {
  it('sin Inform vivo + CR down → OMCI antes que intervalo ACS', () => {
    const step = pickHg8145VerifyStep(
      baseCtx(mgmtDevice(), {
        connreqOurs: false,
        informOk: false,
        informAlive: false,
        reachable: false,
        mgmtReady: false,
        hasServiceWan: false,
        serviceWanOk: false,
      }),
    );
    expect(step).toBe('ensure_omci_tr069');
  });

  it('Inform vivo pero intervalo largo → acortar intervalo', () => {
    const step = pickHg8145VerifyStep(
      baseCtx(
        { ...mgmtDevice(), _lastInform: new Date().toISOString() },
        {
          connreqOurs: false,
          informOk: false,
          informAlive: true,
          reachable: false,
          mgmtReady: false,
          hasServiceWan: false,
          serviceWanOk: false,
        },
      ),
    );
    expect(step).toBe('ensure_inform');
  });

  it('sin WAN INTERNET crea WCD aunque CR falle (acs fábrica)', () => {
    const step = pickHg8145VerifyStep(
      baseCtx(mgmtDevice({ connreq: true, inform: 120 }), {
        connreqOurs: false,
        informOk: true,
        informAlive: true,
        reachable: false,
        mgmtReady: true,
        hasServiceWan: false,
        serviceWanOk: false,
      }),
    );
    expect(step).toBe('ensure_service_wcd');
  });

  it('tras creds pide inform 120s', () => {
    const step = pickHg8145VerifyStep(
      baseCtx(mgmtDevice({ connreq: true }), {
        connreqOurs: true,
        informOk: false,
        informAlive: true,
        reachable: true,
        mgmtReady: true,
        hasServiceWan: true,
        serviceWanOk: false,
      }),
    );
    expect(step).toBe('ensure_inform');
  });

  it('sin CR no crea WAN cuando ya hay INTERNET (espera reachable)', () => {
    const step = pickHg8145VerifyStep(
      baseCtx(mgmtDevice({ connreq: true, inform: 120 }), {
        connreqOurs: true,
        informOk: true,
        informAlive: true,
        reachable: false,
        mgmtReady: true,
        hasServiceWan: true,
        serviceWanOk: true,
      }),
    );
    expect(step).toBe('ensure_reachable');
  });

  it('sin INTERNET elige WCD nuevo antes que SPV', () => {
    const step = pickHg8145VerifyStep(
      baseCtx(mgmtDevice({ connreq: true, inform: 120 }), {
        connreqOurs: true,
        informOk: true,
        informAlive: true,
        reachable: true,
        mgmtReady: true,
        hasServiceWan: false,
        serviceWanOk: false,
      }),
    );
    expect(step).toBe('ensure_service_wcd');
  });

  it('WAN INTERNET mal configurada SPV aunque CR falle (acs fábrica)', () => {
    const step = pickHg8145VerifyStep(
      baseCtx(mgmtDevice({ connreq: true, inform: 120 }), {
        connreqOurs: false,
        informOk: true,
        informAlive: true,
        reachable: false,
        mgmtReady: false,
        hasServiceWan: true,
        serviceWanOk: false,
      }),
    );
    expect(step).toBe('ensure_service_spv');
    expect(step).not.toBe('ensure_omci_tr069');
  });

  it('WAN mal configurada solo SPV', () => {
    const device = mgmtDevice({ connreq: true, inform: 120 }) as ReturnType<
      typeof mgmtDevice
    > & {
      InternetGatewayDevice: {
        WANDevice: {
          1: {
            WANConnectionDevice: Record<string, unknown>;
          };
        };
      };
    };
    device.InternetGatewayDevice.WANDevice[1].WANConnectionDevice['2'] = {
      WANIPConnection: {
        1: {
          Name: leaf('ISPCTRL_INTERNET_701'),
          X_HW_SERVICELIST: leaf('INTERNET'),
          X_HW_VLAN: leaf(701),
          ExternalIPAddress: leaf('40.40.20.35'),
          DNSServers: leaf(''),
          ConnectionStatus: leaf('Connected'),
        },
      },
    };
    const step = pickHg8145VerifyStep(
      baseCtx(device, {
        connreqOurs: true,
        informOk: true,
        informAlive: true,
        reachable: true,
        mgmtReady: true,
        hasServiceWan: true,
        serviceWanOk: false,
      }),
    );
    expect(step).toBe('ensure_service_spv');
  });

  it('ERROR_NO_CARRIER pide L2 OLT antes que SPV', () => {
    const device = mgmtDevice({ connreq: true, inform: 120 }) as ReturnType<
      typeof mgmtDevice
    > & {
      InternetGatewayDevice: {
        WANDevice: {
          1: {
            WANConnectionDevice: Record<string, unknown>;
          };
        };
      };
    };
    device.InternetGatewayDevice.WANDevice[1].WANConnectionDevice['3'] = {
      WANIPConnection: {
        1: {
          Name: leaf('ISPCTRL_INTERNET_701'),
          X_HW_SERVICELIST: leaf('INTERNET'),
          X_HW_VLAN: leaf(701),
          ExternalIPAddress: leaf('40.40.20.35'),
          DNSServers: leaf('8.8.8.8,8.8.4.4'),
          ConnectionStatus: leaf('Connecting'),
          LastConnectionError: leaf('ERROR_NO_CARRIER'),
        },
      },
    };
    const step = pickHg8145VerifyStep(
      baseCtx(device, {
        connreqOurs: true,
        informOk: true,
        informAlive: true,
        reachable: true,
        mgmtReady: true,
        hasServiceWan: true,
        serviceWanOk: false,
        serviceCarrierOk: false,
      }),
    );
    expect(step).toBe('ensure_service_l2');
  });

  it('CPE VLAN ≠ panel → reset WAN (no puente ACS)', () => {
    const device = mgmtDevice({ connreq: true, inform: 120 }) as ReturnType<
      typeof mgmtDevice
    > & {
      InternetGatewayDevice: {
        WANDevice: {
          1: {
            WANConnectionDevice: Record<string, unknown>;
          };
        };
      };
    };
    device.InternetGatewayDevice.WANDevice[1].WANConnectionDevice['3'] = {
      WANIPConnection: {
        1: {
          Name: leaf('ISPCTRL_INTERNET_701'),
          X_HW_SERVICELIST: leaf('INTERNET'),
          X_HW_VLAN: leaf(701),
          ExternalIPAddress: leaf('40.40.20.54'),
          DNSServers: leaf('8.8.8.8,8.8.4.4'),
          ConnectionStatus: leaf('Connecting'),
          LastConnectionError: leaf('ERROR_NO_CARRIER'),
        },
      },
    };
    const step = pickHg8145VerifyStep({
      ...baseCtx(device, {
        connreqOurs: true,
        informOk: true,
        informAlive: true,
        reachable: true,
        mgmtReady: true,
        hasServiceWan: true,
        serviceWanOk: false,
        serviceCarrierOk: false,
      }),
      wan: {
        ...WAN,
        wanIp: '40.40.21.96',
        wanVlan: 702,
        wanGateway: '40.40.21.1',
      },
      serviceVlan: 702,
    });
    expect(step).toBe('ensure_service_wan_reset');
  });

  it('WCD vacío pide WANIP antes que WCD nuevo', () => {
    const device = mgmtDevice({ connreq: true, inform: 120 }) as ReturnType<
      typeof mgmtDevice
    > & {
      InternetGatewayDevice: {
        WANDevice: {
          1: {
            WANConnectionDevice: Record<string, unknown>;
          };
        };
      };
    };
    device.InternetGatewayDevice.WANDevice[1].WANConnectionDevice['3'] = {
      WANIPConnection: {},
    };
    const step = pickHg8145VerifyStep(
      baseCtx(device, {
        connreqOurs: true,
        informOk: true,
        informAlive: true,
        reachable: true,
        mgmtReady: true,
        hasServiceWan: false,
        serviceWanOk: false,
      }),
    );
    expect(step).toBe('ensure_service_wanip');
  });
});
