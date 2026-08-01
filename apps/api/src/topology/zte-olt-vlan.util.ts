/** Parsers for ZTE OLT VLAN catalogue (SmartOLT-style). */

export interface ZteVlanRaw {
  vlanId: number;
  description: string | null;
  usedForIptv: boolean;
  /** ONUs in this VLAN cannot talk to each other (no `all-to-all`). */
  isolated: boolean;
  /** PON ifNames that already tag this VLAN (from running-config). */
  defaultPonPorts: string[];
  onuCount: number;
  /** VLAN 1 — default del sistema ZTE (siempre presente). */
  isSystem: boolean;
}

export type OltVlanMetaFlags = {
  isolated?: boolean;
};

export type OltVlanMetaMap = Record<string, OltVlanMetaFlags>;

/**
 * Lee la respuesta de `no vlan N`. La OLT la rechaza si la VLAN está en uso
 * (service-port, interfaz, uplink) y sin mirar la salida el panel informaba
 * “eliminada” con la VLAN todavía configurada.
 */
export function interpretNoVlanOutput(out: string): {
  ok: boolean;
  /** La VLAN ya no estaba: borrar es idempotente. */
  absent: boolean;
  detail: string | null;
} {
  const absent = /not\s+exist|no\s+such|not\s+found/i.test(out);
  const rejected =
    /%\s*\w*\s*Error|Invalid input|Unknown command|Incomplete|Failed|is\s+used|in\s+use/i.test(
      out,
    );
  if (absent || !rejected) return { ok: true, absent, detail: null };
  const detail =
    out
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => /%|error|invalid|fail|used|in use/i.test(line)) ?? null;
  return { ok: false, absent: false, detail };
}

/** Extract `vlan N` blocks + related global flags from running-config. */
export function parseVlansFromRunningConfig(cfg: string): ZteVlanRaw[] {
  const byId = new Map<number, ZteVlanRaw>();

  const ensure = (id: number): ZteVlanRaw => {
    let row = byId.get(id);
    if (!row) {
      row = {
        vlanId: id,
        description: null,
        usedForIptv: false,
        // ZTE default: no `all-to-all` in the vlan block means ONUs are isolated.
        isolated: true,
        defaultPonPorts: [],
        onuCount: 0,
        isSystem: id === 1,
      };
      byId.set(id, row);
    }
    return row;
  };

  // VLAN 1 is always present on ZTE (system / default) even if omitted from config.
  ensure(1);

  const lines = cfg.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s*vlan\s+(\d+)\s*$/i);
    if (!m) continue;
    const id = Number(m[1]);
    if (!Number.isInteger(id) || id < 1 || id > 4094) continue;
    const row = ensure(id);
    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j].trim();
      if (!line || line === '!') break;
      if (/^vlan\s+\d+/i.test(line) || /^interface\s+/i.test(line)) break;
      if (/^[\w.-]+#/.test(line)) break;
      const name = line.match(/^name\s+(.+)$/i);
      if (name) {
        row.description = name[1].trim();
        continue;
      }
      const desc = line.match(/^description\s+(.+)$/i);
      if (desc) {
        row.description = desc[1].trim();
        continue;
      }
      if (/^all-to-all$/i.test(line) || /^lan-to-lan\s+enable$/i.test(line)) {
        row.isolated = false;
      }
      if (/^isolate(\s+enable)?$/i.test(line)) {
        row.isolated = true;
      }
    }
  }

  // Also pick up VLANs only referenced as tagged on uplinks / PON
  for (const line of lines) {
    const tag = line.match(
      /^\s*switchport\s+vlan\s+(\d+(?:[,-]\d+)*)\s+tag\b/i,
    );
    if (tag) {
      for (const v of expandSimpleVlanList(tag[1])) ensure(v);
    }
  }

  for (const line of lines) {
    const mv = line.match(/^\s*igmp\s+mvlan\s+(\d+)\b/i);
    if (mv) {
      const row = ensure(Number(mv[1]));
      row.usedForIptv = true;
    }
  }

  // Default for PON: gpon-olt / epon-olt with switchport vlan N tag
  let currentIf: string | null = null;
  for (const raw of lines) {
    const ifM = raw.match(/^\s*interface\s+((?:g|e)pon-olt_[\d/]+)\s*$/i);
    if (ifM) {
      currentIf = ifM[1];
      continue;
    }
    if (/^\s*interface\s+/i.test(raw) || /^\s*!\s*$/.test(raw)) {
      currentIf = null;
      continue;
    }
    if (!currentIf) continue;
    const tag = raw.match(/^\s*switchport\s+vlan\s+(\d+(?:[,-]\d+)*)\s+tag\b/i);
    if (!tag) continue;
    for (const v of expandSimpleVlanList(tag[1])) {
      const row = ensure(v);
      if (!row.defaultPonPorts.includes(currentIf)) {
        row.defaultPonPorts.push(currentIf);
      }
    }
  }

  // ONU count: unique onu ifaces that reference this VLAN
  const onuByVlan = new Map<number, Set<string>>();
  let onuIf: string | null = null;
  for (const raw of lines) {
    const ifM = raw.match(/^\s*interface\s+((?:g|e)pon-onu_[\d/:]+)\s*$/i);
    if (ifM) {
      onuIf = ifM[1];
      continue;
    }
    if (/^\s*interface\s+/i.test(raw) || /^\s*!\s*$/.test(raw)) {
      onuIf = null;
      continue;
    }
    if (!onuIf) continue;
    const refs = [
      ...raw.matchAll(/\buser-vlan\s+(\d+)\b/gi),
      ...raw.matchAll(/\bvlan\s+(\d+)\b/gi),
    ];
    for (const r of refs) {
      const id = Number(r[1]);
      if (!onuByVlan.has(id)) onuByVlan.set(id, new Set());
      onuByVlan.get(id)!.add(onuIf);
      ensure(id);
    }
  }
  for (const [id, set] of onuByVlan) {
    const row = byId.get(id);
    if (row) row.onuCount = set.size;
  }

  const vlan1 = byId.get(1);
  if (vlan1 && !vlan1.description) {
    vlan1.description = 'Sistema';
  }

  return [...byId.values()].sort((a, b) => a.vlanId - b.vlanId);
}

