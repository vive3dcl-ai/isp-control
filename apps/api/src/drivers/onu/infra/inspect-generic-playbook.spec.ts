import {
  classifyGenericFamily,
  inspectGenericPlaybook,
  isZteBridgeModel,
  isZteHguModel,
} from './inspect-generic-playbook';

function leaf(value: unknown) {
  return { _value: value };
}

function tr098Internet(opts?: { vlan?: number; ip?: string; name?: string }) {
  const vlan = opts?.vlan ?? 701;
  const ip = opts?.ip ?? '10.20.30.40';
  return {
    InternetGatewayDevice: {
      WANDevice: {
        1: {
          WANConnectionDevice: {
            1: {
              X_HW_VLAN: leaf(vlan),
              WANIPConnection: {
                1: {
                  Name: leaf(opts?.name ?? 'INTERNET'),
                  X_HW_SERVICELIST: leaf('INTERNET'),
                  ExternalIPAddress: leaf(ip),
                  X_HW_VLAN: leaf(vlan),
                },
              },
            },
          },
        },
      },
    },
  };
}

describe('inspectGenericPlaybook', () => {
  it('Tenda SN → familia tenda y reusa WAN INTERNET', () => {
    expect(
      classifyGenericFamily({
        sn: 'TDTCABC12345',
        device: tr098Internet(),
      }),
    ).toBe('tenda');
    const plan = inspectGenericPlaybook({
      sn: 'TDTCABC12345',
      device: tr098Internet({ vlan: 701 }),
      expectedVlan: 701,
    });
    expect(plan.steps).toContain('reuse');
    expect(plan.steps).toContain('spv');
    expect(plan.steps).not.toContain('add');
  });

  it('Huawei sin INTERNET y con WCD → AddObject, no bajo TR069', () => {
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
                  },
                },
              },
            },
          },
        },
      },
    };
    const plan = inspectGenericPlaybook({
      sn: 'HWTC00001111',
      device,
      expectedVlan: 701,
    });
    expect(plan.family).toBe('huawei_hgu');
    expect(plan.steps).toContain('add');
    expect(plan.addObjectParent).toBe(
      'InternetGatewayDevice.WANDevice.1.WANConnectionDevice',
    );
  });

  it('ZTE F670 es HGU; F601 es puente OMCI', () => {
    expect(isZteHguModel('F670L', null)).toBe(true);
    expect(isZteBridgeModel('F601', null)).toBe(true);
    const bridge = inspectGenericPlaybook({
      sn: 'ZTEG00000001',
      onuType: 'F601',
      device: {},
    });
    expect(bridge.family).toBe('zte_bridge');
    expect(bridge.steps).toEqual(['omci']);
  });

  it('sin hoja bind no pide SPV bind', () => {
    const plan = inspectGenericPlaybook({
      sn: 'HWTC00001111',
      device: tr098Internet(),
      expectedVlan: 701,
    });
    expect(plan.bindLeaf).toBeNull();
    expect(plan.steps).not.toContain('bind');
  });

  it('INTERNET con VLAN distinta → junk', () => {
    const plan = inspectGenericPlaybook({
      sn: 'TDTCABC12345',
      device: tr098Internet({ vlan: 41, name: 'INTERNET' }),
      expectedVlan: 701,
    });
    expect(plan.junkWanPath).toBeTruthy();
  });
});
