import type { OnuModelProvisionCtx, OnuModelProvisionWanPlan } from '../../types';
import { provisionHg8145x6 } from './provision';

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

describe('provisionHg8145x6', () => {
  it('bootstrap sin hoja MS: preload + reboot, sin AddObject', async () => {
    const device = {
      InternetGatewayDevice: {
        ManagementServer: {
          ConnectionRequestURL: leaf('http://30.30.20.35:7547/x'),
        },
        WANDevice: {
          1: {
            WANConnectionDevice: {
              1: {
                WANIPConnection: {
                  1: {
                    Name: leaf('TR069'),
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
    const addObject = jest.fn();
    const enqueueTask = jest.fn().mockResolvedValue({ status: 202 });
    const reboot = jest.fn().mockResolvedValue({ ok: true, note: 'reboot ok' });
    const ctx: OnuModelProvisionCtx = {
      sn: 'HWTCABA847AA',
      onuType: 'HG8145X6',
      acsModel: 'HG8145X6',
      client: {
        findBySerial: jest.fn().mockResolvedValue(device),
        setParameterValues: jest.fn(),
        addObject,
        enqueueTask,
        refreshObject: jest.fn(),
        getParameterValues: jest.fn(),
        hasPendingTask: jest.fn().mockResolvedValue(false),
      } as never,
      deviceId: 'dev',
      device,
      wan: WAN,
      mgmtIp: '30.30.20.35',
      serviceVlan: 701,
      explicit: true,
      preloadConnReq: jest.fn(),
      reboot,
      isReachable: jest.fn().mockResolvedValue(false),
    };

    const result = await provisionHg8145x6(ctx);
    expect(addObject).not.toHaveBeenCalled();
    expect(enqueueTask).toHaveBeenCalled();
    expect(reboot).toHaveBeenCalled();
    expect(result.notes.some((n) => n.includes('ensure_connreq'))).toBe(true);
  });

  it('acs fábrica + Inform vivo: encola password y crea WCD aunque CR falle', async () => {
    const device = {
      _lastInform: new Date().toISOString(),
      InternetGatewayDevice: {
        ManagementServer: {
          ConnectionRequestURL: leaf('http://30.30.20.35:7547/x'),
          ConnectionRequestUsername: leaf('acs'),
          ConnectionRequestPassword: leaf('wrong'),
          PeriodicInformInterval: leaf(120),
          PeriodicInformEnable: leaf(true),
        },
        WANDevice: {
          1: {
            WANConnectionDevice: {
              1: {
                WANIPConnection: {
                  1: {
                    Name: leaf('TR069'),
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
    const addObject = jest.fn().mockResolvedValue({ status: 202 });
    const setParameterValues = jest.fn().mockResolvedValue({ status: 202 });
    const ctx: OnuModelProvisionCtx = {
      sn: 'HWTCABA847AA',
      onuType: 'EG8145X6-10',
      acsModel: 'EG8145X6-10',
      client: {
        findBySerial: jest.fn().mockResolvedValue(device),
        setParameterValues,
        addObject,
        enqueueTask: jest.fn(),
        refreshObject: jest.fn(),
        getParameterValues: jest.fn(),
        hasPendingTask: jest.fn().mockResolvedValue(false),
      } as never,
      deviceId: 'dev',
      device,
      wan: WAN,
      mgmtIp: '30.30.20.35',
      serviceVlan: 701,
      explicit: true,
      preloadConnReq: jest.fn(),
      reboot: jest.fn().mockResolvedValue({ ok: true, note: 'reboot' }),
      isReachable: jest.fn().mockResolvedValue(false),
    };

    const result = await provisionHg8145x6(ctx);
    expect(setParameterValues).toHaveBeenCalled();
    expect(addObject).toHaveBeenCalled();
    expect(result.notes.some((n) => /continúa WAN|ensure_service_wcd/i.test(n))).toBe(
      true,
    );
  });

  it('Inform muerto + CR down: OMCI + reboot antes de WAN', async () => {
    const device = {
      _lastInform: new Date(Date.now() - 30 * 60_000).toISOString(),
      InternetGatewayDevice: {
        ManagementServer: {
          ConnectionRequestURL: leaf('http://30.30.20.35:7547/x'),
          ConnectionRequestUsername: leaf('acs'),
          PeriodicInformInterval: leaf(120),
          PeriodicInformEnable: leaf(true),
        },
        WANDevice: {
          1: {
            WANConnectionDevice: {
              1: {
                WANIPConnection: {
                  1: {
                    Name: leaf('TR069'),
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
    const addObject = jest.fn();
    const ensureOmciTr069 = jest
      .fn()
      .mockResolvedValue({ ok: true, notes: ['OMCI TR069 OK'] });
    const reboot = jest.fn().mockResolvedValue({ ok: true, note: 'reboot ok' });
    const ctx: OnuModelProvisionCtx = {
      sn: 'HWTC42DF94B8',
      onuType: 'EG8145X6-10',
      acsModel: 'EG8145X6-10',
      client: {
        findBySerial: jest.fn().mockResolvedValue(device),
        setParameterValues: jest.fn().mockResolvedValue({ status: 202 }),
        addObject,
        enqueueTask: jest.fn(),
        refreshObject: jest.fn(),
        getParameterValues: jest.fn(),
        hasPendingTask: jest.fn().mockResolvedValue(false),
      } as never,
      deviceId: 'dev',
      device,
      wan: WAN,
      mgmtIp: '30.30.20.35',
      serviceVlan: 701,
      explicit: true,
      preloadConnReq: jest.fn(),
      reboot,
      isReachable: jest.fn().mockResolvedValue(false),
      ensureOmciTr069,
    };

    const result = await provisionHg8145x6(ctx);
    expect(ensureOmciTr069).toHaveBeenCalled();
    expect(reboot).toHaveBeenCalled();
    expect(addObject).not.toHaveBeenCalled();
    expect(result.notes.some((n) => /ensure_omci_tr069|OMCI/i.test(n))).toBe(
      true,
    );
  });
});
