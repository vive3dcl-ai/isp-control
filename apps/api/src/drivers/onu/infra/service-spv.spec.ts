import { applyGenericServiceSpv } from './service-spv';
import { OMCI_BRIDGE_PARAM_OWNERS } from '../param-owners';
import type { GenieAcsNbiClient } from '../../../topology/shared/genieacs-nbi.client';
import type { WanConnectionRef } from './wan-datamodel';

const leaf = (value: unknown) => ({ _value: value });

const CONN =
  'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1';

function tr098Device(): Record<string, unknown> {
  return {
    InternetGatewayDevice: {
      WANDevice: {
        1: {
          WANConnectionDevice: {
            1: {
              WANIPConnection: {
                1: {
                  Enable: leaf(true),
                  ExternalIPAddress: leaf('40.40.21.3'),
                  SubnetMask: leaf('255.255.255.0'),
                  DefaultGateway: leaf('40.40.21.1'),
                  DNSServers: leaf('8.8.8.8'),
                  NATEnabled: leaf(true),
                  ConnectionType: leaf('IP_Routed'),
                  AddressingType: leaf('Static'),
                  VLANID: leaf(350),
                  X_HW_VLAN: leaf(350),
                },
              },
            },
          },
        },
      },
    },
  };
}

function mockClient(device: Record<string, unknown>) {
  const writes: Array<Array<[string, unknown, string?]>> = [];
  const client = {
    refreshObject: jest.fn(async () => undefined),
    findBySerial: jest.fn(async () => device),
    findDevices: jest.fn(async () => [device]),
    setParameterValues: jest.fn(async (_id: string, params: Array<[string, unknown, string?]>) => {
      writes.push(params);
      return { status: 200 };
    }),
  };
  return { client: client as unknown as GenieAcsNbiClient, writes };
}

const wan = {
  wanIp: '40.40.21.3',
  wanVlan: 702,
  wanGateway: '40.40.21.1',
  wanMask: '255.255.255.0',
  wanDns1: '8.8.8.8',
  wanDns2: null as string | null,
};

const found: WanConnectionRef = {
  model: 'tr098',
  conn: CONN,
  connDevice: 'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1',
  isMgmt: false,
};

describe('applyGenericServiceSpv owners', () => {
  it('generic-zte / VLAN OMCI: no escribe X_HW_VLAN ni VLANID', async () => {
    const device = tr098Device();
    const { client, writes } = mockClient(device);
    const notes = await applyGenericServiceSpv({
      client,
      deviceId: 'dev',
      device,
      sn: 'ZTEGD71F2028',
      wan,
      found,
      owners: OMCI_BRIDGE_PARAM_OWNERS,
    });
    expect(notes).toMatch(/dueño OMCI/);
    const paths = writes.flat().map((p) => p[0]);
    expect(paths.some((p) => p.endsWith('.VLANID') || p.endsWith('.X_HW_VLAN'))).toBe(
      false,
    );
  });
});
