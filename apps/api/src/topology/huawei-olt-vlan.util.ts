export interface HuaweiVlanRaw {
  vlanId: number;
  description: string | null;
  usedForIptv: boolean;
  isolated: boolean;
  defaultPonPorts: string[];
  onuCount: number;
  isSystem: boolean;
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
