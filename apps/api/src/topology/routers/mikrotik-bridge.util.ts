/** Join RouterOS interface lists for bridge vlan tagged/untagged. */
export function formatBridgeIfaceList(ifaces: string[]): string {
  return [...new Set(ifaces.map((s) => s.trim()).filter(Boolean))].join(',');
}

export function parseBridgeIfaceList(raw?: string | null): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export type BridgeVlanMembership = {
  vlanId: number;
  bridge: string;
  tagged: string[];
  untagged: string[];
};

export type BridgePortMembership = {
  interface: string;
  bridge: string;
  pvid: number;
  disabled: boolean;
};

export function mergeBridgeVlanMembership(
  existing: BridgeVlanMembership | null,
  patch: {
    vlanId: number;
    bridge: string;
    addTagged?: string[];
    addUntagged?: string[];
    removeFrom?: string[];
    tagged?: string[];
    untagged?: string[];
  },
): BridgeVlanMembership {
  let tagged = existing?.tagged ? [...existing.tagged] : [];
  let untagged = existing?.untagged ? [...existing.untagged] : [];

  if (patch.tagged) tagged = [...patch.tagged];
  if (patch.untagged) untagged = [...patch.untagged];

  for (const iface of patch.removeFrom ?? []) {
    tagged = tagged.filter((i) => i !== iface);
    untagged = untagged.filter((i) => i !== iface);
  }
  for (const iface of patch.addTagged ?? []) {
    untagged = untagged.filter((i) => i !== iface);
    if (!tagged.includes(iface)) tagged.push(iface);
  }
  for (const iface of patch.addUntagged ?? []) {
    tagged = tagged.filter((i) => i !== iface);
    if (!untagged.includes(iface)) untagged.push(iface);
  }

  return {
    vlanId: patch.vlanId,
    bridge: patch.bridge,
    tagged,
    untagged,
  };
}
