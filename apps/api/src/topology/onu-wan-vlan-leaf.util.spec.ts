import { inspectWanVlanLeaves } from './onu-wan-vlan-leaf.util';

const connDevice = 'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1';
const conn = `${connDevice}.WANIPConnection.1`;

function leaf(value: unknown) {
  return { _value: value, _type: 'xsd:unsignedInt', _writable: true };
}

function deviceWithWan(
  connection: Record<string, unknown>,
  connectionDevice: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    InternetGatewayDevice: {
      WANDevice: {
        1: {
          WANConnectionDevice: {
            1: {
              ...connectionDevice,
              WANIPConnection: { 1: connection },
            },
          },
        },
      },
    },
  };
}

describe('inspección de hojas VLAN WAN', () => {
  it('elige X_HW_VLAN para Huawei y conserva el valor observado', () => {
    const result = inspectWanVlanLeaves(
      deviceWithWan({ X_HW_VLAN: leaf(500) }),
      conn,
      connDevice,
    );

    expect(result.selected).toBe(`${conn}.X_HW_VLAN`);
    expect(result.exposed).toContainEqual({
      path: `${conn}.X_HW_VLAN`,
      value: '500',
    });
  });

  it('prioriza la hoja FiberHome del WANConnectionDevice', () => {
    const result = inspectWanVlanLeaves(
      deviceWithWan(
        { VLANID: leaf(80) },
        { X_FH_WANGponLinkConfig: { VLANID: leaf(701) } },
      ),
      conn,
      connDevice,
    );

    expect(result.selected).toBe(`${connDevice}.X_FH_WANGponLinkConfig.VLANID`);
  });

  it('admite una hoja propietaria nueva y segura publicada por el modelo', () => {
    const result = inspectWanVlanLeaves(
      deviceWithWan({ X_VENDOR_VLANID: leaf(80) }),
      conn,
      connDevice,
    );

    expect(result.selected).toBe(`${conn}.X_VENDOR_VLANID`);
  });

  it('muestra pero no selecciona hojas VLAN peligrosas', () => {
    const result = inspectWanVlanLeaves(
      deviceWithWan({ X_VENDOR_MultiCastVLAN: leaf(100) }),
      conn,
      connDevice,
    );

    expect(result.selected).toBeNull();
    expect(result.exposed).toEqual([]);
  });
});
