import {
  decodeSwosHexString,
  decodeSwosPortMask,
  encodeSwosPortMask,
  parseSwosJsObject,
  parseSwosLinks,
  parseSwosSystem,
  parseSwosVlanTable,
  swosVlansByPort,
} from './swos.util';
import {
  formatBridgeIfaceList,
  mergeBridgeVlanMembership,
  parseBridgeIfaceList,
} from './mikrotik-bridge.util';

describe('swos.util', () => {
  it('parses JS-like SwOS payloads', () => {
    const obj = parseSwosJsObject("{id:'506f727431',ip:0x0158a8c0,en:0x03}");
    expect(obj).toEqual({ id: '506f727431', ip: 0x0158a8c0, en: 3 });
  });

  it('decodes hex strings and port masks', () => {
    expect(decodeSwosHexString('506f727431')).toBe('Port1');
    expect(decodeSwosPortMask(0x05, 8)).toEqual([1, 3]);
    expect(encodeSwosPortMask([1, 3])).toBe(0x05);
  });

  it('parses system and link tables', () => {
    const sys = parseSwosSystem({
      id: Buffer.from('Office').toString('hex'),
      ver: Buffer.from('2.17').toString('hex'),
      brd: Buffer.from('CSS326').toString('hex'),
    });
    expect(sys.identity).toBe('Office');
    expect(sys.version).toBe('2.17');
    expect(sys.model).toBe('CSS326');

    const links = parseSwosLinks({
      nm: [
        Buffer.from('Uplink').toString('hex'),
        Buffer.from('Access').toString('hex'),
      ],
      en: 0x03,
      lnk: 0x01,
    });
    expect(links).toHaveLength(2);
    expect(links[0]).toMatchObject({
      portNumber: 1,
      name: 'Uplink',
      enabled: true,
      linkUp: true,
    });
    expect(links[1].linkUp).toBe(false);
  });

  it('maps VLAN membership to ports', () => {
    const vlans = parseSwosVlanTable(
      [
        { vid: 10, mbr: 0x06, nm: Buffer.from('DATA').toString('hex') },
        { vid: 20, mbr: 0x02 },
      ],
      8,
    );
    expect(vlans[0]).toMatchObject({
      vlanId: 10,
      name: 'DATA',
      memberPorts: [2, 3],
    });
    expect(swosVlansByPort(vlans, 2).map((v) => v.vlanId)).toEqual([10, 20]);
  });
});

describe('mikrotik-bridge.util', () => {
  it('formats and parses iface lists', () => {
    expect(formatBridgeIfaceList(['ether2', 'ether1', 'ether2'])).toBe(
      'ether2,ether1',
    );
    expect(parseBridgeIfaceList('ether1, ether2 ether3')).toEqual([
      'ether1',
      'ether2',
      'ether3',
    ]);
  });

  it('merges tagged/untagged membership', () => {
    const merged = mergeBridgeVlanMembership(
      { vlanId: 100, bridge: 'bridge', tagged: ['ether1'], untagged: ['ether2'] },
      {
        vlanId: 100,
        bridge: 'bridge',
        addTagged: ['ether2'],
        addUntagged: ['ether3'],
      },
    );
    expect(merged.tagged.sort()).toEqual(['ether1', 'ether2']);
    expect(merged.untagged).toEqual(['ether3']);
  });
});
