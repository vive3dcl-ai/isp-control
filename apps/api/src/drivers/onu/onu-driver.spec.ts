import {
  buildFiberhomeServiceWanParams,
  buildHuaweiServiceWanParams,
  decideModelPrepReboot,
  findFiberhomeInternetWan,
  findHuaweiInternetWan,
  fiberhomeHg6143dHandler,
  huaweiHg8145x6Handler,
  huaweiHguVeipHandler,
  isFiberhomeServiceWanApplied,
  isServiceWanApplied,
  libraryOwnsWanSelection,
  listFiberhomeWanIpConnections,
  listHuaweiWanIpConnections,
  matchesFiberhomeHg6143d,
  matchesHuaweiHg8145x6,
  matchesHuaweiHguVeip,
  needsNewFiberhomeWanConnectionDevice,
  needsNewWanConnectionDevice,
  resolveAcsModelFromDevice,
  resolveFiberhomeLibraryServiceWan,
  resolveNewWanConnection,
  resolveOnuDriver,
  resolveOnuDriverForModel,
  resolveOnuModelHandler,
  resolveOmciPlan,
  resolveVerifyChecks,
} from './index';
import type {
  OnuModelProvisionCtx,
  OnuModelProvisionWanPlan,
} from './index';

function leaf(value: unknown) {
  return { _value: value };
}

