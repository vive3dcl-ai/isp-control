#!/usr/bin/env node
/**
 * Lab bootstrap: reverse OVPN on MikroTik + GenieACS-ready tunnel client config.
 * Usage (from api container):
 *   node /lab/provision-mikrotik-ovpn.mjs
 */
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
const { RouterOsApiClient } = require('./dist/topology/routeros-api.client.js');

const MIKROTIK_ID = process.env.LAB_MIKROTIK_ID || '370cd177-067d-4ed4-a729-c831d7f9766d';
const TUNNEL_NAME = process.env.LAB_TUNNEL_NAME || 'lab-tr069';
const OUT_DIR = process.env.LAB_OUT_DIR || '/lab/ovpn';
const SUBNET_N = Number(process.env.LAB_SUBNET_N || 69);
const SERVER_IP = `10.69.${SUBNET_N}.1`;
const CLIENT_IP = `10.69.${SUBNET_N}.2`;
const OVPN_PORT = Number(process.env.LAB_OVPN_PORT || 1194);
const PASSWORD = process.env.LAB_OVPN_PASSWORD || 'LabTr069!' + Math.random().toString(36).slice(2, 8);

async function ros(client, words) {
  const replies = await client.write(words);
  const trap = replies.find((r) => r.type === '!trap' || r.type === '!fatal');
  if (trap) {
    const msg = trap.attrs.message || JSON.stringify(trap.attrs);
    return { ok: false, error: msg, replies };
  }
  return {
    ok: true,
    rows: replies.filter((r) => r.type === '!re').map((r) => r.attrs),
    replies,
  };
}

