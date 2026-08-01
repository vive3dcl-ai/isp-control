import { generateKeyPairSync, randomBytes } from 'crypto';
import type { VpnProtocol } from './vpn.constants';
import {
  DEFAULT_VPN_PORTS,
  VPN_TUNNEL_THIRD_OCTET_RANGES,
} from './vpn.constants';

export function randomPassword(length = 12): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
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

/** Allocate 10.69.<n>.0/24 from the range the protocol's server pool covers. */
export function allocateTunnelSubnet(
  existing: string[],
  protocol: VpnProtocol = 'openvpn_tcp',
): {
  tunnelSubnet: string;
  serverAddress: string;
  clientAddress: string;
} {
  const used = new Set<number>();
  for (const cidr of existing) {
    const m = cidr.match(/^10\.69\.(\d+)\.0\/24$/);
    if (m) used.add(Number(m[1]));
  }
  const { first, last } = VPN_TUNNEL_THIRD_OCTET_RANGES[protocol];
  let n = first;
  while (used.has(n) && n < last) n += 1;
  if (used.has(n)) {
    throw new Error(
      `Sin subredes libres para ${protocol} (10.69.${first}.0/24 – 10.69.${last}.0/24)`,
    );
  }
  return {
    tunnelSubnet: `10.69.${n}.0/24`,
    serverAddress: `10.69.${n}.1`,
    clientAddress: `10.69.${n}.2`,
  };
}

