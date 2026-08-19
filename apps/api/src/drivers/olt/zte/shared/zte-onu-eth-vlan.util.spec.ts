import { parseOmciEthPortVlans } from './zte-onu-eth-vlan.util';

describe('parseOmciEthPortVlans', () => {
  it('parses tag/untag bindings', () => {
    const raw = `
      vlan port eth_0/1 mode untag vlan 1100
      vlan port eth_0/3 mode tag vlan 200
      vlan port eth_0/4 mode hybrid
    `;
    expect(parseOmciEthPortVlans(raw)).toEqual([
      { portIndex: 1, mode: 'untag', vlanId: 1100 },
      { portIndex: 3, mode: 'tag', vlanId: 200 },
      { portIndex: 4, mode: 'hybrid', vlanId: null },
    ]);
  });

  it('keeps the last binding per port', () => {
    const raw = `
      vlan port eth_0/2 mode tag vlan 80
      vlan port eth_0/2 mode untag vlan 701
    `;
    expect(parseOmciEthPortVlans(raw)).toEqual([
      { portIndex: 2, mode: 'untag', vlanId: 701 },
    ]);
  });
});
