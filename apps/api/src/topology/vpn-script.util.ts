import { generateKeyPairSync, randomBytes } from 'crypto';
import type { VpnProtocol } from './vpn.constants';
import { DEFAULT_VPN_PORTS } from './vpn.constants';

export function randomPassword(length = 12): string {
  const alphabet =
    'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
}

export function randomSetupToken(): string {
  return randomBytes(9).toString('base64url');
}

/** Allocate 10.69.<n>.0/24 from existing subnets. */
export function allocateTunnelSubnet(existing: string[]): {
  tunnelSubnet: string;
  serverAddress: string;
  clientAddress: string;
} {
  const used = new Set<number>();
  for (const cidr of existing) {
    const m = cidr.match(/^10\.69\.(\d+)\.0\/24$/);
    if (m) used.add(Number(m[1]));
  }
  let n = 1;
  while (used.has(n) && n < 254) n += 1;
  if (n >= 254) n = 1 + Math.floor(Math.random() * 200);
  return {
    tunnelSubnet: `10.69.${n}.0/24`,
    serverAddress: `10.69.${n}.1`,
    clientAddress: `10.69.${n}.2`,
  };
}

export function generateWireguardKeyPair(): {
  privateKey: string;
  publicKey: string;
} {
  const { privateKey, publicKey } = generateKeyPairSync('x25519');
  const privDer = privateKey.export({ type: 'pkcs8', format: 'der' });
  const pubDer = publicKey.export({ type: 'spki', format: 'der' });
  return {
    privateKey: Buffer.from(privDer).subarray(-32).toString('base64'),
    publicKey: Buffer.from(pubDer).subarray(-32).toString('base64'),
  };
}

export interface VpnScriptContext {
  name: string;
  protocol: VpnProtocol;
  password?: string | null;
  clientAddress: string;
  serverAddress: string;
  tunnelRoutes: string[];
  vpnHost: string;
  vpnPort: number;
  wgPrivateKey?: string | null;
  wgServerPublicKey?: string | null;
  interfaceName?: string;
}

function ifaceName(ctx: VpnScriptContext) {
  return (
    ctx.interfaceName ||
    `isp-${ctx.protocol === 'wireguard' ? 'wg' : 'ovpn'}-${ctx.name}`
      .replace(/[^a-zA-Z0-9_-]/g, '')
      .slice(0, 40)
  );
}

export function vpnClientInterfaceName(ctx: VpnScriptContext): string {
  return ifaceName(ctx);
}

/** Rutas que el cliente MikroTik debe tener vía el túnel (peer + redes). */
export function desiredVpnClientRouteCidrs(ctx: VpnScriptContext): string[] {
  const routes = parseRoutes(ctx.tunnelRoutes);
  const peer = `${ctx.serverAddress}/32`;
  const out = [peer];
  for (const r of routes) {
    if (r !== peer) out.push(r);
  }
  return out;
}

export function desiredWgClientAllowedAddress(ctx: VpnScriptContext): string {
  return desiredVpnClientRouteCidrs(ctx).join(',');
}

/** Normaliza dst-address de RouterOS (a veces /32 sin máscara). */
export function normalizeRouteCidr(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const s = raw.trim();
  if (/^\d+\.\d+\.\d+\.\d+\/\d+$/.test(s)) return s;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(s)) return `${s}/32`;
  return null;
}

export function buildIpRouteAddWords(
  cidr: string,
  gatewayIface: string,
  tunnelName: string,
  kind: 'peer' | 'route' = 'route',
): string[] {
  const comment =
    kind === 'peer'
      ? `isp-control ${tunnelName} peer`
      : `isp-control ${tunnelName} route ${cidr}`;
  return [
    '/ip/route/add',
    `=dst-address=${cidr}`,
    `=gateway=${gatewayIface}`,
    `=comment=${comment}`,
  ];
}

function parseRoutes(routes: string[]): string[] {
  return routes
    .map((r) => r.trim())
    .filter((r) => /^\d+\.\d+\.\d+\.\d+\/\d+$/.test(r));
}

function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40) || 'tunnel';
}

/**
 * Reglas MikroTik para tráfico del túnel ↔ LAN (OLT/mgmt).
 * Sin forward + exclusión de masquerade, el concentrador no alcanza OLTs.
 */
