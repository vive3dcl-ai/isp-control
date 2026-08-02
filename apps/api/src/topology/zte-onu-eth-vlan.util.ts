/**
 * Parse `vlan port eth_0/N mode tag|untag|hybrid vlan VID` from OMCI dumps.
 */
export type OmciEthPortVlan = {
  portIndex: number;
  mode: 'tag' | 'untag' | 'hybrid';
  vlanId: number | null;
};

export function parseOmciEthPortVlans(raw: string): OmciEthPortVlan[] {
  const out = new Map<number, OmciEthPortVlan>();
  const re =
    /vlan\s+port\s+eth_0\/(\d+)\s+mode\s+(tag|untag|hybrid)(?:\s+vlan\s+(\d+))?/gi;
  for (const m of raw.matchAll(re)) {
    const portIndex = Number(m[1]);
    const mode = m[2].toLowerCase() as 'tag' | 'untag' | 'hybrid';
    const vlanId = m[3] ? Number(m[3]) : null;
    if (!Number.isFinite(portIndex) || portIndex < 1) continue;
    out.set(portIndex, {
      portIndex,
      mode,
      vlanId: vlanId != null && Number.isFinite(vlanId) ? vlanId : null,
    });
  }
  return [...out.values()].sort((a, b) => a.portIndex - b.portIndex);
}
