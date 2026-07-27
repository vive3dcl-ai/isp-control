#!/usr/bin/env node
/**
 * One-shot: fix MikroTik path for lab TR069 reverse OVPN + VLAN 601 mgmt.
 * Touches ONLY: OVPN-related firewall, VLAN 601 L3, bridge vlan (if needed),
 * and forward between mgmt VLAN and ACS tunnel client.
 *
 * Usage (api container):
 *   node /lab/fix-mikrotik-tr069-path.mjs
 */
const { Client } = require('pg');
const { RouterOsApiClient } = require('../apps/api/dist/topology/routeros-api.client.js');

const MIKROTIK_ID = process.env.LAB_MIKROTIK_ID || '370cd177-067d-4ed4-a729-c831d7f9766d';
const MGMT_VLAN = Number(process.env.LAB_MGMT_VLAN || 601);
const MGMT_GW = process.env.LAB_MGMT_GW || '10.60.60.1';
const MGMT_PREFIX = Number(process.env.LAB_MGMT_PREFIX || 24);
const ACS_IP = process.env.LAB_ACS_IP || '10.69.69.2';
const OVPN_NET = process.env.LAB_OVPN_NET || '10.69.69.0/24';
const COMMENT = 'isp-control lab tr069 path';

async function ros(client, words) {
  const replies = await client.write(words);
  const trap = replies.find((r) => r.type === '!trap' || r.type === '!fatal');
  if (trap) {
    return { ok: false, error: trap.attrs.message || JSON.stringify(trap.attrs), replies };
  }
  return {
    ok: true,
    rows: replies.filter((r) => r.type === '!re').map((r) => r.attrs),
    replies,
  };
}

function summarize(rows, keys) {
  return (rows || []).map((r) => {
    const o = {};
    for (const k of keys) o[k] = r[k] ?? r[`.${k}`] ?? '';
    o.id = r['.id'];
    return o;
  });
}

async function ensureFilter(client, attrs) {
  const existing = await client.print('/ip/firewall/filter');
  const hit = existing.find((r) => (r.comment || '') === attrs.comment);
  if (hit) {
    console.log('filter_exists', attrs.comment, hit['.id']);
    return hit['.id'];
  }
  const words = ['/ip/firewall/filter/add'];
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === '') continue;
    words.push(`=${k}=${v}`);
  }
  words.push('=place-before=0');
  const r = await ros(client, words);
  console.log('filter_add', attrs.comment, r.ok ? 'ok' : r.error);
  return r.ok ? 'added' : null;
}

