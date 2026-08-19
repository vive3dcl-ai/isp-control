import {
  computeIpNetwork,
  enumerateUsableHosts,
  firstFreeIp,
  isIpInUsable,
  MAX_ENUMERATED_HOSTS,
} from './ip-pool.util';

describe('computeIpNetwork', () => {
  it('describes a /24 without the gateway', () => {
    const net = computeIpNetwork('192.168.1.1', 24);
    expect(net).toEqual({
      gateway: '192.168.1.1',
      prefix: 24,
      network: '192.168.1.0',
      broadcast: '192.168.1.255',
      totalUsable: 253,
    });
  });

  it('sizes a /8 arithmetically instead of enumerating it', () => {
    const started = Date.now();
    const net = computeIpNetwork('10.0.0.1', 8);
    expect(net.totalUsable).toBe(16_777_213);
    expect(Date.now() - started).toBeLessThan(200);
  });

  it('rejects prefixes outside /8../30', () => {
    expect(() => computeIpNetwork('10.0.0.1', 7)).toThrow();
    expect(() => computeIpNetwork('10.0.0.1', 31)).toThrow();
  });

  it('rejects a gateway on the network or broadcast address', () => {
    expect(() => computeIpNetwork('192.168.1.0', 24)).toThrow();
    expect(() => computeIpNetwork('192.168.1.255', 24)).toThrow();
  });

  it('rejects malformed addresses', () => {
    expect(() => computeIpNetwork('192.168.1', 24)).toThrow();
    expect(() => computeIpNetwork('192.168.1.300', 24)).toThrow();
  });
});

describe('enumerateUsableHosts', () => {
  const net = computeIpNetwork('192.168.1.1', 24);

  it('lists hosts in order, skipping network, broadcast and gateway', () => {
    const hosts = enumerateUsableHosts(net);
    expect(hosts).toHaveLength(253);
    expect(hosts[0]).toBe('192.168.1.2');
    expect(hosts.at(-1)).toBe('192.168.1.254');
    expect(hosts).not.toContain('192.168.1.1');
  });

  it('pages with offset and limit', () => {
    expect(enumerateUsableHosts(net, { offset: 2, limit: 3 })).toEqual([
      '192.168.1.4',
      '192.168.1.5',
      '192.168.1.6',
    ]);
  });

  it('caps a wide network instead of exhausting the heap', () => {
    const wide = computeIpNetwork('10.0.0.1', 8);
    const hosts = enumerateUsableHosts(wide, { limit: 10_000_000 });
    expect(hosts).toHaveLength(MAX_ENUMERATED_HOSTS);
    expect(hosts[0]).toBe('10.0.0.2');
  });
});

describe('isIpInUsable', () => {
  const net = computeIpNetwork('192.168.1.1', 24);

  it('accepts a host inside the range', () => {
    expect(isIpInUsable('192.168.1.50', net)).toBe(true);
  });

  it('rejects network, broadcast, gateway and outsiders', () => {
    expect(isIpInUsable('192.168.1.0', net)).toBe(false);
    expect(isIpInUsable('192.168.1.255', net)).toBe(false);
    expect(isIpInUsable('192.168.1.1', net)).toBe(false);
    expect(isIpInUsable('192.168.2.5', net)).toBe(false);
  });

  it('rejects garbage without throwing', () => {
    expect(isIpInUsable('nope', net)).toBe(false);
  });
});

describe('firstFreeIp', () => {
  const net = computeIpNetwork('192.168.1.1', 24);

  it('returns the lowest unassigned host', () => {
    expect(firstFreeIp(net, new Set(['192.168.1.2', '192.168.1.3']))).toBe(
      '192.168.1.4',
    );
  });

  it('returns null when the pool is full', () => {
    const all = new Set(enumerateUsableHosts(net));
    expect(firstFreeIp(net, all)).toBeNull();
  });

  it('answers immediately on a wide pool', () => {
    const wide = computeIpNetwork('10.0.0.1', 8);
    const started = Date.now();
    expect(firstFreeIp(wide, new Set(['10.0.0.2']))).toBe('10.0.0.3');
    expect(Date.now() - started).toBeLessThan(200);
  });
});
