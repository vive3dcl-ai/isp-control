import {
  allocateNextMulticastIp,
  parseMulticastCidr,
  parseUdpOutput,
} from './tv-multicast.util';

describe('tv-multicast.util', () => {
  it('parses cidr and allocates sequential ips', () => {
    const range = parseMulticastCidr('239.1.1.0/24', 5000);
    const a = allocateNextMulticastIp(range, []);
    expect(a).toBe('udp://239.1.1.1:5000');
    const b = allocateNextMulticastIp(range, [a]);
    expect(b).toBe('udp://239.1.1.2:5000');
    const c = allocateNextMulticastIp(range, [a, 'udp://239.1.1.5:5000']);
    expect(c).toBe('udp://239.1.1.6:5000');
  });

  it('rejects non-multicast', () => {
    expect(() => parseMulticastCidr('10.0.0.0/24', 5000)).toThrow(/multicast/i);
  });

  it('parses udp output', () => {
    expect(parseUdpOutput('udp://239.1.1.10:5000')).toEqual({
      ip: '239.1.1.10',
      port: 5000,
    });
  });
});