function buildMikrotikTunnelAccessRules(
  iface: string,
  tunnelName: string,
): string[] {
  const tag = `isp-control ${tunnelName}`;
  return [
    `# --- Acceso túnel ↔ LAN (OLT / mgmt / pools) ---`,
    `:do { /ip firewall filter remove [find comment~"${tag} vpn-fwd-in"] } on-error={}`,
    `:do { /ip firewall filter remove [find comment~"${tag} vpn-fwd-out"] } on-error={}`,
    `:do { /ip firewall filter remove [find comment~"${tag} vpn-input"] } on-error={}`,
    `:do { /ip firewall nat remove [find comment~"${tag} vpn-no-masq"] } on-error={}`,
    `:do { /ip firewall mangle remove [find comment~"${tag} vpn-mss-fwd"] } on-error={}`,
    `/ip firewall filter add chain=forward in-interface="${iface}" action=accept comment="${tag} vpn-fwd-in" place-before=0`,
    `/ip firewall filter add chain=forward out-interface="${iface}" action=accept comment="${tag} vpn-fwd-out" place-before=0`,
    `/ip firewall filter add chain=input in-interface="${iface}" action=accept comment="${tag} vpn-input" place-before=0`,
    `# Evita masquerade hacia el túnel (si hay srcnat genérico, place-before=0 gana)`,
    `/ip firewall nat add chain=srcnat out-interface="${iface}" action=accept comment="${tag} vpn-no-masq" place-before=0`,
    `/ip firewall mangle add chain=forward in-interface="${iface}" protocol=tcp tcp-flags=syn action=change-mss new-mss=1200 comment="${tag} vpn-mss-fwd"`,
    `/ip firewall mangle add chain=forward out-interface="${iface}" protocol=tcp tcp-flags=syn action=change-mss new-mss=1200 comment="${tag} vpn-mss-fwd"`,
  ];
}

/** Full RouterOS script (manual paste), SmartOLT-style. */
export function buildMikrotikVpnScript(ctx: VpnScriptContext): string {
  const name = ifaceName(ctx);
  const routes = parseRoutes(ctx.tunnelRoutes);
  const lines: string[] = [
    `# isp-control VPN setup — ${ctx.name} (${ctx.protocol})`,
    `# Host: ${ctx.vpnHost}:${ctx.vpnPort}`,
    `# Rutas vía túnel (alcanzar redes remotas / ACS). Redes LAN locales`,
    `# más específicas (connected) ganan; el concentrador usa las mismas`,
    `# CIDRs en AllowedIPs/iroute para llegar a OLT detrás de este router.`,
    `:do { /ip firewall mangle add chain=output protocol=tcp tcp-flags=syn action=change-mss new-mss=1200 comment="isp-control VPN MSS clamp" } on-error={}`,
  ];

  if (ctx.protocol === 'wireguard') {
    const priv = ctx.wgPrivateKey || '';
    const serverPub = ctx.wgServerPublicKey?.trim();
    if (!serverPub) {
      throw new Error(
        'VPN_WIREGUARD_SERVER_PUBLIC_KEY no configurada: define la clave pública del concentrador',
      );
    }
    if (!priv) {
      throw new Error('Falta la clave privada WireGuard del túnel');
    }
    // Destinos hacia el concentrador: peer + redes de tunnel routes
    const allowed = [ctx.serverAddress + '/32', ...routes].join(',');
    lines.push(
      `:do { /interface wireguard remove [find name="${name}"] } on-error={}`,
      `/interface wireguard add name="${name}" listen-port=0 private-key="${priv}" comment="isp-control ${ctx.name}"`,
      `/interface wireguard peers add interface="${name}" public-key="${serverPub}" endpoint-address=${ctx.vpnHost} endpoint-port=${ctx.vpnPort} allowed-address=${allowed} persistent-keepalive=25s comment="isp-control ${ctx.name}"`,
      `:do { /ip address remove [find interface="${name}"] } on-error={}`,
      `/ip address add address=${ctx.clientAddress}/24 interface="${name}" comment="isp-control ${ctx.name}"`,
    );
  } else {
    const proto = ctx.protocol === 'openvpn_tcp' ? 'tcp' : 'udp';
    const pass = ctx.password || '';
    const host = ctx.vpnHost?.trim();
    if (!host || host === 'vpn.example.com') {
      throw new Error(
        'VPN_PUBLIC_HOST no configurada: define el dominio/IP del concentrador OpenVPN',
      );
    }
    if (!pass) {
      throw new Error('Falta la contraseña OpenVPN del túnel');
    }
    lines.push(
      `# Concentrador OpenVPN: ${host}:${ctx.vpnPort} (${proto})`,
      `# Usuario=${ctx.name}  IP cliente=${ctx.clientAddress}  IP servidor=${ctx.serverAddress}`,
      `:do { /interface ovpn-client remove [find name="${name}"] } on-error={}`,
      `/interface ovpn-client add name="${name}" connect-to=${host} port=${ctx.vpnPort} mode=ip user="${ctx.name}" password="${pass}" protocol=${proto} cipher=aes256-cbc auth=sha1 add-default-route=no disabled=no comment="isp-control ${ctx.name}"`,
    );
  }

  lines.push(...buildMikrotikTunnelAccessRules(name, ctx.name));

  // Ruta explícita al peer del túnel (ACS en serverAddress:14501)
  lines.push(
    `:do { /ip route remove [find dst-address="${ctx.serverAddress}/32" comment~"isp-control ${ctx.name}"] } on-error={}`,
    `/ip route add dst-address=${ctx.serverAddress}/32 gateway="${name}" comment="isp-control ${ctx.name} peer"`,
  );

  for (const cidr of routes) {
    lines.push(
      `:do { /ip route remove [find dst-address="${cidr}" comment~"isp-control ${ctx.name}"] } on-error={}`,
      `/ip route add dst-address=${cidr} gateway="${name}" comment="isp-control ${ctx.name} route ${cidr}"`,
    );
  }

  lines.push(`:put "isp-control VPN ${ctx.name} configured on ${name}"`);
  return lines.join('\n');
}