async function main() {
  const pg = new Client({
    host: process.env.DATABASE_HOST || 'isp-control-db',
    port: Number(process.env.DATABASE_PORT || 5432),
    user: process.env.DATABASE_USER || 'isp',
    password: process.env.DATABASE_PASSWORD || 'isp',
    database: process.env.DATABASE_NAME || 'isp_control',
  });
  await pg.connect();
  const { rows } = await pg.query(
    `SELECT id, name, mgmt_host, mgmt_port, mgmt_username, mgmt_password, mgmt_protocol
     FROM tenant_demo.network_devices WHERE id = $1`,
    [MIKROTIK_ID],
  );
  await pg.end();
  const d = rows[0];
  if (!d) throw new Error('MikroTik not found');
  console.log('mikrotik', d.name, d.mgmt_host, d.mgmt_port);

  const useTls = (d.mgmt_protocol || 'api_ssl') !== 'api_plain';
  const client = new RouterOsApiClient(
    d.mgmt_host,
    d.mgmt_port || (useTls ? 8729 : 8728),
    useTls,
    60_000,
  );
  await client.connect();
  await client.login(d.mgmt_username, d.mgmt_password);

  // --- DIAG ---
  const identity = await client.print('/system/identity');
  console.log('identity', identity[0]?.name);

  const ifaces = await client.print('/interface');
  const ovpnIfaces = ifaces.filter(
    (i) =>
      /ovpn/i.test(i.name || '') ||
      /ovpn/i.test(i.type || '') ||
      /lab-tr069|isp-lab/i.test(i.name || ''),
  );
  console.log(
    'OVPN_IFACES',
    JSON.stringify(
      summarize(ovpnIfaces, ['name', 'type', 'running', 'disabled', 'actual-mtu']),
      null,
      2,
    ),
  );

  const pppActive = await client.print('/ppp/active');
  console.log(
    'PPP_ACTIVE',
    JSON.stringify(summarize(pppActive, ['name', 'service', 'caller-id', 'address', 'uptime']), null, 2),
  );

  const addrs = await client.print('/ip/address');
  console.log(
    'ADDRS_RELATED',
    JSON.stringify(
      summarize(
        addrs.filter((a) => /10\.60\.60|10\.69\.69|601/.test(JSON.stringify(a))),
        ['address', 'network', 'interface', 'disabled'],
      ),
      null,
      2,
    ),
  );

  const vlans = await client.print('/interface/vlan');
  console.log(
    'VLANS',
    JSON.stringify(
      summarize(vlans, ['name', 'vlan-id', 'interface', 'disabled']),
      null,
      2,
    ),
  );

  const bridges = await client.print('/interface/bridge');
  console.log(
    'BRIDGES',
    JSON.stringify(summarize(bridges, ['name', 'vlan-filtering', 'disabled']), null, 2),
  );

  const bports = await client.print('/interface/bridge/port');
  console.log(
    'BRIDGE_PORTS',
    JSON.stringify(summarize(bports, ['interface', 'bridge', 'pvid', 'disabled']), null, 2),
  );

  let bvlans = [];
  try {
    bvlans = await client.print('/interface/bridge/vlan');
  } catch {
    bvlans = [];
  }
  console.log(
    'BRIDGE_VLANS_601',
    JSON.stringify(
      summarize(
        bvlans.filter((v) => String(v['vlan-ids'] || v['vlan-id'] || '').includes(String(MGMT_VLAN))),
        ['bridge', 'vlan-ids', 'tagged', 'untagged'],
      ),
      null,
      2,
    ),
  );

  const routes = await client.print('/ip/route');
  console.log(
    'ROUTES_RELATED',
    JSON.stringify(
      summarize(
        routes.filter((r) => /10\.60|10\.69|ovpn/i.test(JSON.stringify(r))),
        ['dst-address', 'gateway', 'distance', 'active', 'disabled'],
      ),
      null,
      2,
    ),
  );

  const filters = await client.print('/ip/firewall/filter');
  const relatedFw = filters.filter((f) =>
    /ovpn|tr069|10\.69|10\.60|isp-control|lab/i.test(JSON.stringify(f)),
  );
  console.log(
    'FILTER_RELATED',
    JSON.stringify(
      summarize(relatedFw, ['chain', 'action', 'in-interface', 'out-interface', 'src-address', 'dst-address', 'comment', 'disabled']),
      null,
      2,
    ),
  );

  // Find parent for VLAN 601: prefer existing vlan's parent, else bridge with OLT-ish name, else first bridge
  const existingVlan = vlans.find(
    (v) => String(v['vlan-id']) === String(MGMT_VLAN) || /601|mgmt|tr069/i.test(v.name || ''),
  );
  let vlanParent =
    existingVlan?.interface ||
    bridges.find((b) => /bridge|lan|local/i.test(b.name || ''))?.name ||
    bridges[0]?.name ||
    null;

  // Heuristic: uplink to OLT often eth or sfp bridged — look for comment/name
  const ether = ifaces.filter((i) => /ether|sfp|combo/i.test(i.type || i.name || ''));
  console.log(
    'ETHER_HINT',
    JSON.stringify(summarize(ether.slice(0, 12), ['name', 'type', 'running', 'comment']), null, 2),
  );
  console.log('vlan_parent_choice', vlanParent, 'existing_vlan', existingVlan?.name || null);

  // --- FIX OVPN FIREWALL (data plane) ---
  // Allow input from OVPN clients (ping / ACS replies to router)
  await ensureFilter(client, {
    chain: 'input',
    'in-interface-list': undefined,
    'src-address': OVPN_NET,
    action: 'accept',
    comment: `${COMMENT} input from ovpn`,
  });
  // Also match by dynamic ovpn interface if present
  for (const oi of ovpnIfaces) {
    await ensureFilter(client, {
      chain: 'input',
      'in-interface': oi.name,
      action: 'accept',
      comment: `${COMMENT} input ${oi.name}`,
    });
  }

  // Forward: mgmt VLAN <-> ACS
  await ensureFilter(client, {
    chain: 'forward',
    'src-address': `10.60.60.0/${MGMT_PREFIX}`,
    'dst-address': ACS_IP,
    action: 'accept',
    comment: `${COMMENT} fwd mgmt->acs`,
  });
  await ensureFilter(client, {
    chain: 'forward',
    'src-address': ACS_IP,
    'dst-address': `10.60.60.0/${MGMT_PREFIX}`,
    action: 'accept',
    comment: `${COMMENT} fwd acs->mgmt`,
  });
  await ensureFilter(client, {
    chain: 'forward',
    'src-address': OVPN_NET,
    'dst-address': `10.60.60.0/${MGMT_PREFIX}`,
    action: 'accept',
    comment: `${COMMENT} fwd ovpn->mgmt`,
  });
  await ensureFilter(client, {
    chain: 'forward',
    'src-address': `10.60.60.0/${MGMT_PREFIX}`,
    'dst-address': OVPN_NET,
    action: 'accept',
    comment: `${COMMENT} fwd mgmt->ovpn`,
  });

  // FastTrack bypass / established often already exist; ensure connection-state accept early
  await ensureFilter(client, {
    chain: 'forward',
    'connection-state': 'established,related',
    action: 'accept',
    comment: `${COMMENT} fwd established`,
  });
  await ensureFilter(client, {
    chain: 'input',
    'connection-state': 'established,related',
    action: 'accept',
    comment: `${COMMENT} input established`,
  });

  // --- FIX VLAN 601 L3 ---
  const vlanName = existingVlan?.name || `vlan${MGMT_VLAN}-tr069`;
  if (!existingVlan) {
    if (!vlanParent) {
      console.log('WARN: no vlan parent found — skip creating vlan interface');
    } else {
      const r = await ros(client, [
        '/interface/vlan/add',
        `=name=${vlanName}`,
        `=vlan-id=${MGMT_VLAN}`,
        `=interface=${vlanParent}`,
        `=comment=${COMMENT}`,
      ]);
      console.log('vlan_add', r.ok ? 'ok' : r.error, vlanName, 'on', vlanParent);
    }
  } else {
    console.log('vlan_ok', existingVlan.name, 'id', existingVlan['vlan-id'], 'on', existingVlan.interface);
  }

  // Ensure address 10.60.60.1/24 on vlan
  const wantAddr = `${MGMT_GW}/${MGMT_PREFIX}`;
  const addrOnVlan = addrs.find(
    (a) => a.interface === vlanName || a.address === wantAddr || a.address?.startsWith(`${MGMT_GW}/`),
  );
  if (!addrOnVlan) {
    // refresh vlan list in case we just created it
    const vlans2 = await client.print('/interface/vlan');
    const v = vlans2.find((x) => x.name === vlanName || String(x['vlan-id']) === String(MGMT_VLAN));
    const iface = v?.name || vlanName;
    const r = await ros(client, [
      '/ip/address/add',
      `=address=${wantAddr}`,
      `=interface=${iface}`,
      `=comment=${COMMENT}`,
    ]);
    console.log('addr_add', r.ok ? 'ok' : r.error, wantAddr, 'on', iface);
  } else {
    console.log('addr_ok', addrOnVlan.address, 'on', addrOnVlan.interface);
  }

  // Bridge VLAN filtering: tag MGMT_VLAN on bridge if vlan-filtering enabled
  const bridgeName = vlanParent && bridges.some((b) => b.name === vlanParent) ? vlanParent : bridges[0]?.name;
  const bridgeRow = bridges.find((b) => b.name === bridgeName);
  if (bridgeRow && (bridgeRow['vlan-filtering'] === 'true' || bridgeRow['vlan-filtering'] === true)) {
    const taggedPorts = bports
      .filter((p) => p.bridge === bridgeName && p.disabled !== 'true')
      .map((p) => p.interface)
      .filter(Boolean);
    // Also include the vlan interface itself if present
    const existingBv = bvlans.find((v) => {
      const ids = String(v['vlan-ids'] || '');
      return v.bridge === bridgeName && ids.split(/[,;]/).map((x) => x.trim()).includes(String(MGMT_VLAN));
    });
    if (!existingBv && taggedPorts.length) {
      const tagged = [...new Set([bridgeName, ...taggedPorts])].join(',');
      const r = await ros(client, [
        '/interface/bridge/vlan/add',
        `=bridge=${bridgeName}`,
        `=vlan-ids=${MGMT_VLAN}`,
        `=tagged=${tagged}`,
        `=comment=${COMMENT}`,
      ]);
      console.log('bridge_vlan_add', r.ok ? 'ok' : r.error, 'tagged', tagged);
    } else if (existingBv) {
      console.log('bridge_vlan_ok', existingBv['vlan-ids'], 'tagged', existingBv.tagged);
    }
  } else {
    console.log('bridge_vlan_skip', 'vlan-filtering off or no bridge', bridgeName);
  }

  // NAT: usually not needed for same-router L3; ensure no drop on ovpn
  // Ping ACS from router to verify data plane
  let pingAcs = await ros(client, [
    '/ping',
    `=address=${ACS_IP}`,
    '=count=3',
  ]);
  console.log('ping_acs', pingAcs.ok ? 'sent' : pingAcs.error, JSON.stringify(pingAcs.rows || []).slice(0, 500));

  // Re-print related state
  const addrs2 = await client.print('/ip/address');
  console.log(
    'ADDRS_AFTER',
    JSON.stringify(
      summarize(
        addrs2.filter((a) => /10\.60\.60|10\.69\.69|601/.test(JSON.stringify(a))),
        ['address', 'network', 'interface', 'disabled'],
      ),
      null,
      2,
    ),
  );
  const ppp2 = await client.print('/ppp/active');
  console.log(
    'PPP_AFTER',
    JSON.stringify(summarize(ppp2, ['name', 'service', 'address', 'uptime']), null, 2),
  );

  await client.close();
  console.log('done');
}

main().catch((e) => {
  console.error('FATAL', e.message || e);
  process.exit(1);
});
