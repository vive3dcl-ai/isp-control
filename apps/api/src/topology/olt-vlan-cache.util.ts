import type { OltInventoryCache } from './olt-inventory-cache';

/**
 * Add a VLAN to the cached OLT inventory so pickers built from that cache (IP
 * pools) see it right after a push, instead of waiting for the background
 * refresh TTL.
 *
 * Returns null when nothing should change. Notably an empty cache is left
 * alone: `getDeviceVlans` treats "no cached VLANs" as its cue to do a full
 * interactive CLI read, and seeding a single entry would suppress that and hide
 * every other VLAN on the OLT.
 */
export function withVlanInCache(
  cache: OltInventoryCache | null | undefined,
  vlanId: number,
  opts?: { isolated?: boolean; description?: string | null },
): OltInventoryCache | null {
  if (!Number.isInteger(vlanId) || vlanId < 1 || vlanId > 4094) return null;
  const cached = cache?.vlans;
  if (!cache || !cached?.length) return null;
  if (cached.some((v) => v.vlanId === vlanId)) return null;

  return {
    ...cache,
    vlans: [
      ...cached,
      {
        vlanId,
        description: opts?.description ?? null,
        isolated: opts?.isolated ?? true,
        usedForIptv: false,
        onuCount: 0,
        isSystem: vlanId === 1,
      },
    ].sort((a, b) => a.vlanId - b.vlanId),
  };
}
