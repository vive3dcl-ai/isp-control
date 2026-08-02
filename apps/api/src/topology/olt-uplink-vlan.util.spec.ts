import {
  isUplinkAssignable,
  planUplinkVlanChanges,
  uplinksCarryingVlan,
  withUplinkVlansInCache,
  type UplinkVlanState,
} from './olt-uplink-vlan.util';
import type { OltInventoryCache } from './olt-inventory-cache';

function uplink(
  ifName: string,
  taggedVlans: number[],
  extra?: Partial<UplinkVlanState>,
): UplinkVlanState {
  return {
    ifName,
    adminEnabled: true,
    status: '10G-FullD',
    taggedVlans,
    ...extra,
  };
}

describe('planUplinkVlanChanges', () => {
  const inventory = [
    uplink('gei_1/1/1', [80, 350]),
    uplink('xgei_1/1/2', [80, 401]),
    uplink('gei_1/1/3', []),
  ];

  it('tags only the selected uplinks that do not carry the VLAN yet', () => {
    const plan = planUplinkVlanChanges({
      uplinks: inventory,
      vlanId: 401,
      selected: ['gei_1/1/1', 'xgei_1/1/2'],
    });
    expect(plan.toTag).toEqual(['gei_1/1/1']);
    expect(plan.toUntag).toEqual([]);
    expect(plan.unknown).toEqual([]);
  });

  it('untags uplinks that carry the VLAN and were deselected', () => {
    const plan = planUplinkVlanChanges({
      uplinks: inventory,
      vlanId: 401,
      selected: ['gei_1/1/1'],
    });
    expect(plan.toTag).toEqual(['gei_1/1/1']);
    expect(plan.toUntag).toEqual(['xgei_1/1/2']);
  });

  it('never untags an uplink that does not carry the VLAN', () => {
    const plan = planUplinkVlanChanges({
      uplinks: inventory,
      vlanId: 999,
      selected: [],
    });
    expect(plan.toTag).toEqual([]);
    expect(plan.toUntag).toEqual([]);
  });

  it('reports selections missing from the inventory', () => {
    const plan = planUplinkVlanChanges({
      uplinks: inventory,
      vlanId: 401,
      selected: ['gei_9/9/9'],
    });
    expect(plan.unknown).toEqual(['gei_9/9/9']);
  });

  it('matches ifNames case-insensitively and returns inventory casing', () => {
    const plan = planUplinkVlanChanges({
      uplinks: inventory,
      vlanId: 401,
      selected: ['GEI_1/1/1', '  gei_1/1/3  '],
    });
    expect(plan.unknown).toEqual([]);
    expect(plan.toTag).toEqual(['gei_1/1/1', 'gei_1/1/3']);
  });

  it('deduplicates the selection', () => {
    const plan = planUplinkVlanChanges({
      uplinks: inventory,
      vlanId: 401,
      selected: ['gei_1/1/1', 'gei_1/1/1'],
    });
    expect(plan.toTag).toEqual(['gei_1/1/1']);
  });

  it('trusts the selection when the inventory was never probed', () => {
    const plan = planUplinkVlanChanges({
      uplinks: [],
      vlanId: 401,
      selected: ['gei_1/1/1'],
    });
    expect(plan.toTag).toEqual(['gei_1/1/1']);
    expect(plan.toUntag).toEqual([]);
    expect(plan.unknown).toEqual([]);
  });

  it('reports no work when the trunk already matches', () => {
    const plan = planUplinkVlanChanges({
      uplinks: inventory,
      vlanId: 401,
      selected: ['xgei_1/1/2'],
    });
    expect(plan.toTag).toEqual([]);
    expect(plan.toUntag).toEqual([]);
  });

  it('tolerates uplinks with no taggedVlans field', () => {
    const plan = planUplinkVlanChanges({
      uplinks: [{ ...uplink('gei_1/1/1', []), taggedVlans: undefined as never }],
      vlanId: 401,
      selected: ['gei_1/1/1'],
    });
    expect(plan.toTag).toEqual(['gei_1/1/1']);
  });
});

describe('uplinksCarryingVlan', () => {
  it('lists the trunks that already carry the VLAN', () => {
    expect(
      uplinksCarryingVlan(
        [uplink('gei_1/1/1', [401]), uplink('gei_1/1/2', [80])],
        401,
      ),
    ).toEqual(['gei_1/1/1']);
  });
});

describe('isUplinkAssignable', () => {
  it('offers administratively enabled uplinks even when the link is down', () => {
    expect(
      isUplinkAssignable(uplink('gei_1/1/1', [], { status: 'Down' })),
    ).toBe(true);
  });

  it('skips shutdown uplinks', () => {
    expect(
      isUplinkAssignable(uplink('gei_1/1/1', [], { adminEnabled: false })),
    ).toBe(false);
  });
});

describe('withUplinkVlansInCache', () => {
  const cache: OltInventoryCache = {
    uplinks: [
      {
        ifName: 'gei_1/1/1',
        description: null,
        mediaType: 'fiber',
        adminEnabled: true,
        status: '10G-FullD',
        negotiation: null,
        mtu: null,
        wavelengthNm: null,
        signalDbm: null,
        tempC: null,
        pvidUntag: null,
        mode: 'Trunk',
        taggedVlans: [80, 500],
      },
    ],
    vlans: [],
  };

  it('adds the VLAN to the tagged uplink, keeping the list sorted', () => {
    const next = withUplinkVlansInCache(cache, 401, {
      tagged: ['gei_1/1/1'],
    });
    expect(next?.uplinks?.[0].taggedVlans).toEqual([80, 401, 500]);
  });

  it('removes the VLAN from an untagged uplink', () => {
    const next = withUplinkVlansInCache(cache, 500, {
      untagged: ['gei_1/1/1'],
    });
    expect(next?.uplinks?.[0].taggedVlans).toEqual([80]);
  });

  it('matches ifNames case-insensitively', () => {
    const next = withUplinkVlansInCache(cache, 401, {
      tagged: ['GEI_1/1/1'],
    });
    expect(next?.uplinks?.[0].taggedVlans).toContain(401);
  });

  it('returns null when the VLAN is already where it should be', () => {
    expect(withUplinkVlansInCache(cache, 80, { tagged: ['gei_1/1/1'] })).toBe(
      null,
    );
  });

  it('returns null for uplinks outside the cache', () => {
    expect(
      withUplinkVlansInCache(cache, 401, { tagged: ['gei_9/9/9'] }),
    ).toBe(null);
  });

  it('leaves an unprobed cache alone', () => {
    expect(
      withUplinkVlansInCache({ vlans: [] }, 401, { tagged: ['gei_1/1/1'] }),
    ).toBe(null);
    expect(
      withUplinkVlansInCache(null, 401, { tagged: ['gei_1/1/1'] }),
    ).toBe(null);
  });

  it('rejects out-of-range VLAN ids', () => {
    expect(
      withUplinkVlansInCache(cache, 5000, { tagged: ['gei_1/1/1'] }),
    ).toBe(null);
  });

  it('does nothing without an applied plan', () => {
    expect(withUplinkVlansInCache(cache, 401, {})).toBe(null);
  });
});
