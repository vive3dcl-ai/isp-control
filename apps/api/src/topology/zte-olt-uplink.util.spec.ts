import {
  extractAllInterfaceBlocks,
  extractUplinkIfNames,
  parseUplinkConfigBlock,
} from './zte-olt-uplink.util';
import {
  looksCompleteRunningConfig,
  normalizePonOltIfName,
  parsePonOltIfName,
} from './zte-olt-pon.util';

describe('zte-olt-uplink.util bulk parse', () => {
  const sample = `
!
interface gei_1/1/1
 description UPLINK-CORE
 switchport mode trunk
 switchport vlan 100,200 tag
 mtu 2000
 no shutdown
!
interface xgei_1/1/2
 shutdown
!
interface gpon-olt_1/2/1
 description PON-A
 distance 0 20000
!
ZXAN#`;

  it('extracts all interface blocks from one dump', () => {
    const blocks = extractAllInterfaceBlocks(sample);
    expect(blocks.get('gei_1/1/1')).toMatch(/UPLINK-CORE/);
    expect(blocks.get('xgei_1/1/2')).toMatch(/shutdown/i);
    expect(blocks.get('gpon-olt_1/2/1')).toMatch(/distance/);
  });

  it('parses uplink VLAN tags from block', () => {
    const blocks = extractAllInterfaceBlocks(sample);
    const parsed = parseUplinkConfigBlock(blocks.get('gei_1/1/1') || '');
    expect(parsed.description).toBe('UPLINK-CORE');
    expect(parsed.taggedVlans).toEqual([100, 200]);
    expect(parsed.adminEnabled).toBe(true);
    expect(extractUplinkIfNames(sample)).toEqual(['gei_1/1/1', 'xgei_1/1/2']);
  });

  it('keeps content after aesthetic ! separators inside a block stream', () => {
    const messy = `
interface gei_1/1/1
 description A
 !
 switchport vlan 10 tag
!
ZXAN#`;
    const blocks = extractAllInterfaceBlocks(messy);
    const parsed = parseUplinkConfigBlock(blocks.get('gei_1/1/1') || '');
    expect(parsed.description).toBe('A');
    expect(parsed.taggedVlans).toEqual([10]);
  });

  it('does not absorb trailing global config into the last block', () => {
    const trailing = `
interface gei_1/1/1
 description A
!
shutdown
description GLOBAL
!
ZXAN#`;
    const parsed = parseUplinkConfigBlock(
      extractAllInterfaceBlocks(trailing).get('gei_1/1/1') || '',
    );
    expect(parsed.description).toBe('A');
    expect(parsed.adminEnabled).toBe(true);
  });
});

describe('zte-olt-pon.util normalize', () => {
  it('normalizes SNMP gpon_ to CLI gpon-olt_', () => {
    expect(normalizePonOltIfName('gpon_1/2/3')).toBe('gpon-olt_1/2/3');
    expect(parsePonOltIfName('epon_0/1/2')).toEqual({
      family: 'epon',
      shelf: '0',
      slot: '1',
      port: '2',
    });
  });

  it('rejects truncated running-config without trailing prompt', () => {
    expect(
      looksCompleteRunningConfig(`
interface gei_1/1/1
 description half
`),
    ).toBe(false);
    expect(
      looksCompleteRunningConfig(`
interface gei_1/1/1
 description ok
!
ZXAN#`),
    ).toBe(true);
  });
});
