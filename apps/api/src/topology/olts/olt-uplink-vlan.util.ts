import type { CachedOltUplink, OltInventoryCache } from './olt-inventory-cache';

/** Subset of the uplink inventory needed to reason about VLAN membership. */
export type UplinkVlanState = Pick<
  CachedOltUplink,
  'ifName' | 'adminEnabled' | 'status' | 'taggedVlans'
>;

export type UplinkVlanPlan = {
  /** Uplinks that must get `switchport vlan N tag` (or the Huawei equivalent). */
  toTag: string[];
  /** Uplinks that carry the VLAN today but were deselected. */
  toUntag: string[];
  /** Selected names absent from the inventory — almost always a typo. */
  unknown: string[];
};

function sameIf(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * An uplink is offered for VLAN assignment when it is administratively enabled.
 * A link that is merely physically Down still gets configured on purpose: the
 * fibre may be unplugged while the VLAN is being prepared.
 */
export function isUplinkAssignable(u: UplinkVlanState): boolean {
  return u.adminEnabled !== false;
}

/** ifNames whose trunk already carries `vlanId`, in inventory casing. */
export function uplinksCarryingVlan(
  uplinks: UplinkVlanState[],
  vlanId: number,
): string[] {
  return uplinks
    .filter((u) => (u.taggedVlans ?? []).includes(vlanId))
    .map((u) => u.ifName);
}

/**
 * ¿La VLAN falta en todos los uplinks administrativamente habilitados?
 *
 * Si el inventario está vacío no se puede afirmar: el poller aún no leyó la
 * OLT. En ese caso devolvemos `unknown`.
 */
export function vlanUplinkPresence(
  uplinks: UplinkVlanState[],
  vlanId: number,
): {
  status: 'present' | 'missing' | 'unknown';
  carrying: string[];
  assignable: string[];
} {
  if (!uplinks.length) {
    return { status: 'unknown', carrying: [], assignable: [] };
  }
  const assignable = uplinks.filter(isUplinkAssignable);
  const carrying = uplinksCarryingVlan(assignable, vlanId);
  return {
    status: carrying.length > 0 ? 'present' : 'missing',
    carrying,
    assignable: assignable.map((u) => u.ifName),
  };
}

/**
 * Uplinks sobre los que etiquetar una VLAN nueva en curación automática.
 *
 * Preferimos trunks que ya llevan otras VLANs (el camino de servicio real).
 * Si ninguno tiene VLANs, caemos a todos los habilitados.
 */
export function suggestUplinksToCarryVlan(
  uplinks: UplinkVlanState[],
): string[] {
  const assignable = uplinks.filter(isUplinkAssignable);
  if (!assignable.length) return [];
  const withVlans = assignable.filter((u) => (u.taggedVlans ?? []).length > 0);
  return (withVlans.length ? withVlans : assignable).map((u) => u.ifName);
}

/**
 * Diff the requested uplink set against what the OLT reports today.
 *
 * Only uplinks positively known to carry the VLAN are ever untagged, so a stale
 * or partial selection can never strip a VLAN off a trunk it still needs. When
 * the inventory is empty the cache has simply never been probed: we then tag
 * what was asked and untag nothing rather than block the push.
 */
export function planUplinkVlanChanges(opts: {
  uplinks: UplinkVlanState[];
  vlanId: number;
  selected: string[];
}): UplinkVlanPlan {
  const selected = [
    ...new Set(opts.selected.map((s) => s.trim()).filter(Boolean)),
  ];

  if (!opts.uplinks.length) {
    return { toTag: selected, toUntag: [], unknown: [] };
  }

  const unknown = selected.filter(
    (name) => !opts.uplinks.some((u) => sameIf(u.ifName, name)),
  );

  const isSelected = (ifName: string) =>
    selected.some((name) => sameIf(name, ifName));

  const toTag: string[] = [];
  const toUntag: string[] = [];
  for (const u of opts.uplinks) {
    const carries = (u.taggedVlans ?? []).includes(opts.vlanId);
    if (isSelected(u.ifName)) {
      if (!carries) toTag.push(u.ifName);
    } else if (carries) {
      toUntag.push(u.ifName);
    }
  }

  return { toTag, toUntag, unknown };
}

/**
 * Reflect an applied plan in the cached inventory so the uplink selector and
 * the VLAN column show the new membership immediately, instead of waiting for
 * the background CLI refresh (OLT_INVENTORY_CONFIG_TTL_MS).
 *
 * Returns null when there is nothing cached to update or nothing changed.
 */
export function withUplinkVlansInCache(
  cache: OltInventoryCache | null | undefined,
  vlanId: number,
  applied: { tagged?: string[]; untagged?: string[] },
): OltInventoryCache | null {
  if (!Number.isInteger(vlanId) || vlanId < 1 || vlanId > 4094) return null;
  const uplinks = cache?.uplinks;
  if (!cache || !uplinks?.length) return null;

  const tagged = applied.tagged ?? [];
  const untagged = applied.untagged ?? [];
  if (!tagged.length && !untagged.length) return null;

  let changed = false;
  const next = uplinks.map((u) => {
    const current = u.taggedVlans ?? [];
    const carries = current.includes(vlanId);
    const shouldTag = tagged.some((name) => sameIf(name, u.ifName));
    const shouldUntag = untagged.some((name) => sameIf(name, u.ifName));

    if (shouldTag && !carries) {
      changed = true;
      return { ...u, taggedVlans: [...current, vlanId].sort((a, b) => a - b) };
    }
    if (shouldUntag && carries) {
      changed = true;
      return { ...u, taggedVlans: current.filter((v) => v !== vlanId) };
    }
    return u;
  });

  return changed ? { ...cache, uplinks: next } : null;
}