/**
 * Reverse lab: MikroTik = OpenVPN TCP server (su IP/hostname público).
 * El ACS se conecta a endpointHost:port — NO al VPN_PUBLIC_HOST de plataforma.
 */
export function buildMikrotikOpenVpnServerScript(ctx: VpnScriptContext): string {
  const n = safeName(ctx.name);
  const caName = `isp-ca-${n}`.slice(0, 40);
  const srvCert = `isp-srv-${n}`.slice(0, 40);
  const poolName = `isp-pool-${n}`.slice(0, 40);
  const profileName = `isp-ovpn-${n}`.slice(0, 40);
  const pass = ctx.password || '';
  const port = ctx.vpnPort || DEFAULT_VPN_PORTS.openvpn_tcp;
  const publicHost = ctx.vpnHost?.trim() || 'ENDPOINT_HOST';

  const lines: string[] = [
    `# isp-control VPN REVERSE (OpenVPN TCP server) — ${ctx.name}`,
    `# Escucha en el MikroTik: 0.0.0.0:${port} (TCP)`,
    `# Endpoint público para el ACS (.ovpn): ${publicHost}:${port}`,
    `# Túnel: server=${ctx.serverAddress}  client=${ctx.clientAddress}`,
    `# Tras aplicar: /certificate export-certificate ${caName} type=pem`,
    `:do { /ip firewall mangle add chain=output protocol=tcp tcp-flags=syn action=change-mss new-mss=1200 comment="isp-control VPN MSS clamp" } on-error={}`,
    `:do { /ip firewall filter add chain=input protocol=tcp dst-port=${port} action=accept comment="isp-control ovpn reverse ${ctx.name}" place-before=0 } on-error={}`,
    `# Forward ACS (cliente OVPN) ↔ LAN (OLT/mgmt) — subnet del túnel`,
    `:do { /ip firewall filter remove [find comment~"isp-control reverse ${ctx.name} fwd"] } on-error={}`,
    `/ip firewall filter add chain=forward src-address=${ctx.clientAddress}/32 action=accept comment="isp-control reverse ${ctx.name} fwd-from-acs" place-before=0`,
    `/ip firewall filter add chain=forward dst-address=${ctx.clientAddress}/32 action=accept comment="isp-control reverse ${ctx.name} fwd-to-acs" place-before=0`,
    `/ip firewall filter add chain=forward src-address=${ctx.serverAddress}/32 action=accept comment="isp-control reverse ${ctx.name} fwd-from-srv" place-before=0`,
    `/ip firewall filter add chain=forward dst-address=${ctx.serverAddress}/32 action=accept comment="isp-control reverse ${ctx.name} fwd-to-srv" place-before=0`,
  ];

  for (const cidr of parseRoutes(ctx.tunnelRoutes)) {
    lines.push(
      `/ip firewall filter add chain=forward dst-address=${cidr} action=accept comment="isp-control reverse ${ctx.name} fwd-lan ${cidr}" place-before=0`,
      `/ip firewall filter add chain=forward src-address=${cidr} action=accept comment="isp-control reverse ${ctx.name} fwd-lan-src ${cidr}" place-before=0`,
    );
  }

  lines.push(
    `# --- certificates (idempotent) ---`,
    `:do { /certificate add name="${caName}" common-name="${caName}" key-size=2048 days-valid=3650 } on-error={}`,
    `:do { /certificate sign "${caName}" name="${caName}" } on-error={}`,
    `:do { /certificate set "${caName}" trusted=yes } on-error={}`,
    `:do { /certificate add name="${srvCert}" common-name="${srvCert}" key-size=2048 days-valid=3650 } on-error={}`,
    `:do { /certificate sign "${srvCert}" ca="${caName}" name="${srvCert}" } on-error={}`,
    `:do { /certificate set "${srvCert}" trusted=yes } on-error={}`,
    `# --- PPP pool / profile / secret ---`,
    `:do { /ip pool remove [find name="${poolName}"] } on-error={}`,
    `/ip pool add name="${poolName}" ranges=${ctx.clientAddress}-${ctx.clientAddress}`,
    `:do { /ppp profile remove [find name="${profileName}"] } on-error={}`,
    `/ppp profile add name="${profileName}" local-address=${ctx.serverAddress} remote-address=${poolName} change-tcp-mss=yes use-encryption=yes`,
    `:do { /ppp secret remove [find name="${ctx.name}" service=ovpn] } on-error={}`,
    `/ppp secret add name="${ctx.name}" password="${pass}" service=ovpn profile="${profileName}" comment="isp-control reverse ${ctx.name}"`,
    `# --- OpenVPN server ---`,
    `/interface ovpn-server server set enabled=yes certificate="${srvCert}" require-client-certificate=no auth=sha1 cipher=aes256-cbc port=${port} protocol=tcp mode=ip default-profile="${profileName}"`,
    `:put "isp-control reverse OVPN ready — ACS remote ${publicHost} ${port} TCP"`,
  );
  return lines.join('\n');
}