/** Árbol mínimo TR-098 Huawei: sólo WAN de gestión. */
function mgmtOnlyDevice() {
  return {
    InternetGatewayDevice: {
      DeviceInfo: { ModelName: leaf('HG8245W5') },
      WANDevice: {
        1: {
          WANConnectionDevice: {
            1: {
              WANIPConnection: {
                1: {
                  Name: leaf('OLT_C_TR069_Static_WAN'),
                  X_HW_SERVICELIST: leaf('TR069'),
                  X_HW_VLAN: leaf(401),
                  ExternalIPAddress: leaf('30.30.20.14'),
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

function withInternetStub() {
  const d = mgmtOnlyDevice() as ReturnType<typeof mgmtOnlyDevice> & {
    InternetGatewayDevice: {
      WANDevice: {
        1: {
          WANConnectionDevice: {
            1: {
              WANIPConnection: Record<string, unknown>;
            };
          };
        };
      };
    };
  };
  d.InternetGatewayDevice.WANDevice[1].WANConnectionDevice[1].WANIPConnection[
    '2'
  ] = {
    Name: leaf('2_INTERNET_R_VID_1'),
    X_HW_SERVICELIST: leaf('INTERNET'),
    X_HW_VLAN: leaf(1),
    ExternalIPAddress: leaf('0.0.0.0'),
    ConnectionStatus: leaf('Disconnected'),
  };
  return d;
}

describe('resolveOnuModelHandler', () => {
  it('elige Huawei HGU para HWTC + HG8245W5', () => {
    const h = resolveOnuModelHandler({
      sn: 'HWTC750282A6',
      onuType: 'HG8245W5',
    });
    expect(h?.id).toBe('huawei-hgu-veip');
  });

  it('no elige FiberHome HG6244C (aún sin library)', () => {
    expect(
      resolveOnuModelHandler({ sn: 'FHTT968157D8', onuType: 'HG6244C' }),
    ).toBeNull();
  });

  it('elige FiberHome HG6143d library', () => {
    expect(
      resolveOnuModelHandler({
        sn: 'FHTT964E6978',
        onuType: 'F600',
        acsModel: 'HG6143D',
      })?.id,
    ).toBe('fiberhome-hg6143d');
  });

  it('no elige ZTE F6600P', () => {
    expect(
      resolveOnuModelHandler({ sn: 'ZTEGD71F2028', onuType: 'F6600P' }),
    ).toBeNull();
  });

  it('con SN Huawei sin modelo aún, sigue siendo candidato', () => {
    expect(matchesHuaweiHguVeip({ sn: 'HWTC750282A6' })).toBe(true);
  });
});

describe('OnuDriver contract', () => {
  it('library Huawei: omciPlan skip + TR098 verify (route skip)', () => {
    const d = resolveOnuDriver({
      sn: 'HWTC68610FAE',
      onuType: 'HG8145X6',
    });
    expect(d?.id).toBe('huawei-hg8145x6');
    expect(d?.omciPlan?.serviceWanOmci).toBe('skip');
    expect(d?.skipOmciServiceWan).toBe(true);
    expect(d?.verifyChecks?.route).toBe('skip');
    expect(d?.supportsTr181RouteHeal).toBe(false);
    expect(typeof d?.resolveServiceWan).toBe('function');
    expect(typeof d?.provisionPipeline).toBe('function');
  });

  it('generic Huawei: omciPlan skip (WAN ACS, no wan-ip OMCI)', () => {
    const d = resolveOnuDriver({
      sn: 'HWTC0000ABCD',
      onuType: 'HG8240H',
    });
    expect(d?.id).toBe('generic-huawei');
    expect(d?.omciPlan?.serviceWanOmci).toBe('skip');
    expect(resolveOmciPlan(d).serviceWanOmci).toBe('skip');
  });

  it('generic ZTE: omciPlan apply + route required', () => {
    const d = resolveOnuDriver({
      sn: 'ZTEGD71F2028',
      onuType: 'F6600P',
    });
    expect(d?.id).toBe('generic-zte');
    expect(d?.omciPlan?.serviceWanOmci).toBe('apply');
    expect(d?.skipOmciServiceWan).toBe(false);
    expect(d?.verifyChecks?.route).toBe('required');
    expect(d?.supportsTr181RouteHeal).toBe(true);
    expect(typeof d?.applyServiceSpv).toBe('function');
  });

  it('resolveOmciPlan / resolveVerifyChecks helpers', () => {
    const hg = resolveOnuDriver({
      sn: 'HWTC68610FAE',
      onuType: 'HG8145X6',
    });
    expect(resolveOmciPlan(hg).serviceWanOmci).toBe('skip');
    expect(resolveVerifyChecks(hg).route).toBe('skip');
    expect(resolveVerifyChecks(hg).arp).toBe('required');

    const zte = resolveOnuDriver({
      sn: 'ZTEGD71F2028',
      onuType: 'F6600P',
    });
    expect(resolveOmciPlan(zte).serviceWanOmci).toBe('apply');
    expect(resolveVerifyChecks(zte).route).toBe('required');
  });
});

describe('libraryOwnsWanSelection', () => {
  it('HG8145X6 reclama WAN (salta OMCI en apply)', () => {
    expect(
      libraryOwnsWanSelection({
        sn: 'HWTC68610FAE',
        onuType: 'HG8145X6',
      })?.id,
    ).toBe('huawei-hg8145x6');
  });

  it('HGU VEIP reclama WAN', () => {
    expect(
      libraryOwnsWanSelection({
        sn: 'HWTC750282A6',
        onuType: 'HG8245W5',
      })?.id,
    ).toBe('huawei-hgu-veip');
  });

  it('ZTE no reclama WAN (sigue camino OMCI)', () => {
    expect(
      libraryOwnsWanSelection({
        sn: 'ZTEGD71F2028',
        onuType: 'F6600P',
      }),
    ).toBeNull();
  });

  it('generic Huawei sin modelo library no reclama', () => {
    // SN Huawei pero modelo que no matchea HGU/8145 — hoy hgu-veip
    // matchea todo HWTC; si no hay SN, null.
    expect(libraryOwnsWanSelection({ sn: '' })).toBeNull();
  });
});

describe('listHuaweiWanIpConnections', () => {
  it('lista la WAN de gestión', () => {
    const conns = listHuaweiWanIpConnections(mgmtOnlyDevice());
    expect(conns).toHaveLength(1);
    expect(conns[0].serviceList).toBe('TR069');
    expect(findHuaweiInternetWan(conns)).toBeNull();
  });

  it('encuentra INTERNET aunque esté a medias', () => {
    const conns = listHuaweiWanIpConnections(withInternetStub());
    expect(findHuaweiInternetWan(conns)?.externalIp).toBe('0.0.0.0');
  });
});

describe('resolveNewWanConnection', () => {
  it('prefiere la conexión recién creada', () => {
    const before = listHuaweiWanIpConnections(mgmtOnlyDevice());
    const after = listHuaweiWanIpConnections(withInternetStub());
    expect(resolveNewWanConnection(before, after)?.ip).toBe(2);
  });
});

describe('buildHuaweiServiceWanParams', () => {
  it('incluye SERVICELIST, VLAN, IP, LANBIND y SSIDs con tipos ACS', () => {
    const params = buildHuaweiServiceWanParams(
      'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.2',
      {
        wanIp: '40.40.20.13',
        wanVlan: 701,
        wanGateway: '40.40.20.1',
        wanMask: '255.255.255.0',
        wanDns1: '8.8.8.8',
        wanDns2: '8.8.4.4',
      },
    );
    const byPath = Object.fromEntries(params.map(([p, v]) => [p, v]));
    const byType = Object.fromEntries(params.map(([p, , t]) => [p, t]));
    const base =
      'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.2';
    expect(byPath[`${base}.X_HW_SERVICELIST`]).toBe('INTERNET');
    expect(byPath[`${base}.X_HW_VLAN`]).toBe(701);
    expect(byType[`${base}.X_HW_VLAN`]).toBe('xsd:unsignedInt');
    expect(byPath[`${base}.ExternalIPAddress`]).toBe('40.40.20.13');
    expect(byPath[`${base}.X_HW_LANBIND.Lan1Enable`]).toBe(1);
    expect(byType[`${base}.X_HW_LANBIND.Lan1Enable`]).toBe('xsd:unsignedInt');
    expect(byPath[`${base}.X_HW_LANBIND.SSID1Enable`]).toBe(1);
    expect(byPath[`${base}.X_HW_LANBIND.SSID8Enable`]).toBe(1);
  });
});

/**
 * Plantilla ISP multi-WAN típica de las EG8145X6: gestión (TR069), OTHER,
 * INTERNET e IPTV. El picker genérico agarra la OTHER; el handler debe quedarse
 * con la INTERNET.
 */
function ispTemplateDevice(internet?: {
  vlan?: number;
  ip?: string;
  dns?: string;
}): Record<string, unknown> {
  const wan = (
    name: string,
    service: string,
    vlan: number,
    ip: string,
    status = 'Connected',
    dns = '',
  ) => ({
    Name: leaf(name),
    X_HW_SERVICELIST: leaf(service),
    X_HW_VLAN: leaf(vlan),
    ExternalIPAddress: leaf(ip),
    ConnectionStatus: leaf(status),
    DNSServers: leaf(dns),
  });
  return {
    InternetGatewayDevice: {
      DeviceInfo: { ModelName: leaf('EG8145X6') },
      WANDevice: {
        1: {
          WANConnectionDevice: {
            1: {
              WANIPConnection: {
                1: wan('1_TR069_R_VID_401', 'TR069', 401, '30.30.20.14'),
                2: wan('2_OTHER_B_VID_10', 'OTHER', 10, '0.0.0.0'),
                3: wan(
                  '3_INTERNET_R_VID',
                  'INTERNET',
                  internet?.vlan ?? 3800,
                  internet?.ip ?? '0.0.0.0',
                  'Connected',
                  internet?.dns ?? '',
                ),
                4: wan('4_IPTV_B_VID_3850', 'IPTV', 3850, '0.0.0.0'),
              },
            },
          },
        },
      },
    },
  };
}

const WAN_702: OnuModelProvisionWanPlan = {
  wanIp: '40.40.21.64',
  wanVlan: 702,
  wanGateway: '40.40.21.1',
  wanMask: '255.255.255.0',
  wanDns1: '8.8.8.8',
  wanDns2: '8.8.4.4',
};

describe('plantilla ISP multi-WAN', () => {
  it('elige la WAN INTERNET, no OTHER/IPTV', () => {
    const conns = listHuaweiWanIpConnections(ispTemplateDevice());
    expect(conns).toHaveLength(4);
    const target = findHuaweiInternetWan(conns);
    expect(target?.serviceList).toBe('INTERNET');
    // La OTHER (VID 10) es la que el picker genérico agarraría por error.
    expect(target?.vlan).not.toBe(10);
  });

  it('genera params de servicio con VLAN 702 + IP fija sobre la INTERNET', () => {
    const target = findHuaweiInternetWan(
      listHuaweiWanIpConnections(ispTemplateDevice()),
    );
    const params = buildHuaweiServiceWanParams(target!.conn, WAN_702);
    const byPath = Object.fromEntries(params.map(([p, v]) => [p, v]));
    expect(byPath[`${target!.conn}.X_HW_SERVICELIST`]).toBe('INTERNET');
    expect(byPath[`${target!.conn}.X_HW_VLAN`]).toBe(702);
    expect(byPath[`${target!.conn}.ExternalIPAddress`]).toBe('40.40.21.64');
  });

  it('elige huawei-hg8145x6 para EG8145X6 (antes del HGU genérico)', () => {
    const ctx = { sn: 'HWTC3CD28AB2', onuType: 'EG8145X6-10' };
    expect(matchesHuaweiHg8145x6(ctx)).toBe(true);
    expect(matchesHuaweiHguVeip(ctx)).toBe(true);
    expect(huaweiHg8145x6Handler.ownsWanSelection?.(ctx)).toBe(true);
    expect(resolveOnuModelHandler(ctx)?.id).toBe('huawei-hg8145x6');
  });

  it('elige huawei-hg8145x6 para HWTC68610FAE / HG8145X6', () => {
    const ctx = {
      sn: 'HWTC68610FAE',
      onuType: 'HG8145X6',
      acsModel: 'HG8145X6',
    };
    expect(matchesHuaweiHg8145x6(ctx)).toBe(true);
    expect(resolveOnuModelHandler(ctx)?.id).toBe('huawei-hg8145x6');
  });

  it('no elige hg8145x6 si el ACS es otro HGU (cae al genérico)', () => {
    const ctx = { sn: 'HWTC750282A6', onuType: 'HG8245W5' };
    expect(matchesHuaweiHg8145x6(ctx)).toBe(false);
    expect(resolveOnuModelHandler(ctx)?.id).toBe('huawei-hgu-veip');
  });

  it('isServiceWanApplied exige también DNS (no solo IP+VLAN)', () => {
    expect(
      isServiceWanApplied(
        ispTemplateDevice({
          vlan: 702,
          ip: '40.40.21.64',
          dns: '8.8.8.8,8.8.4.4',
        }),
        WAN_702,
      ),
    ).toBe(true);
    // Caso HWTC13899DA1: Connected con IP/VLAN bien pero DNSServers vacío.
    expect(
      isServiceWanApplied(
        ispTemplateDevice({ vlan: 702, ip: '40.40.21.64', dns: '' }),
        WAN_702,
      ),
    ).toBe(false);
    expect(isServiceWanApplied(ispTemplateDevice(), WAN_702)).toBe(false);
  });

  it('isServiceWanApplied falla si SSID/LAN bind está en 0 (EG8145X6)', () => {
    const device = ispTemplateDevice({
      vlan: 702,
      ip: '40.40.21.64',
      dns: '8.8.8.8,8.8.4.4',
    });
    const igd = device.InternetGatewayDevice as Record<string, unknown>;
    const wanDev = igd.WANDevice as Record<string, unknown>;
    const w1 = wanDev[1] as Record<string, unknown>;
    const wcd = w1.WANConnectionDevice as Record<string, unknown>;
    const cd1 = wcd[1] as Record<string, unknown>;
    const ipBase = cd1.WANIPConnection as Record<string, unknown>;
    const internet = ipBase[3] as Record<string, unknown>;
    internet.X_HW_LANBIND = {
      Lan1Enable: leaf(1),
      Lan2Enable: leaf(1),
      Lan3Enable: leaf(1),
      Lan4Enable: leaf(1),
      SSID1Enable: leaf(1),
      SSID2Enable: leaf(0),
      SSID3Enable: leaf(0),
      SSID4Enable: leaf(0),
    };
    expect(isServiceWanApplied(device, WAN_702)).toBe(false);
  });

  it('HG8145X6 sólo-TR069 necesita un WANConnectionDevice nuevo', () => {
    const conns = listHuaweiWanIpConnections(mgmtOnlyDevice());
    expect(needsNewWanConnectionDevice(conns)).toBe(true);
  });

  it('plantilla multi-WAN sin hueco vacío también necesita WCD nuevo (no AddObject bajo TR069)', () => {
    // Sin INTERNET: TR069 + OTHER + IPTV — el bug viejo intentaba AddObject
    // bajo WCD.1 y HG8145X6 respondía Invalid parameter path.
    const device = {
      InternetGatewayDevice: {
        DeviceInfo: { ModelName: leaf('EG8145X6') },
        WANDevice: {
          1: {
            WANConnectionDevice: {
              1: {
                WANIPConnection: {
                  1: {
                    Name: leaf('TR069'),
                    X_HW_SERVICELIST: leaf('TR069'),
                    X_HW_VLAN: leaf(401),
                    ExternalIPAddress: leaf('30.30.20.1'),
                  },
                },
              },
              2: {
                WANIPConnection: {
                  1: {
                    Name: leaf('OTHER'),
                    X_HW_SERVICELIST: leaf('OTHER'),
                    X_HW_VLAN: leaf(10),
                    ExternalIPAddress: leaf('0.0.0.0'),
                  },
                },
              },
              3: {
                WANIPConnection: {
                  1: {
                    Name: leaf('IPTV'),
                    X_HW_SERVICELIST: leaf('IPTV'),
                    X_HW_VLAN: leaf(3850),
                    ExternalIPAddress: leaf('0.0.0.0'),
                  },
                },
              },
            },
          },
        },
      },
    };
    expect(
      needsNewWanConnectionDevice(listHuaweiWanIpConnections(device)),
    ).toBe(true);
  });

  it('reutiliza WAN vacía en vez de crear otro WCD', () => {
    const device = {
      InternetGatewayDevice: {
        WANDevice: {
          1: {
            WANConnectionDevice: {
              1: {
                WANIPConnection: {
                  1: {
                    Name: leaf('TR069'),
                    X_HW_SERVICELIST: leaf('TR069'),
                    X_HW_VLAN: leaf(401),
                    ExternalIPAddress: leaf('30.30.20.1'),
                  },
                },
              },
              2: {
                WANIPConnection: {
                  1: {
                    Name: leaf(''),
                    X_HW_SERVICELIST: leaf(''),
                    X_HW_VLAN: leaf(1),
                    ExternalIPAddress: leaf('0.0.0.0'),
                  },
                },
              },
            },
          },
        },
      },
    };
    const conns = listHuaweiWanIpConnections(device);
    expect(needsNewWanConnectionDevice(conns)).toBe(false);
  });
});

describe('huaweiHguVeipHandler.provision', () => {
  function fakeClient(device: Record<string, unknown>) {
    const spv = jest.fn().mockResolvedValue({ status: 200 });
    return {
      client: {
        refreshObject: jest.fn().mockResolvedValue({ status: 200 }),
        findBySerial: jest.fn().mockResolvedValue(device),
        setParameterValues: spv,
        addObject: jest.fn().mockResolvedValue({ status: 200 }),
      },
      spv,
    };
  }

  function ctxFor(
    device: Record<string, unknown>,
    over: Partial<OnuModelProvisionCtx> = {},
  ): {
    ctx: OnuModelProvisionCtx;
    preload: jest.Mock;
    reboot: jest.Mock;
    reachable: jest.Mock;
    spv: jest.Mock;
  } {
    const { client, spv } = fakeClient(device);
    const preload = jest.fn().mockResolvedValue('preload ok');
    const reboot = jest
      .fn()
      .mockResolvedValue({ ok: true, note: 'ONU reiniciada (1ª vez)' });
    const reachable = jest.fn().mockResolvedValue(false);
    const ctx = {
      sn: 'HWTC3CD28AB2',
      onuType: 'EG8145X6-10',
      acsModel: 'EG8145X6',
      client: client as never,
      deviceId: 'dev-1',
      device,
      wan: WAN_702,
      mgmtIp: '10.0.0.9',
      serviceVlan: 702,
      explicit: false,
      preloadConnReq: preload,
      reboot,
      isReachable: reachable,
      ...over,
    } as OnuModelProvisionCtx;
    return { ctx, preload, reboot, reachable, spv };
  }

  it('no reinicia ni toca nada si el servicio ya está aplicado', async () => {
    const device = ispTemplateDevice({
      vlan: 702,
      ip: '40.40.21.64',
      dns: '8.8.8.8,8.8.4.4',
    });
    const { ctx, preload, reboot, reachable, spv } = ctxFor(device);
    const result = await huaweiHguVeipHandler.provision!(ctx);
    expect(result.ok).toBe(true);
    expect(reachable).not.toHaveBeenCalled();
    expect(preload).not.toHaveBeenCalled();
    expect(reboot).not.toHaveBeenCalled();
    expect(spv).not.toHaveBeenCalled();
  });

  it('con IP+VLAN bien pero DNS vacío reaplica (no sale temprano)', async () => {
    const device = ispTemplateDevice({
      vlan: 702,
      ip: '40.40.21.64',
      dns: '',
    });
    const { ctx, preload, reboot, spv } = ctxFor(device, {
      isReachable: jest.fn().mockResolvedValue(true),
    });
    expect(isServiceWanApplied(device, WAN_702)).toBe(false);
    const result = await huaweiHguVeipHandler.provision!(ctx);
    expect(preload).not.toHaveBeenCalled();
    expect(reboot).not.toHaveBeenCalled();
    expect(spv).toHaveBeenCalled();
    expect(result.ok).toBe(true);
    expect(result.notes.some((n) => /DNS .*hoja sola/.test(n))).toBe(true);
  });

  it('rompe el deadlock (preload + reboot) y aplica plantilla si no es manejable', async () => {
    const device = ispTemplateDevice();
    const { ctx, preload, reboot, spv } = ctxFor(device);
    const result = await huaweiHguVeipHandler.provision!(ctx);
    expect(preload).toHaveBeenCalledTimes(1);
    expect(reboot).toHaveBeenCalledTimes(1);
    // Aplica la plantilla sobre la WAN INTERNET existente, encolada sin wait.
    expect(spv).toHaveBeenCalled();
    expect(spv.mock.calls[0]?.[2]).toEqual({ wait: false });
    expect(result.ok).toBe(true);
    expect(result.notes.join(' ')).toContain('preload ok');
  });

  it('salta el deadlock cuando el CPE ya es manejable', async () => {
    const device = ispTemplateDevice();
    const { ctx, preload, reboot, spv } = ctxFor(device, {
      isReachable: jest.fn().mockResolvedValue(true),
    });
    await huaweiHguVeipHandler.provision!(ctx);
    expect(preload).not.toHaveBeenCalled();
    expect(reboot).not.toHaveBeenCalled();
    expect(spv).toHaveBeenCalled();
    expect(spv.mock.calls[0]?.[2]).toEqual({ wait: true });
  });

  it('con sólo WAN TR069 crea un WANConnectionDevice nuevo (HG8145X6)', async () => {
    const device = mgmtOnlyDevice();
    const addObject = jest.fn().mockResolvedValue({ status: 200 });
    // Tras AddObject WCD, el árbol gana WANConnectionDevice.2 / WANIPConnection.1
    const afterAdd = {
      InternetGatewayDevice: {
        DeviceInfo: { ModelName: leaf('HG8145X6') },
        WANDevice: {
          1: {
            WANConnectionDevice: {
              1: {
                WANIPConnection: {
                  1: {
                    Name: leaf('OLT_C_TR069_Static_WAN'),
                    X_HW_SERVICELIST: leaf('TR069'),
                    X_HW_VLAN: leaf(401),
                    ExternalIPAddress: leaf('30.30.20.117'),
                  },
                },
              },
              2: {
                WANIPConnection: {
                  1: {
                    Name: leaf(''),
                    X_HW_SERVICELIST: leaf(''),
                    X_HW_VLAN: leaf(1),
                    ExternalIPAddress: leaf('0.0.0.0'),
                  },
                },
              },
            },
          },
        },
      },
    };
    const findBySerial = jest
      .fn()
      .mockResolvedValueOnce(device)
      .mockResolvedValue(afterAdd);
    const spv = jest.fn().mockResolvedValue({ status: 200 });
    const ctx = {
      sn: 'HWTC68610FAE',
      onuType: 'HG8145X6',
      acsModel: 'HG8145X6',
      client: {
        refreshObject: jest.fn().mockResolvedValue({ status: 200 }),
        findBySerial,
        setParameterValues: spv,
        addObject,
        hasPendingTask: jest.fn().mockResolvedValue(false),
      } as never,
      deviceId: 'dev-hg',
      device,
      wan: WAN_702,
      mgmtIp: '30.30.20.117',
      serviceVlan: 702,
      explicit: true,
      preloadConnReq: jest.fn(),
      reboot: jest.fn(),
      isReachable: jest.fn().mockResolvedValue(true),
    } as OnuModelProvisionCtx;

    const result = await huaweiHg8145x6Handler.ensureServiceWan(ctx);
    expect(result.ok).toBe(true);
    expect(result.notes[0]).toContain('huawei-hg8145x6');
    expect(addObject).toHaveBeenCalledWith(
      'dev-hg',
      'InternetGatewayDevice.WANDevice.1.WANConnectionDevice',
      expect.objectContaining({ connectionRequest: true }),
    );
    const spvPaths = (spv.mock.calls[0]?.[1] as Array<[string]>).map(
      (p) => p[0],
    );
    expect(spvPaths.some((p) => p.includes('WANConnectionDevice.2'))).toBe(
      true,
    );
    expect(
      result.notes.some(
        (n) =>
          n.includes('ensure_service_wcd') || n.includes('WANConnectionDevice'),
      ),
    ).toBe(true);
    expect(
      result.notes.some(
        (n) => n.includes('ensure_service_spv') || n.includes('INTERNET'),
      ),
    ).toBe(true);
  });

  it('multi-WAN sin INTERNET: AddObject WCD nuevo (no bajo TR069)', async () => {
    const device = {
      InternetGatewayDevice: {
        DeviceInfo: { ModelName: leaf('EG8145X6') },
        WANDevice: {
          1: {
            WANConnectionDevice: {
              1: {
                WANIPConnection: {
                  1: {
                    Name: leaf('TR069'),
                    X_HW_SERVICELIST: leaf('TR069'),
                    X_HW_VLAN: leaf(401),
                    ExternalIPAddress: leaf('30.30.20.116'),
                  },
                },
              },
              2: {
                WANIPConnection: {
                  1: {
                    Name: leaf('OTHER'),
                    X_HW_SERVICELIST: leaf('OTHER'),
                    X_HW_VLAN: leaf(10),
                    ExternalIPAddress: leaf('0.0.0.0'),
                  },
                },
              },
            },
          },
        },
      },
    };
    const afterAdd = {
      InternetGatewayDevice: {
        DeviceInfo: { ModelName: leaf('EG8145X6') },
        WANDevice: {
          1: {
            WANConnectionDevice: {
              1: device.InternetGatewayDevice.WANDevice[1].WANConnectionDevice[1],
              2: device.InternetGatewayDevice.WANDevice[1].WANConnectionDevice[2],
              3: {
                WANIPConnection: {
                  1: {
                    Name: leaf(''),
                    X_HW_SERVICELIST: leaf(''),
                    X_HW_VLAN: leaf(1),
                    ExternalIPAddress: leaf('0.0.0.0'),
                  },
                },
              },
            },
          },
        },
      },
    };
    const addObject = jest.fn().mockResolvedValue({ status: 200 });
    const spv = jest.fn().mockResolvedValue({ status: 200 });
    const ctx = {
      sn: 'HWTC3CD28AB2',
      onuType: 'EG8145X6-10',
      acsModel: 'EG8145X6',
      client: {
        refreshObject: jest.fn().mockResolvedValue({ status: 200 }),
        findBySerial: jest
          .fn()
          .mockResolvedValueOnce(device)
          .mockResolvedValue(afterAdd),
        setParameterValues: spv,
        addObject,
        hasPendingTask: jest.fn().mockResolvedValue(false),
      } as never,
      deviceId: 'dev-1',
      device,
      wan: WAN_702,
      mgmtIp: '30.30.20.116',
      serviceVlan: 702,
      explicit: true,
      preloadConnReq: jest.fn(),
      reboot: jest.fn(),
      isReachable: jest.fn().mockResolvedValue(true),
    } as OnuModelProvisionCtx;

    const result = await huaweiHg8145x6Handler.ensureServiceWan(ctx);
    expect(result.ok).toBe(true);
    expect(addObject.mock.calls[0]?.[1]).toBe(
      'InternetGatewayDevice.WANDevice.1.WANConnectionDevice',
    );
    const spvConn = (spv.mock.calls[0]?.[1] as Array<[string]>)[0]?.[0] ?? '';
    expect(spvConn).toContain('WANConnectionDevice.3');
    expect(spvConn).not.toContain('WANConnectionDevice.1.WANIPConnection');
  });
});

describe('decideModelPrepReboot', () => {
  const now = Date.parse('2026-08-05T12:00:00Z');

  it('permite el primer reinicio del poller', () => {
    expect(decideModelPrepReboot({}, { force: false, now }).allow).toBe(true);
  });

  it('bloquea al poller por encima del máximo de reinicios', () => {
    const d = decideModelPrepReboot(
      { reboots: 2, lastRebootAt: new Date(now - 60 * 60_000).toISOString() },
      { force: false, now },
    );
    expect(d.allow).toBe(false);
  });

  it('bloquea al poller dentro del intervalo mínimo', () => {
    const d = decideModelPrepReboot(
      { reboots: 1, lastRebootAt: new Date(now - 60_000).toISOString() },
      { force: false, now },
    );
    expect(d.allow).toBe(false);
  });

  it('una acción explícita puede forzar aunque el poller esté topado', () => {
    const d = decideModelPrepReboot(
      { reboots: 5, lastRebootAt: new Date(now - 10 * 60_000).toISOString() },
      { force: true, now },
    );
    expect(d.allow).toBe(true);
  });

  it('la guarda anti doble clic frena un forzado inmediato', () => {
    const d = decideModelPrepReboot(
      { reboots: 0, lastRebootAt: new Date(now - 30_000).toISOString() },
      { force: true, now },
    );
    expect(d.allow).toBe(false);
  });
});

describe('resolveOnuDriver (library → brand generic)', () => {
  it('HG8145X6 → library huawei-hg8145x6', () => {
    expect(
      resolveOnuDriver({
        sn: 'HWTC68610FAE',
        onuType: 'HG8145X6',
      })?.id,
    ).toBe('huawei-hg8145x6');
  });

  it('HG8245W5 → library huawei-hgu-veip', () => {
    expect(
      resolveOnuDriver({
        sn: 'HWTC13899DA1',
        onuType: 'HG8245W5',
      })?.id,
    ).toBe('huawei-hgu-veip');
  });

  it('ZTE F6600P → generic-zte (sin library)', () => {
    expect(
      resolveOnuDriver({
        sn: 'ZTEGD7180770',
        onuType: 'F6600P',
      })?.id,
    ).toBe('generic-zte');
  });

  it('FiberHome HG6244C → generic-fiberhome', () => {
    expect(
      resolveOnuDriver({
        sn: 'FHTT12345678',
        onuType: 'HG6243C',
      })?.id,
    ).toBe('generic-fiberhome');
  });

  it('FiberHome HG6143D (OLT mal etiquetado F600) → library', () => {
    expect(
      resolveOnuDriver({
        sn: 'FHTT964E6978',
        onuType: 'F600',
        acsModel: 'HG6143D',
      })?.id,
    ).toBe('fiberhome-hg6143d');
  });

  it('Tenda HG9 (TDTC…) → library tenda-hg9', () => {
    expect(
      resolveOnuDriver({
        sn: 'TDTC353E9A98',
        onuType: 'HG9',
        acsModel: 'HG9',
      })?.id,
    ).toBe('tenda-hg9');
  });

  it('resolveOnuDriverForModel preview por vendor+modelo', () => {
    expect(
      resolveOnuDriverForModel({
        vendor: 'fiberhome',
        model: 'HG6143D',
      }).provisionScriptId,
    ).toBe('fiberhome-hg6143d');
    expect(
      resolveOnuDriverForModel({
        vendor: 'zte',
        model: 'F600',
      }).provisionScriptKind,
    ).toBe('generic');
    expect(
      resolveOnuDriverForModel({
        vendor: 'huawei',
        model: 'HG8145X6',
      }).provisionScriptId,
    ).toBe('huawei-hg8145x6');
  });

  it('ZTE F600 real → generic-zte (no FiberHome)', () => {
    expect(
      resolveOnuDriver({
        sn: 'ZTEG12345678',
        onuType: 'F600',
      })?.id,
    ).toBe('generic-zte');
  });

  it('resolveOnuModelHandler sigue siendo solo library', () => {
    expect(
      resolveOnuModelHandler({ sn: 'ZTEGD7180770', onuType: 'F6600P' }),
    ).toBeNull();
    expect(
      resolveOnuModelHandler({ sn: 'HWTC13899DA1', onuType: 'HG8245W5' })?.id,
    ).toBe('huawei-hgu-veip');
  });
});

describe('fiberhome-hg6143d library', () => {
  function fhDevice() {
    return {
      _deviceId: { _ProductClass: 'HG6143D' },
      InternetGatewayDevice: {
        WANDevice: {
          1: {
            WANConnectionDevice: {
              1: {
                X_FH_WANGponLinkConfig: { VLANID: leaf(701) },
                WANIPConnection: {
                  1: {
                    X_FH_ServiceList: leaf('INTERNET'),
                    ExternalIPAddress: leaf('40.40.20.5'),
                    DNSServers: leaf('8.8.8.8,8.8.4.4'),
                    X_FH_LanInterface: leaf(
                      'InternetGatewayDevice.LANDevice.1.LANEthernetInterfaceConfig.1',
                    ),
                  },
                },
              },
              2: {
                X_FH_WANGponLinkConfig: { VLANID: leaf(401) },
                WANIPConnection: {
                  1: {
                    X_FH_ServiceList: leaf('TR069'),
                    ExternalIPAddress: leaf('30.30.20.5'),
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

  it('matches FHTT + HG6143D (aunque onuType sea F600)', () => {
    expect(
      matchesFiberhomeHg6143d({
        sn: 'FHTT964E6978',
        onuType: 'F600',
        acsModel: 'HG6143D',
      }),
    ).toBe(true);
    expect(
      matchesFiberhomeHg6143d({ sn: 'FHTT964E6978', onuType: 'F600' }),
    ).toBe(false);
  });

  it('resolveAcsModelFromDevice usa _ProductClass', () => {
    expect(resolveAcsModelFromDevice(fhDevice())).toBe('HG6143D');
  });

  it('resolveServiceWan elige INTERNET por X_FH_ServiceList', () => {
    const wan = resolveFiberhomeLibraryServiceWan(fhDevice());
    expect(wan?.isMgmt).toBe(false);
    expect(wan?.conn).toContain('WANConnectionDevice.1');
  });

  it('isFiberhomeServiceWanApplied exige vlan+ip+dns', () => {
    const wan: OnuModelProvisionWanPlan = {
      wanIp: '40.40.20.5',
      wanVlan: 701,
      wanGateway: '40.40.20.1',
      wanMask: '255.255.255.0',
      wanDns1: '8.8.8.8',
      wanDns2: '8.8.4.4',
    };
    expect(isFiberhomeServiceWanApplied(fhDevice(), wan)).toBe(true);
    expect(
      isFiberhomeServiceWanApplied(fhDevice(), { ...wan, wanIp: '1.2.3.4' }),
    ).toBe(false);
  });

  it('buildFiberhomeServiceWanParams escribe X_FH_ + GponLinkConfig', () => {
    const conns = listFiberhomeWanIpConnections(fhDevice());
    const internet = findFiberhomeInternetWan(conns)!;
    const params = buildFiberhomeServiceWanParams(internet, {
      wanIp: '40.40.20.9',
      wanVlan: 702,
      wanGateway: '40.40.20.1',
      wanMask: '255.255.255.0',
      wanDns1: '1.1.1.1',
      wanDns2: null,
    });
    const paths = params.map((p) => p[0]);
    expect(paths).toContain(
      `${internet.connDevice}.X_FH_WANGponLinkConfig.VLANID`,
    );
    expect(paths).toContain(`${internet.conn}.X_FH_ServiceList`);
    // LanInterface ya poblado → no reescribir
    expect(paths.some((p) => p.endsWith('X_FH_LanInterface'))).toBe(false);
  });

  it('libraryOwnsWanSelection + skipOmci', () => {
    expect(fiberhomeHg6143dHandler.skipOmciServiceWan).toBe(true);
    expect(
      libraryOwnsWanSelection({
        sn: 'FHTT964E6978',
        onuType: 'HG6143D',
      })?.id,
    ).toBe('fiberhome-hg6143d');
  });

  it('Tenda HG9 owns WAN + skipOmci', () => {
    expect(
      libraryOwnsWanSelection({
        sn: 'TDTC353E9A98',
        onuType: 'HG9',
      })?.id,
    ).toBe('tenda-hg9');
    expect(
      resolveOnuDriver({ sn: 'TDTC353E9A98', onuType: 'HG9' })
        ?.skipOmciServiceWan,
    ).toBe(true);
  });

  it('needsNewFiberhomeWanConnectionDevice si sólo hay TR069', () => {
    const onlyMgmt = {
      InternetGatewayDevice: {
        WANDevice: {
          1: {
            WANConnectionDevice: {
              1: {
                X_FH_WANGponLinkConfig: { VLANID: leaf(401) },
                WANIPConnection: {
                  1: { X_FH_ServiceList: leaf('TR069') },
                },
              },
            },
          },
        },
      },
    };
    expect(
      needsNewFiberhomeWanConnectionDevice(
        listFiberhomeWanIpConnections(onlyMgmt),
      ),
    ).toBe(true);
  });
});