/**
 * Parse ZTE `show vlan` table (id + optional name/status).
 * Formats vary; we accept rows like:
 *   100  enable  INTERNET
 *   VLAN ID: 100  Name: INTERNET
 */
export function parseVlansFromShowVlan(text: string): ZteVlanRaw[] {
  const byId = new Map<number, ZteVlanRaw>();
  const ensure = (id: number): ZteVlanRaw => {
    let row = byId.get(id);
    if (!row) {
      row = {
        vlanId: id,
        description: null,
        usedForIptv: false,
        isolated: true,
        defaultPonPorts: [],
        onuCount: 0,
        isSystem: id === 1,
      };
      byId.set(id, row);
    }
    return row;
  };
  ensure(1);

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || /^(vlanid|vlan\s*id|----)/i.test(trimmed)) continue;

    const colon = trimmed.match(
      /vlan\s*id\s*[:=]\s*(\d+).*?(?:name\s*[:=]\s*(\S+))?/i,
    );
    if (colon) {
      const id = Number(colon[1]);
      if (id >= 1 && id <= 4094) {
        const row = ensure(id);
        if (colon[2] && !/^N\/A$/i.test(colon[2])) {
          row.description = colon[2];
        }
      }
      continue;
    }

    const rowM = trimmed.match(
      /^(\d{1,4})\s+(?:enable|disable|active|inactive)?\s*([A-Za-z0-9._-][A-Za-z0-9._\-\s]*)?$/i,
    );
    if (rowM) {
      const id = Number(rowM[1]);
      if (id >= 1 && id <= 4094) {
        const row = ensure(id);
        const name = rowM[2]?.trim();
        if (name && !/^(enable|disable|active|inactive)$/i.test(name)) {
          row.description = name;
        }
      }
    }
  }

  const vlan1 = byId.get(1);
  if (vlan1 && !vlan1.description) vlan1.description = 'Sistema';
  return [...byId.values()].sort((a, b) => a.vlanId - b.vlanId);
}

/** Prefer running-config detail; keep show-vlan ids/names as fallback. */
export function mergeVlanCatalogs(
  fromShow: ZteVlanRaw[],
  fromCfg: ZteVlanRaw[],
): ZteVlanRaw[] {
  if (!fromCfg.length) return fromShow;
  if (!fromShow.length) return fromCfg;
  const byId = new Map<number, ZteVlanRaw>();
  for (const v of fromShow) byId.set(v.vlanId, { ...v });
  for (const v of fromCfg) {
    const prev = byId.get(v.vlanId);
    if (!prev) {
      byId.set(v.vlanId, { ...v });
      continue;
    }
    byId.set(v.vlanId, {
      ...prev,
      ...v,
      description: v.description || prev.description,
      defaultPonPorts: v.defaultPonPorts.length
        ? v.defaultPonPorts
        : prev.defaultPonPorts,
      onuCount: Math.max(v.onuCount, prev.onuCount),
    });
  }
  return [...byId.values()].sort((a, b) => a.vlanId - b.vlanId);
}

function expandSimpleVlanList(spec: string): number[] {
  const out: number[] = [];
  for (const part of spec
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)) {
    const range = part.match(/^(\d+)-(\d+)$/);
    if (range) {
      const a = Number(range[1]);
      const b = Number(range[2]);
      for (let i = Math.min(a, b); i <= Math.max(a, b); i++) out.push(i);
    } else if (/^\d+$/.test(part)) {
      out.push(Number(part));
    }
  }
  return out;
}