async function main() {
  const pg = new Client({
    host: process.env.DATABASE_HOST || 'postgres',
    port: Number(process.env.DATABASE_PORT || 5432),
    user: process.env.DATABASE_USER || 'isp',
    password: process.env.DATABASE_PASSWORD || 'isp',
    database: process.env.DATABASE_NAME || 'isp_control',
  });
  await pg.connect();
  console.log('db_ok');

  // Ensure schema columns
  await pg.query(`
    ALTER TABLE tenant_demo.vpn_tunnels
      ADD COLUMN IF NOT EXISTS mode varchar(20) NOT NULL DEFAULT 'outbound';
    ALTER TABLE tenant_demo.vpn_tunnels
      ADD COLUMN IF NOT EXISTS endpoint_host varchar(255) NULL;
  `);

  const { rows } = await pg.query(
    `SELECT id, name, mgmt_host, mgmt_port, mgmt_username, mgmt_password, mgmt_protocol
     FROM tenant_demo.network_devices WHERE id = $1`,
    [MIKROTIK_ID],
  );
  const d = rows[0];
  if (!d) throw new Error('MikroTik device not found');
  console.log('mikrotik', d.name, d.mgmt_host, d.mgmt_port, d.mgmt_protocol);

  const useTls = (d.mgmt_protocol || 'api_ssl') !== 'api_plain';
  const client = new RouterOsApiClient(
    d.mgmt_host,
    d.mgmt_port || (useTls ? 8729 : 8728),
    useTls,
    60_000,
  );
  await client.connect();
  await client.login(d.mgmt_username, d.mgmt_password);
  const id = await client.print('/system/identity');
  console.log('identity', id[0]?.name || id[0]);

  const caName = 'isp-lab-ca';
  const srvName = 'isp-lab-srv';
  const poolName = 'isp-lab-pool';
  const profileName = 'isp-lab-ovpn';
  let r;

  // Certificates (best-effort idempotent)
  let certs = await client.print('/certificate');
  const hasCa = certs.some((c) => c.name === caName);
  const hasSrv = certs.some((c) => c.name === srvName);

  if (!hasCa) {
    r = await ros(client, [
      '/certificate/add',
      `=name=${caName}`,
      `=common-name=${caName}`,
      '=key-size=2048',
      '=days-valid=3650',
    ]);
    console.log('cert_ca_add', r.ok ? 'ok' : r.error);
    certs = await client.print('/certificate');
  }
  let caRow = certs.find((c) => c.name === caName);
  if (caRow && caRow['ca'] !== 'true' && !/K[LT]/i.test(caRow['key-usage'] || '')) {
    // sign as CA
    r = await ros(client, ['/certificate/sign', `=.id=${caRow['.id']}`, `=name=${caName}`]);
    if (!r.ok) {
      r = await ros(client, ['/certificate/sign', `=name=${caName}`]);
    }
    console.log('cert_ca_sign', r.ok ? 'ok' : r.error);
  } else {
    console.log('cert_ca_sign', 'skip');
  }
  r = await ros(client, ['/certificate/set', `=.id=${caRow?.['.id'] || caName}`, '=trusted=yes']);
  console.log('cert_ca_trust', r.ok ? 'ok' : r.error);

  certs = await client.print('/certificate');
  if (!certs.some((c) => c.name === srvName)) {
    r = await ros(client, [
      '/certificate/add',
      `=name=${srvName}`,
      `=common-name=${d.mgmt_host}`,
      '=key-size=2048',
      '=days-valid=3650',
    ]);
    console.log('cert_srv_add', r.ok ? 'ok' : r.error);
    certs = await client.print('/certificate');
  }
  let srvRow = certs.find((c) => c.name === srvName);
  if (srvRow && srvRow.private_key !== 'true' && srvRow['private-key'] !== 'true') {
    // may already be signed
  }
  // Sign server with CA if not yet a signed cert
  if (srvRow && (!srvRow.ca || srvRow.ca === caName || srvRow['ca'] === '')) {
    r = await ros(client, [
      '/certificate/sign',
      `=.id=${srvRow['.id']}`,
      `=ca=${caName}`,
      `=name=${srvName}`,
    ]);
    if (!r.ok) {
      r = await ros(client, [
        '/certificate/sign',
        `=name=${srvName}`,
        `=ca=${caName}`,
      ]);
    }
    console.log('cert_srv_sign', r.ok ? 'ok' : r.error);
  } else {
    console.log('cert_srv_sign', 'skip_or_done');
  }
  certs = await client.print('/certificate');
  srvRow = certs.find((c) => c.name === srvName);
  caRow = certs.find((c) => c.name === caName);
  r = await ros(client, [
    '/certificate/set',
    `=.id=${srvRow?.['.id'] || srvName}`,
    '=trusted=yes',
  ]);
  console.log('cert_srv_trust', r.ok ? 'ok' : r.error);

  console.log(
    'certs',
    certs.map((c) => ({
      name: c.name,
      id: c['.id'],
      digest: c.digest || '',
      fingerprint: c.fingerprint || c['sha1-fingerprint'] || '',
      sk: c['ski'] || '',
      trusted: c.trusted,
      key: c['private-key'] || c.private_key,
    })),
  );

  // Fingerprint for OpenVPN 2.6+ peer-fingerprint (sha256 preferred)
  let peerFp =
    srvRow?.['sha256-fingerprint'] ||
    srvRow?.fingerprint ||
    srvRow?.digest ||
    '';
  peerFp = String(peerFp).replace(/:/g, '').toLowerCase();

  // Export CA to file on router (for manual recovery)
  r = await ros(client, [
    '/certificate/export-certificate',
    `=.id=${caRow?.['.id'] || caName}`,
    `=file-name=${caName}`,
    '=type=pem',
  ]);
  if (!r.ok) {
    r = await ros(client, [
      '/certificate/export-certificate',
      `=certificate=${caName}`,
      `=file-name=${caName}`,
      '=type=pem',
    ]);
  }
  console.log('cert_export', r.ok ? 'ok' : r.error);

  // Pool / profile / secret
  const pools = await client.print('/ip/pool');
  for (const p of pools) {
    if (p.name === poolName) {
      await ros(client, ['/ip/pool/remove', `=.id=${p['.id']}`]);
    }
  }
  r = await ros(client, [
    '/ip/pool/add',
    `=name=${poolName}`,
    `=ranges=${CLIENT_IP}-${CLIENT_IP}`,
  ]);
  console.log('pool', r.ok ? 'ok' : r.error);

  r = await ros(client, [
    '/ppp/profile/add',
    `=name=${profileName}`,
    `=local-address=${SERVER_IP}`,
    `=remote-address=${poolName}`,
    '=change-tcp-mss=yes',
    '=use-encryption=required',
  ]);
  if (!r.ok && /already/i.test(r.error || '')) {
    r = await ros(client, [
      '/ppp/profile/set',
      `=numbers=${profileName}`,
      `=local-address=${SERVER_IP}`,
      `=remote-address=${poolName}`,
    ]);
  }
  console.log('profile', r.ok ? 'ok' : r.error);

  // Remove old secret if exists
  const secrets = await client.print('/ppp/secret');
  for (const s of secrets) {
    if (s.name === TUNNEL_NAME && (s.service === 'ovpn' || !s.service)) {
      await ros(client, ['/ppp/secret/remove', `=.id=${s['.id']}`]);
    }
  }
  r = await ros(client, [
    '/ppp/secret/add',
    `=name=${TUNNEL_NAME}`,
    `=password=${PASSWORD}`,
    '=service=ovpn',
    `=profile=${profileName}`,
    `=comment=isp-control lab reverse`,
  ]);
  console.log('secret', r.ok ? 'ok' : r.error);

  // Firewall accept
  r = await ros(client, [
    '/ip/firewall/filter/add',
    '=chain=input',
    '=protocol=tcp',
    `=dst-port=${OVPN_PORT}`,
    '=action=accept',
    `=comment=isp-control ovpn reverse lab`,
    '=place-before=0',
  ]);
  console.log('firewall', r.ok ? 'ok' : r.error);

  // Enable OVPN server
  r = await ros(client, [
    '/interface/ovpn-server/server/set',
    '=enabled=yes',
    `=certificate=${srvName}`,
    '=require-client-certificate=no',
    '=auth=sha1',
    '=cipher=aes256-cbc',
    `=port=${OVPN_PORT}`,
    '=protocol=tcp',
    '=mode=ip',
    `=default-profile=${profileName}`,
  ]);
  console.log('ovpn_server', r.ok ? 'ok' : r.error);

  // Verify server
  const ovpnSrv = await client.print('/interface/ovpn-server/server');
  console.log('ovpn_status', ovpnSrv[0] || ovpnSrv);

  await client.close();

  // Upsert vpn_tunnels row
  const existing = await pg.query(
    `SELECT id FROM tenant_demo.vpn_tunnels WHERE name = $1`,
    [TUNNEL_NAME],
  );
  let tunnelId;
  if (existing.rows[0]) {
    tunnelId = existing.rows[0].id;
    await pg.query(
      `UPDATE tenant_demo.vpn_tunnels SET
        protocol = 'openvpn_tcp',
        mode = 'reverse',
        endpoint_host = $2,
        tunnel_subnet = $3,
        client_address = $4,
        server_address = $5,
        password = $6,
        tunnel_routes = $7,
        status = 'configured',
        note = $8,
        updated_at = now()
       WHERE id = $1`,
      [
        tunnelId,
        d.mgmt_host,
        `10.69.${SUBNET_N}.0/24`,
        CLIENT_IP,
        SERVER_IP,
        PASSWORD,
        '10.0.0.0/8\n172.16.0.0/12\n192.168.0.0/16',
        'Lab TR069 reverse OVPN (auto-provisioned)',
      ],
    );
  } else {
    const ins = await pg.query(
      `INSERT INTO tenant_demo.vpn_tunnels
        (id, name, protocol, mode, endpoint_host, tunnel_subnet, client_address, server_address,
         password, tunnel_routes, status, note, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, 'openvpn_tcp', 'reverse', $2, $3, $4, $5, $6, $7, 'configured', $8, now(), now())
       RETURNING id`,
      [
        TUNNEL_NAME,
        d.mgmt_host,
        `10.69.${SUBNET_N}.0/24`,
        CLIENT_IP,
        SERVER_IP,
        PASSWORD,
        '10.0.0.0/8\n172.16.0.0/12\n192.168.0.0/16',
        'Lab TR069 reverse OVPN (auto-provisioned)',
      ],
    );
    tunnelId = ins.rows[0].id;
  }
  console.log('tunnel_id', tunnelId);

  // TR069 profile
  const acsUrl = `http://${CLIENT_IP}:14501`;
  const acsUser = 'acs_lab';
  const acsPass = PASSWORD;
  const crUser = 'cr_lab';
  const crPass = PASSWORD;
  let profileId;
  const pref = await pg.query(
    `SELECT id FROM tenant_demo.tr069_profiles WHERE name = 'Lab TR069'`,
  );
  if (pref.rows[0]) {
    profileId = pref.rows[0].id;
    await pg.query(
      `UPDATE tenant_demo.tr069_profiles SET
        acs_url = $2, acs_port = 14501,
        acs_username = $3, acs_password = $4,
        connection_request_username = $5, connection_request_password = $6,
        periodic_inform_enable = true, periodic_inform_interval = 300
       WHERE id = $1`,
      [profileId, acsUrl, acsUser, acsPass, crUser, crPass],
    );
  } else {
    const pins = await pg.query(
      `INSERT INTO tenant_demo.tr069_profiles
        (id, name, acs_url, acs_port, acs_username, acs_password,
         connection_request_username, connection_request_password,
         periodic_inform_enable, periodic_inform_interval, created_at, updated_at)
       VALUES (gen_random_uuid(), 'Lab TR069', $1, 14501, $2, $3, $4, $5, true, 300, now(), now())
       RETURNING id`,
      [acsUrl, acsUser, acsPass, crUser, crPass],
    );
    profileId = pins.rows[0].id;
  }
  console.log('tr069_profile', profileId, acsUrl);

  // Attach OLT Central
  const olt = await pg.query(
    `SELECT id FROM tenant_demo.network_devices WHERE name = 'OLT Central' LIMIT 1`,
  );
  if (olt.rows[0]) {
    await pg.query(
      `INSERT INTO tenant_demo.tr069_profile_olts (profile_id, device_id)
       VALUES ($1, $2)
       ON CONFLICT (profile_id, device_id) DO NOTHING`,
      [profileId, olt.rows[0].id],
    );
    console.log('olt_attached', olt.rows[0].id);
  }

  await pg.end();

  // Write OpenVPN client config (prefer peer-fingerprint if available)
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const authFile = path.join(OUT_DIR, 'auth.txt');
  fs.writeFileSync(authFile, `${TUNNEL_NAME}\n${PASSWORD}\n`);

  let ovpnBody;
  if (peerFp && peerFp.length >= 32) {
    ovpnBody = `client
dev tun
proto tcp-client
remote ${d.mgmt_host} ${OVPN_PORT}
resolv-retry infinite
nobind
persist-key
persist-tun
auth-user-pass ${path.basename(authFile)}
auth-nocache
auth SHA1
cipher AES-256-CBC
data-ciphers AES-256-CBC
data-ciphers-fallback AES-256-CBC
peer-fingerprint ${formatFp(peerFp)}
verb 3
route-nopull
`;
  } else {
    ovpnBody = `client
dev tun
proto tcp-client
remote ${d.mgmt_host} ${OVPN_PORT}
resolv-retry infinite
nobind
persist-key
persist-tun
auth-user-pass ${path.basename(authFile)}
auth-nocache
auth SHA1
cipher AES-256-CBC
data-ciphers AES-256-CBC
data-ciphers-fallback AES-256-CBC
verb 4
route-nopull
`;
  }
  fs.writeFileSync(path.join(OUT_DIR, 'acs.ovpn'), ovpnBody);
  fs.writeFileSync(
    path.join(OUT_DIR, 'lab.env'),
    [
      `LAB_TUNNEL_NAME=${TUNNEL_NAME}`,
      `LAB_OVPN_PASSWORD=${PASSWORD}`,
      `LAB_CLIENT_IP=${CLIENT_IP}`,
      `LAB_SERVER_IP=${SERVER_IP}`,
      `LAB_ACS_URL=${acsUrl}`,
      `LAB_PEER_FP=${peerFp}`,
      `LAB_ENDPOINT=${d.mgmt_host}`,
      `LAB_OVPN_PORT=${OVPN_PORT}`,
    ].join('\n') + '\n',
  );
  console.log('wrote', path.join(OUT_DIR, 'acs.ovpn'));
  console.log('DONE');
}

function formatFp(hex) {
  const h = hex.replace(/[^a-f0-9]/gi, '').toLowerCase();
  // OpenVPN wants colon-separated SHA256
  if (h.length === 64) {
    return h.match(/.{2}/g).join(':');
  }
  return h;
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
