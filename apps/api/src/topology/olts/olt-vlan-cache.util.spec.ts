import type { CachedOltVlan, OltInventoryCache } from './olt-inventory-cache';
import { withVlanInCache } from './olt-vlan-cache.util';

function vlan(vlanId: number): CachedOltVlan {
  return {
    vlanId,
    description: `vlan ${vlanId}`,
    isolated: true,
    usedForIptv: false,
    onuCount: 0,
    isSystem: false,
  };
}

function cacheWith(vlanIds: number[]): OltInventoryCache {
  return {
    vlans: vlanIds.map(vlan),
    vlansProbedAt: '2026-08-02T00:00:00.000Z',
  };
}

describe('withVlanInCache', () => {
  it('inserts the VLAN keeping the list sorted', () => {
    const next = withVlanInCache(cacheWith([10, 30]), 20, {
      description: 'clientes',
    });
    expect(next?.vlans?.map((v) => v.vlanId)).toEqual([10, 20, 30]);
    expect(next?.vlans?.find((v) => v.vlanId === 20)).toEqual({
      vlanId: 20,
      description: 'clientes',
      isolated: true,
      usedForIptv: false,
      onuCount: 0,
      isSystem: false,
    });
  });

  it('preserves unrelated cache fields', () => {
    const next = withVlanInCache(cacheWith([10]), 20);
    expect(next?.vlansProbedAt).toBe('2026-08-02T00:00:00.000Z');
  });

  it('reports no change when the VLAN is already cached', () => {
    expect(withVlanInCache(cacheWith([10, 20]), 20)).toBeNull();
  });

  it('leaves an empty cache alone so a full CLI refresh still happens', () => {
    expect(withVlanInCache({ vlans: [] }, 20)).toBeNull();
    expect(withVlanInCache({}, 20)).toBeNull();
    expect(withVlanInCache(null, 20)).toBeNull();
    expect(withVlanInCache(undefined, 20)).toBeNull();
  });

  it('honours an explicit isolated flag', () => {
    const next = withVlanInCache(cacheWith([10]), 20, { isolated: false });
    expect(next?.vlans?.find((v) => v.vlanId === 20)?.isolated).toBe(false);
  });

  it('flags VLAN 1 as a system VLAN', () => {
    const next = withVlanInCache(cacheWith([10]), 1);
    expect(next?.vlans?.find((v) => v.vlanId === 1)?.isSystem).toBe(true);
  });

  it('rejects out-of-range VLAN ids', () => {
    expect(withVlanInCache(cacheWith([10]), 0)).toBeNull();
    expect(withVlanInCache(cacheWith([10]), 4095)).toBeNull();
    expect(withVlanInCache(cacheWith([10]), 1.5)).toBeNull();
  });

  it('does not mutate the cache it was given', () => {
    const cache = cacheWith([10]);
    withVlanInCache(cache, 20);
    expect(cache.vlans?.map((v) => v.vlanId)).toEqual([10]);
  });
});
