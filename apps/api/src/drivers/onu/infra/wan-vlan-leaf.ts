import { genieGet, genieNodeExists, strVal } from '../../../topology/shared/genieacs-nbi.client';

export type WanVlanLeafInspection = {
  /** Hoja que se debe escribir según la prioridad conocida por fabricante. */
  selected: string | null;
  /** Hojas VLAN que el modelo realmente publicó, con su valor actual. */
  exposed: Array<{ path: string; value: string | null }>;
};

function objectAt(
  root: Record<string, unknown>,
  path: string,
): Record<string, unknown> | null {
  let current: unknown = root;
  for (const part of path.split('.')) {
    if (!current || typeof current !== 'object') return null;
    current = (current as Record<string, unknown>)[part];
  }
  return current && typeof current === 'object'
    ? (current as Record<string, unknown>)
    : null;
}

function collectVlanLeaves(
  node: Record<string, unknown>,
  base: string,
  out: string[],
  depth = 0,
): void {
  if (depth > 5) return;
  for (const [key, value] of Object.entries(node)) {
    if (key.startsWith('_')) continue;
    const path = `${base}.${key}`;
    if (!value || typeof value !== 'object') continue;
    const record = value as Record<string, unknown>;
    if ('_value' in record) {
      if (
        /(?:^|_)(?:VLAN|VLANID|VID)$/i.test(key) &&
        !/(MULTI|IPV6|DSCP|PBIT|PRIORITY)/i.test(path)
      ) {
        out.push(path);
      }
      continue;
    }
    collectVlanLeaves(record, path, out, depth + 1);
  }
}

/**
 * Examina el árbol que publicó el modelo y elige sólo una hoja VLAN segura.
 *
 * La lista conocida evita escribir por accidente hojas de multicast/IPv6. El
 * escaneo adicional se conserva en `exposed` para diagnóstico: así un modelo
 * nuevo deja visible qué nombres usa sin tocar parámetros desconocidos.
 */
export function inspectWanVlanLeaves(
  device: Record<string, unknown>,
  conn: string,
  connDevice: string,
): WanVlanLeafInspection {
  const known = [
    `${connDevice}.X_FH_WANGponLinkConfig.VLANID`,
    // Tenda HG9 (vendor TDTC): VLAN en el WANConnectionDevice, no en WANIP.
    `${connDevice}.X_TDTC_VLAN`,
    `${conn}.X_HW_VLAN`,
    `${conn}.X_ZTE-COM_VLANID`,
    `${conn}.X_CT-COM_VLAN`,
    `${conn}.VLANID`,
  ];

  const discovered: string[] = [];
  const subtree = objectAt(device, connDevice);
  if (subtree) collectVlanLeaves(subtree, connDevice, discovered);

  const knownExposed = known.filter((path) => genieNodeExists(device, path));
  const safeDynamic = discovered.filter((path) => {
    if (path.startsWith(`${conn}.`)) {
      const leaf = path.slice(conn.length + 1);
      return leaf === 'VLANID' || /^X_[A-Z0-9-]+_(?:VLAN|VLANID)$/i.test(leaf);
    }
    const relative = path.slice(connDevice.length + 1);
    // X_TDTC_VLAN (hoja plana) o X_VENDOR.LinkConfig.VLANID (anidada)
    return (
      /^X_[A-Z0-9-]+_(?:VLAN|VLANID)$/i.test(relative) ||
      /^X_[A-Z0-9-]+(?:\.[A-Z0-9_-]+)*\.(?:VLAN|VLANID)$/i.test(relative)
    );
  });
  const paths = [...new Set([...knownExposed, ...discovered])];
  return {
    selected: knownExposed[0] ?? safeDynamic[0] ?? null,
    exposed: paths.map((path) => ({
      path,
      value: strVal(genieGet(device, path)),
    })),
  };
}
