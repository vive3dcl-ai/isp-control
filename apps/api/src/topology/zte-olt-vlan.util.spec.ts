import {
  mergeVlanCatalogs,
  parseVlansFromRunningConfig,
  parseVlansFromShowVlan,
} from './zte-olt-vlan.util';

describe('zte-olt-vlan.util', () => {
  it('parses show vlan table rows', () => {
    const text = `
vlanid   status   name
1        enable
100      enable   INTERNET
200      enable   IPTV
`;
    const rows = parseVlansFromShowVlan(text);
    expect(rows.map((r) => r.vlanId)).toEqual([1, 100, 200]);
    expect(rows.find((r) => r.vlanId === 100)?.description).toBe('INTERNET');
  });

  it('merges show vlan names with running-config isolation', () => {
    const show = parseVlansFromShowVlan(`
1 enable Sistema
100 enable CLIENTS
`);
    const cfg = parseVlansFromRunningConfig(`
vlan 100
 name CLIENTS
 all-to-all
!
interface gpon-olt_1/2/1
 switchport vlan 100 tag
!
`);
    const merged = mergeVlanCatalogs(show, cfg);
    const v100 = merged.find((r) => r.vlanId === 100);
    expect(v100?.description).toBe('CLIENTS');
    expect(v100?.isolated).toBe(false);
    expect(v100?.defaultPonPorts).toContain('gpon-olt_1/2/1');
  });

  it('does not treat include-only vlan lines as rich catalog alone', () => {
    const bare = parseVlansFromRunningConfig(`
vlan 1
vlan 10
vlan 20
`);
    expect(bare.length).toBeGreaterThan(1);
    expect(bare.every((v) => v.vlanId === 1 || !v.description)).toBe(true);
  });
});
