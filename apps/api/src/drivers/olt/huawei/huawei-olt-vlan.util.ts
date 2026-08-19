export interface HuaweiVlanRaw {
  vlanId: number;
  description: string | null;
  usedForIptv: boolean;
  isolated: boolean;
  defaultPonPorts: string[];
  onuCount: number;
  isSystem: boolean;
}

export type HuaweiOntEthPortVlan = {
  portIndex: number;
  vlanId: number | null;
  /** UI/API: native-vlan = acceso untagged hacia el CPE. */
  mode: 'tag' | 'untag' | 'hybrid' | null;
};

/**
 * Parsea `display ont port attribute` / `display ont port native-vlan`.
 * Acepta filas ETH con Native-VLAN o columnas Port-ID + VLAN.
 */
export function parseHuaweiOntEthPortVlans(
  text: string,
): HuaweiOntEthPortVlan[] {
  const byPort = new Map<number, HuaweiOntEthPortVlan>();
  const set = (portIndex: number, vlanId: number | null) => {
    if (!Number.isInteger(portIndex) || portIndex < 1 || portIndex > 128) return;
    byPort.set(portIndex, {
      portIndex,
      vlanId,
      mode: vlanId != null ? 'untag' : null,
    });
  };

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || /^[-={]+$/.test(line)) continue;

    // Explicit: "ETH 4 ... Native-VLAN 801" / "eth 4 vlan 801"
    const labeled = line.match(
      /\beth(?:ernet)?\s*(?:port)?\s*[#:=-]?\s*(\d+)\b(?:(?!\beth\b).)*?\b(?:native[- ]?vlan|vlan(?:-id)?)\s*[:=]?\s*(\d+|-+|n\/?a)\b/i,
    );
    if (labeled) {
      const vlanRaw = labeled[2];
      const vlanId = /^\d+$/.test(vlanRaw) ? Number(vlanRaw) : null;
      set(Number(labeled[1]), vlanId && vlanId > 0 ? vlanId : null);
      continue;
    }

    // Table row: ... ETH 4 801 ... or Port-Type ETH Port-ID Native-VLAN
    const ethRow = line.match(
      /\beth\b\s+(\d+)\s+(?:[A-Za-z_][\w-]*\s+)*(\d{1,4}|-+)(?=\s|$)/i,
    );
    if (ethRow) {
      const vlanRaw = ethRow[2];
      const vlanId = /^\d+$/.test(vlanRaw) ? Number(vlanRaw) : null;
      if (vlanId == null || (vlanId >= 1 && vlanId <= 4094)) {
        set(Number(ethRow[1]), vlanId && vlanId > 0 ? vlanId : null);
      }
      continue;
    }

    // Compact: "port 4 native-vlan 801"
    const compact = line.match(
      /\bport(?:id)?\s*[:=]?\s*(\d+)\b(?:(?!\bport\b).)*?\bnative[- ]?vlan\s*[:=]?\s*(\d+)\b/i,
    );
    if (compact) {
      set(Number(compact[1]), Number(compact[2]));
    }
  }

  return [...byPort.values()].sort((a, b) => a.portIndex - b.portIndex);
}

export function parseHuaweiVlans(text: string): HuaweiVlanRaw[] {
  const rows = new Map<number, HuaweiVlanRaw>();
  const ensure = (vlanId: number) => {
    let row = rows.get(vlanId);
    if (!row) {
      row = {
        vlanId,
        description: null,
        usedForIptv: false,
        isolated: false,
        defaultPonPorts: [],
        onuCount: 0,
        isSystem: vlanId === 1,
      };
      rows.set(vlanId, row);
    }
    return row;
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const labeled = line.match(
      /\bvlan(?:\s+id)?\s*[:=]?\s*(\d+)(?:.*?(?:name|description)\s*[:=]\s*(\S.*))?$/i,
    );
    const table = line.match(
      /^(\d{1,4})\s+(?:common|smart|mux|super|active)?\s*(.*)$/i,
    );
    const m = labeled || table;
    if (!m) continue;
    const id = Number(m[1]);
    if (!Number.isInteger(id) || id < 1 || id > 4094) continue;
    const row = ensure(id);
    const name = m[2]?.trim().replace(/^(?:common|smart|active)\s+/i, '');
    if (name && !/^[-—]+$/.test(name)) row.description = name;
  }
  return [...rows.values()].sort((a, b) => a.vlanId - b.vlanId);
}