/**
 * Local ACS OpenVPN client config (.ovpn).
 * remote = endpointHost del MikroTik (modo inverso), no el dominio vpn de plataforma.
 */
export function buildLocalOpenVpnClientConfig(ctx: VpnScriptContext): string {
  const routes = parseRoutes(ctx.tunnelRoutes);
  const pass = ctx.password || '';
  const host = ctx.vpnHost?.trim() || 'ENDPOINT_HOST';
  const port = ctx.vpnPort || DEFAULT_VPN_PORTS.openvpn_tcp;
  const routeLines = routes
    .map((cidr) => {
      const [ip, bits] = cidr.split('/');
      const mask = cidrMask(Number(bits));
      return `route ${ip} ${mask}`;
    })
    .join('\n');

  return `# isp-control ACS client — reverse tunnel ${ctx.name}
# MikroTik es el servidor OpenVPN. Conecta a SU IP/hostname público:
#   remote ${host} ${port}
# (No uses VPN_PUBLIC_HOST de plataforma en modo inverso.)
# 1) Aplica script servidor / Import en el MikroTik
# 2) /certificate export-certificate isp-ca-${safeName(ctx.name)} type=pem
# 3) Pega el CA PEM entre <ca>…</ca>
# 4) Guarda como ${ctx.name}.ovpn y conecta desde el host ACS
# ACS URL sugerida: http://${ctx.clientAddress}:14501

client
dev tun
proto tcp
remote ${host} ${port}
resolv-retry infinite
nobind
persist-key
persist-tun
auth-user-pass
# credentials: username=${ctx.name}  password=${pass}
cipher AES-256-CBC
auth SHA1
remote-cert-tls server
verb 3
${routeLines}

<auth-user-pass>
${ctx.name}
${pass}
</auth-user-pass>

<ca>
# PASTE MikroTik CA PEM HERE (isp-ca-${safeName(ctx.name)}.crt)
</ca>
`;
}

function cidrMask(bits: number): string {
  const n = bits >= 0 && bits <= 32 ? bits : 24;
  let mask = 0;
  for (let i = 0; i < n; i++) mask |= 1 << (31 - i);
  return [
    (mask >>> 24) & 255,
    (mask >>> 16) & 255,
    (mask >>> 8) & 255,
    mask & 255,
  ].join('.');
}