/** Is this /24 inside the pool the concentrator serves for that protocol? */
export function tunnelSubnetMatchesProtocol(
  tunnelSubnet: string,
  protocol: VpnProtocol,
): boolean {
  const m = tunnelSubnet.match(/^10\.69\.(\d+)\.0\/24$/);
  if (!m) return false;
  const n = Number(m[1]);
  const { first, last } = VPN_TUNNEL_THIRD_OCTET_RANGES[protocol];
  return n >= first && n <= last;
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
export function normalizeRouteCidr(
  raw: string | undefined | null,
): string | null {
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

// eslint-disable-next-line no-control-regex
const UNSAFE_ROUTEROS_PASSWORD_RE = new RegExp('[\\x00-\\x1F\\x7F"\\\\]');

function assertSafeRouterOsContext(ctx: VpnScriptContext): void {
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(ctx.name)) {
    throw new Error(
      'Nombre de túnel inválido para RouterOS (usa letras, números, _ o -)',
    );
  }
  if (ctx.password && UNSAFE_ROUTEROS_PASSWORD_RE.test(ctx.password)) {
    throw new Error(
      'La contraseña contiene caracteres inseguros para RouterOS',
    );
  }
  if (
    !/^(?:[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?|\d{1,3}(?:\.\d{1,3}){3})$/.test(
      ctx.vpnHost,
    )
  ) {
    throw new Error('VPN_PUBLIC_HOST no es un hostname o IPv4 válido');
  }
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
    `# API RouterOS desde el concentrador (gestión ISP Control)`,
    `:do { /ip service set api disabled=no } on-error={}`,
    // api-ssl sin certificado escucha pero nunca completa el TLS: el panel
    // se queda esperando el handshake. Firmamos uno propio si no hay.
    `:local apiCert ""`,
    `:do { :set apiCert [/ip service get api-ssl certificate] } on-error={}`,
    `:if ($apiCert = "" or $apiCert = "none") do={`,
    `  :if ([:len [/certificate find name="isp-control-api"]] = 0) do={`,
    `    :do { /certificate add name="isp-control-api" common-name="isp-control-api" key-size=2048 days-valid=3650 key-usage=digital-signature,key-encipherment,tls-server } on-error={}`,
    `    :do { /certificate sign "isp-control-api" } on-error={}`,
    `    :delay 5s`,
    `  }`,
    `  :do { /ip service set api-ssl certificate="isp-control-api" } on-error={}`,
    `}`,
    `:do { /ip service set api-ssl disabled=no } on-error={}`,
    `# Evita masquerade hacia el túnel (si hay srcnat genérico, place-before=0 gana)`,
    `/ip firewall nat add chain=srcnat out-interface="${iface}" action=accept comment="${tag} vpn-no-masq" place-before=0`,
    `/ip firewall mangle add chain=forward in-interface="${iface}" protocol=tcp tcp-flags=syn action=change-mss new-mss=1200 comment="${tag} vpn-mss-fwd"`,
    `/ip firewall mangle add chain=forward out-interface="${iface}" protocol=tcp tcp-flags=syn action=change-mss new-mss=1200 comment="${tag} vpn-mss-fwd"`,
  ];
}

/** Full RouterOS script (manual paste), SmartOLT-style. */
export function buildMikrotikVpnScript(ctx: VpnScriptContext): string {
  assertSafeRouterOsContext(ctx);
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
      `/interface ovpn-client add name="${name}" connect-to=${host} port=${ctx.vpnPort} mode=ip user="${ctx.name}" password="${pass}" protocol=${proto} cipher=aes256-cbc auth=sha1 verify-server-certificate=no add-default-route=no disabled=no comment="isp-control ${ctx.name}"`,
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

/** Tablas de firewall que hay que imprimir para resolver `place-before`. */
export function placeBeforeTables(batches: string[][]): string[] {
  const tables = new Set<string>();
  for (const words of batches) {
    if (!words.some((w) => w.startsWith('=place-before='))) continue;
    tables.add(words[0].replace(/\/add$/, ''));
  }
  return [...tables];
}

/**
 * `place-before=0` es el ordinal del CLI; por la API el valor debe ser un `.id`
 * interno (`*3`) o el add falla con "no such item" y la regla nunca se crea.
 * Se apunta a la primera regla de la misma cadena; si la cadena está vacía se
 * quita el argumento, porque entonces la regla ya queda primera.
 */
export function resolvePlaceBeforeBatches(
  batches: string[][],
  rowsByTable: Record<string, Array<Record<string, string>>>,
): string[][] {
  return batches.map((words) => {
    const idx = words.findIndex((w) => w.startsWith('=place-before='));
    if (idx < 0) return words;
    const table = words[0].replace(/\/add$/, '');
    const chain =
      words.find((w) => w.startsWith('=chain='))?.slice('=chain='.length) ?? '';
    const firstOfChain = (rowsByTable[table] ?? []).find(
      (r) => (r.chain || '') === chain && !!r['.id'],
    );
    const next = words.slice();
    if (firstOfChain?.['.id']) {
      next[idx] = `=place-before=${firstOfChain['.id']}`;
    } else {
      next.splice(idx, 1);
    }
    return next;
  });
}

/** Convert script lines to RouterOS API word batches for import. */
export function scriptToApiBatches(script: string): string[][] {
  const batches: string[][] = [];
  // The API cannot evaluate RouterOS conditionals, and running the body
  // unconditionally would be wrong (e.g. rebinding a working api-ssl
  // certificate). Those blocks only apply when the script is imported.
  let conditionalDepth = 0;
  for (const raw of script.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith(':put')) continue;
    if (/^:if\b.*do=\{$/.test(line)) {
      conditionalDepth += 1;
      continue;
    }
    if (conditionalDepth > 0) {
      if (line === '}') conditionalDepth -= 1;
      continue;
    }
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
  // CLI paths are space separated (`/ip firewall filter add`); the API wants
  // them slash separated (`/ip/firewall/filter/add`).
  const m = line.match(
    /^(\/[a-z0-9/-]+(?:\s+[a-z0-9/-]+)*)\s+(add|remove|set|sign)\s+(.+)$/i,
  );
  if (!m) return null;
  const path = `/${m[1]
    .slice(1)
    .trim()
    .split(/[\s/]+/)
    .join('/')}`;
  const action = m[2].toLowerCase();
  const rest = m[3];

  // `set` on a named item (`/ip service set api-ssl disabled=no`) needs an
  // .id the CLI resolves implicitly — not translatable, leave it to the import.
  if (action === 'set' && !/^[a-z0-9-]+=/i.test(rest)) return null;

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
