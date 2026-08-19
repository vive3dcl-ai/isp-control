import { parseHuaweiOntEthPortVlans } from './huawei-olt-vlan.util';

describe('parseHuaweiOntEthPortVlans', () => {
  it('parses ETH rows with native vlan', () => {
    const text = `
  F/S/P   ONT-ID  Port-Type  Port-ID  Native-VLAN  Priority
  0/2/4   12      ETH        1        701          0
  0/2/4   12      ETH        4        801          0
  0/2/4   12      ETH        2        -            0
`;
    expect(parseHuaweiOntEthPortVlans(text)).toEqual([
      { portIndex: 1, vlanId: 701, mode: 'untag' },
      { portIndex: 2, vlanId: null, mode: null },
      { portIndex: 4, vlanId: 801, mode: 'untag' },
    ]);
  });

  it('parses compact native-vlan lines', () => {
    const text = `
port 3 native-vlan 801
ETH 5 vlan 100
`;
    expect(parseHuaweiOntEthPortVlans(text)).toEqual([
      { portIndex: 3, vlanId: 801, mode: 'untag' },
      { portIndex: 5, vlanId: 100, mode: 'untag' },
    ]);
  });

  it('returns empty for unrelated output', () => {
    expect(parseHuaweiOntEthPortVlans('Failure: 0\nCommand is being executed')).toEqual(
      [],
    );
  });
});