/** Bootstrap one-liner that fetches .rsc from our API (needs reachable PUBLIC_API_URL). */
export function buildMikrotikBootstrapCommand(opts: {
  fetchUrl: string;
}): string {
  const url = opts.fetchUrl.replace(/"/g, '\\"');
  return [
    `:do { /ip firewall mangle add chain=output protocol=tcp tcp-flags=syn action=change-mss new-mss=1200 comment="isp-control VPN MSS clamp (bootstrap)" } on-error={}`,
    `:local ver [/system resource get version]`,
    `:local version [:pick $ver 0 [:find $ver " "]]`,
    `/tool fetch url="${url}\\?v=$version" dst-path="isp-control-vpn-setup.rsc"`,
    `:delay 1s`,
    `/import file-name="isp-control-vpn-setup.rsc"`,
  ].join(' ; ');
}

export function vpnEndpoint(
  protocol: VpnProtocol,
  host: string,
  portOverride?: number | null,
): { host: string; port: number } {
  return {
    host: host || 'vpn.example.com',
    port: portOverride || DEFAULT_VPN_PORTS[protocol],
  };
}

export interface WireguardConcentratorPeerInput {
  /** e.g. tenant slug or schema */
  tenantLabel: string;
  tunnelName: string;
  clientPublicKey: string;
  clientAddress: string;
  serverAddress: string;
  /** Redes LAN detrás del MikroTik (OLT, mgmt) — AllowedIPs del peer */
  lanRoutes: string[];
}

export interface OpenVpnConcentratorUserInput {
  tenantLabel: string;
  tunnelName: string;
  username: string;
  password: string;
  clientAddress: string;
  serverAddress: string;
  protocol: 'openvpn_tcp' | 'openvpn_udp';
  vpnHost: string;
  vpnPort: number;
  /** Redes LAN detrás del MikroTik — iroute en CCD */
  lanRoutes: string[];
}

/** Snippet para el concentrador OpenVPN (CCD + credenciales + iroute). */
export function buildOpenVpnConcentratorUserConfig(
  user: OpenVpnConcentratorUserInput,
): string {
  const proto = user.protocol === 'openvpn_udp' ? 'udp' : 'tcp';
  const iroutes = parseRoutes(user.lanRoutes)
    .map((cidr) => {
      const [ip, bits] = cidr.split('/');
      const mask = cidrMask(Number(bits));
      return `iroute ${ip} ${mask}`;
    })
    .join('\n');
  return [
    `# ${user.tenantLabel} / ${user.tunnelName}`,
    `# MikroTik cliente → ${user.vpnHost}:${user.vpnPort} (${proto})`,
    `# username=${user.username}`,
    `# password=${user.password}`,
    `# CCD file (ej. /etc/openvpn/ccd/${user.username}):`,
    `ifconfig-push ${user.clientAddress} 255.255.255.0`,
    iroutes || '# (sin lanRoutes — añade iroute CIDR para OLT/mgmt)',
    `# Asegura que el tun del servidor tenga ${user.serverAddress}/24`,
    `# En server.conf: topology subnet + client-config-dir + route de cada LAN`,
  ].join('\n');
}

/** Comandos RouterOS si el concentrador OpenVPN es un MikroTik. */
export function buildOpenVpnConcentratorMikrotikCommands(
  user: OpenVpnConcentratorUserInput,
): string {
  const n = safeName(user.tunnelName);
  const poolName = `isp-pool-${user.tenantLabel}-${n}`.slice(0, 40);
  const profileName = `isp-ovpn-${user.tenantLabel}-${n}`.slice(0, 40);
  const routes = parseRoutes(user.lanRoutes);
  const lines = [
    `# Concentrador MikroTik — usuario ${user.username}`,
    `/ip pool add name="${poolName}" ranges=${user.clientAddress}-${user.clientAddress}`,
    `/ppp profile add name="${profileName}" local-address=${user.serverAddress} remote-address=${poolName} change-tcp-mss=yes use-encryption=yes`,
    `/ppp secret add name="${user.username}" password="${user.password}" service=ovpn profile="${profileName}" comment="isp-control ${user.tenantLabel}/${user.tunnelName}"`,
  ];
  for (const cidr of routes) {
    lines.push(
      `/ip route add dst-address=${cidr} gateway=${user.clientAddress} comment="isp-control ${user.tenantLabel}/${user.tunnelName} lan ${cidr}"`,
    );
  }
  return lines.join('\n');
}

/** Bloque [Peer] para el concentrador (un túnel / tenant). */
export function buildWireguardConcentratorPeer(
  peer: WireguardConcentratorPeerInput,
): string {
  const lans = parseRoutes(peer.lanRoutes);
  const allowed = [peer.clientAddress + '/32', ...lans].join(', ');
  return [
    `# ${peer.tenantLabel} / ${peer.tunnelName} → ${peer.clientAddress}`,
    `# LAN (OLT/mgmt) vía este peer: ${lans.join(', ') || '(ninguna)'}`,
    `[Peer]`,
    `PublicKey = ${peer.clientPublicKey}`,
    `AllowedIPs = ${allowed}`,
  ].join('\n');
}

/** Comandos en vivo para añadir el peer al interface del concentrador (wg0). */
export function buildWireguardConcentratorApplyCommands(
  peer: WireguardConcentratorPeerInput,
  iface = 'wg0',
): string {
  const lans = parseRoutes(peer.lanRoutes);
  const allowed = [peer.clientAddress + '/32', ...lans].join(',');
  return [
    `# Aplicar peer ${peer.tenantLabel}/${peer.tunnelName} en el concentrador`,
    `# AllowedIPs incluye LAN para alcanzar OLT detrás del MikroTik`,
    `wg set ${iface} peer ${peer.clientPublicKey} allowed-ips ${allowed}`,
    `ip address add ${peer.serverAddress}/24 dev ${iface} 2>/dev/null || true`,
    ...lans.map(
      (cidr) =>
        `ip route add ${cidr} via ${peer.clientAddress} dev ${iface} 2>/dev/null || true`,
    ),
  ].join('\n');
}

export interface WireguardConcentratorConfigInput {
  privateKey: string;
  listenPort: number;
  peers: WireguardConcentratorPeerInput[];
  interfaceName?: string;
}

/** wg-quick / conf completo del concentrador multi-tenant. */
export function buildWireguardConcentratorConf(
  input: WireguardConcentratorConfigInput,
): string {
  const iface = input.interfaceName || 'wg0';
  const addresses = [
    ...new Set(input.peers.map((p) => `${p.serverAddress}/24`)),
  ];
  const lines: string[] = [
    `# isp-control WireGuard concentrator (${iface})`,
    `# Peers: ${input.peers.length} · regenerar tras crear/borrar túneles`,
    `[Interface]`,
    `PrivateKey = ${input.privateKey}`,
    `ListenPort = ${input.listenPort}`,
  ];
  if (addresses.length) {
    lines.push(`Address = ${addresses.join(', ')}`);
  }
  lines.push('');
  for (const peer of input.peers) {
    lines.push(buildWireguardConcentratorPeer(peer));
    lines.push('');
  }
  return lines.join('\n').trimEnd() + '\n';
}

/** Convert script lines to RouterOS API word batches for import. */
export function scriptToApiBatches(script: string): string[][] {
  const batches: string[][] = [];
  for (const raw of script.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith(':put')) continue;
    // Skip :do { ... } on-error={} wrappers — expand simple removes via API differently
    if (line.startsWith(':do {')) {
      const inner = line.match(/:do \{(.+)\} on-error=\{\}/)?.[1]?.trim();
      if (inner) {
        const batch = routerosLineToWords(inner);
        if (batch) batches.push(batch);
      }
      continue;
    }
    if (line.startsWith(':local') || line.startsWith(':delay')) continue;
    const batch = routerosLineToWords(line);
    if (batch) batches.push(batch);
  }
  return batches;
}

function routerosLineToWords(line: string): string[] | null {
  // /interface ovpn-client add name=x connect-to=y ...
  // /interface ovpn-server server set ...
  const m = line.match(
    /^(\/[a-z0-9\/-]+)\s+(add|remove|set|sign)\s+(.+)$/i,
  );
  if (!m) return null;
  const path = m[1];
  const action = m[2].toLowerCase();
  const rest = m[3];

  if (action === 'remove') {
    // /interface ovpn-client remove [find name="x"] — skip via API find; best-effort ignore
    return null;
  }

  // certificate sign "name" ca="..." name="..." — skip complex; script paste handles it
  if (action === 'sign') {
    return null;
  }

  const words = [`${path}/${action}`];
  // Parse key=value and key="value with spaces"
  const re = /([a-z0-9-]+)=("(?:\\.|[^"])*"|[^\s]+)/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(rest)) !== null) {
    let val = match[2];
    if (val.startsWith('"') && val.endsWith('"')) {
      val = val.slice(1, -1).replace(/\\"/g, '"');
    }
    words.push(`=${match[1]}=${val}`);
  }
  // certificate add name="x" common-name=... without = for bare args is rare; skip if empty
  return words.length > 1 ? words : null;
}
