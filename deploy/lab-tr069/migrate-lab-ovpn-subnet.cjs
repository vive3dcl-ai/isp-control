#!/usr/bin/env node
/**
 * Fix lab TR069 OVPN: move off 10.69.69.0/24 (conflicts with SmartOLT-VPN).
 * New subnet: 10.69.70.0/24 (.1 router, .2 ACS).
 * Also ensures VLAN 601 + firewall forward rules.
 *
 * Run in api container:
 *   NODE_PATH=/app/node_modules node /tmp/migrate-lab-ovpn-subnet.cjs
 */
const { Client } = require('pg');
const { RouterOsApiClient } = require('/app/apps/api/dist/topology/routeros-api.client.js');

const MIKROTIK_ID = process.env.LAB_MIKROTIK_ID || '370cd177-067d-4ed4-a729-c831d7f9766d';
const TUNNEL_NAME = 'lab-tr069';
const POOL_NAME = 'isp-lab-pool';
const PROFILE_NAME = 'isp-lab-ovpn';
const OLD_NET = '10.69.69.0/24';
const SERVER_IP = '10.69.70.1';
const CLIENT_IP = '10.69.70.2';
const NEW_NET = '10.69.70.0/24';
const MGMT_NET = '10.60.60.0/24';
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

async function ensureFilter(client, attrs) {
  const existing = await client.print('/ip/firewall/filter');
  const hit = existing.find((r) => (r.comment || '') === attrs.comment);
  if (hit) {
    // update addresses if rule exists with old net
    const words = ['/ip/firewall/filter/set', `=.id=${hit['.id']}`];
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'comment' || v == null || v === '') continue;
      words.push(`=${k}=${v}`);
    }
    const r = await ros(client, words);
    console.log('filter_set', attrs.comment, r.ok ? 'ok' : r.error);
    return;
  }
  const words = ['/ip/firewall/filter/add', '=place-before=0'];
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === '') continue;
    words.push(`=${k}=${v}`);
  }
  const r = await ros(client, words);
  console.log('filter_add', attrs.comment, r.ok ? 'ok' : r.error);
}

async function main() {
  const pg = new Client({
    host: process.env.DATABASE_HOST || 'isp-control-db',
    port: 5432,
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
  const d = rows[0];
  if (!d) throw new Error('MikroTik not found');

  const useTls = (d.mgmt_protocol || 'api_ssl') !== 'api_plain';
  const client = new RouterOsApiClient(d.mgmt_host, d.mgmt_port || 8729, useTls, 60_000);
  await client.connect();
  await client.login(d.mgmt_username, d.mgmt_password);
  console.log('connected', d.name);

  // 1) Update IP pool
  const pools = await client.print('/ip/pool');
  const pool = pools.find((p) => p.name === POOL_NAME);
  if (pool) {
    let r = await ros(client, [
      '/ip/pool/set',
      `=.id=${pool['.id']}`,
      `=ranges=${CLIENT_IP}-${CLIENT_IP}`,
    ]);
    console.log('pool_set', r.ok ? 'ok' : r.error, `${CLIENT_IP}-${CLIENT_IP}`);
  } else {
    let r = await ros(client, [
      '/ip/pool/add',
      `=name=${POOL_NAME}`,
      `=ranges=${CLIENT_IP}-${CLIENT_IP}`,
    ]);
    console.log('pool_add', r.ok ? 'ok' : r.error);
  }

  // 2) Update PPP profile local-address
  const profiles = await client.print('/ppp/profile');
  const prof = profiles.find((p) => p.name === PROFILE_NAME);
  if (prof) {
    let r = await ros(client, [
      '/ppp/profile/set',
      `=.id=${prof['.id']}`,
      `=local-address=${SERVER_IP}`,
      `=remote-address=${POOL_NAME}`,
    ]);
    console.log('profile_set', r.ok ? 'ok' : r.error, SERVER_IP);
  } else {
    throw new Error(`ppp profile ${PROFILE_NAME} missing — run docker:lab:provision first`);
  }

  // 3) Firewall for new net + mgmt
  await ensureFilter(client, {
    chain: 'input',
    'src-address': NEW_NET,
    action: 'accept',
    comment: `${COMMENT} input from ovpn`,
  });
  await ensureFilter(client, {
    chain: 'input',
    'in-interface': '<ovpn-lab-tr069>',
    action: 'accept',
    comment: `${COMMENT} input <ovpn-lab-tr069>`,
  });
  await ensureFilter(client, {
    chain: 'forward',
    'src-address': MGMT_NET,
    'dst-address': CLIENT_IP,
    action: 'accept',
    comment: `${COMMENT} fwd mgmt->acs`,
  });
  await ensureFilter(client, {
    chain: 'forward',
    'src-address': CLIENT_IP,
    'dst-address': MGMT_NET,
    action: 'accept',
    comment: `${COMMENT} fwd acs->mgmt`,
  });
  await ensureFilter(client, {
    chain: 'forward',
    'src-address': NEW_NET,
    'dst-address': MGMT_NET,
    action: 'accept',
    comment: `${COMMENT} fwd ovpn->mgmt`,
  });
  await ensureFilter(client, {
    chain: 'forward',
    'src-address': MGMT_NET,
    'dst-address': NEW_NET,
    action: 'accept',
    comment: `${COMMENT} fwd mgmt->ovpn`,
  });

  // 4) Confirm vlan_601 still has 10.60.60.1
  const addrs = await client.print('/ip/address');
  const mgmt = addrs.find((a) => a.interface === 'vlan_601' || a.address?.startsWith('10.60.60.1/'));
  console.log('vlan_601_addr', mgmt ? `${mgmt.address} on ${mgmt.interface}` : 'MISSING');

  // 5) Kick active OVPN session so client reconnects with new IP
  const active = await client.print('/ppp/active');
  for (const a of active) {
    if (a.name === TUNNEL_NAME || a.address === '10.69.69.2' || a.address === CLIENT_IP) {
      const r = await ros(client, ['/ppp/active/remove', `=.id=${a['.id']}`]);
      console.log('kick_session', a.name, a.address, r.ok ? 'ok' : r.error);
    }
  }

  // 6) Update DB
  const acsUrl = `http://${CLIENT_IP}:14501`;
  await pg.query(
    `UPDATE tenant_demo.vpn_tunnels SET
       client_address = $2, server_address = $3, tunnel_subnet = $4,
       status = 'configured', updated_at = now()
     WHERE name = $1`,
    [TUNNEL_NAME, CLIENT_IP, SERVER_IP, NEW_NET],
  );
  await pg.query(
    `UPDATE tenant_demo.tr069_profiles SET acs_url = $1, acs_port = 14501, updated_at = now()
     WHERE name = 'Lab TR069'`,
    [acsUrl],
  );
  console.log('db_updated', { CLIENT_IP, SERVER_IP, NEW_NET, acsUrl, old: OLD_NET });

  await client.close();
  await pg.end();
  console.log('done — restart lab-vpnacs and re-apply OMCI on ONU');
}

main().catch((e) => {
  console.error('FATAL', e.message || e);
  process.exit(1);
});
