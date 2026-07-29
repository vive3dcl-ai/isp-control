import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as net from 'net';
import { execFile } from 'child_process';
import { promisify } from 'util';
import type { AuthUser } from '../auth/auth.types';
import { TenantConnectionService } from '../database/tenant-connection.service';
import { MikrotikClient } from './mikrotik.client';
import type { VpnTunnel } from './entities/vpn-tunnel.entity';
import { CreateVpnTunnelDto, UpdateVpnTunnelDto } from './dto/vpn.dto';
import {
  DEFAULT_VPN_PORTS,
  DEFAULT_VPN_TUNNEL_ROUTES,
  VPN_PROTOCOL_LABELS,
  type VpnProtocol,
} from './vpn.constants';
import {
  allocateTunnelSubnet,
  buildMikrotikBootstrapCommand,
  buildMikrotikVpnScript,
  buildWireguardConcentratorConf,
  buildOpenVpnConcentratorMikrotikCommands,
  buildOpenVpnConcentratorUserConfig,
  buildIpRouteAddWords,
  desiredVpnClientRouteCidrs,
  desiredWgClientAllowedAddress,
  generateWireguardKeyPair,
  normalizeRouteCidr,
  randomPassword,
  randomSetupToken,
  scriptToApiBatches,
  vpnClientInterfaceName,
  type VpnScriptContext,
  vpnEndpoint,
  type OpenVpnConcentratorUserInput,
  type WireguardConcentratorPeerInput,
} from './vpn-script.util';
import { PlatformPublicUrlsService } from '../platform/platform-public-urls.service';

const ACS_HINT_PORT = 14501;

@Injectable()
export class VpnService {
  constructor(
    private readonly tenantConnections: TenantConnectionService,
    private readonly mikrotik: MikrotikClient,
    private readonly config: ConfigService,
    private readonly publicUrls: PlatformPublicUrlsService,
  ) {}

  private requireSchema(user: AuthUser): string {
    if (!user.schemaName) {
      throw new BadRequestException('Tenant schema missing from session');
    }
    return user.schemaName;
  }

  private vpnHost() {
    return (
      this.config.get<string>('VPN_PUBLIC_HOST')?.trim() ||
      this.config.get<string>('PUBLIC_HOST')?.trim() ||
      ''
    );
  }

  private requireVpnPublicHost() {
    const host = this.vpnHost();
    if (!host || host === 'vpn.example.com') {
      throw new BadRequestException(
        'Define VPN_PUBLIC_HOST (dominio/IP del concentrador VPN) en el entorno',
      );
    }
    return host;
  }

  private wgServerPublicKey() {
    return (
      this.config.get<string>('VPN_WIREGUARD_SERVER_PUBLIC_KEY')?.trim() || null
    );
  }

  private wgServerPrivateKey() {
    return (
      this.config.get<string>('VPN_WIREGUARD_SERVER_PRIVATE_KEY')?.trim() ||
      null
    );
  }

  private requireWgServerPublicKey() {
    const key = this.wgServerPublicKey();
    if (!key) {
      throw new BadRequestException(
        'WireGuard concentrador: define VPN_WIREGUARD_SERVER_PUBLIC_KEY en el entorno',
      );
    }
    return key;
  }

  /** Puertos públicos del concentrador (env → defaults). */
  private vpnPortFor(protocol: VpnProtocol): number {
    const envKey: Record<VpnProtocol, string> = {
      openvpn_tcp: 'VPN_PORT_OPENVPN_TCP',
      openvpn_udp: 'VPN_PORT_OPENVPN_UDP',
      wireguard: 'VPN_PORT_WIREGUARD',
    };
    const raw = this.config.get<string>(envKey[protocol])?.trim();
    const n = raw ? Number(raw) : NaN;
    if (Number.isFinite(n) && n > 0 && n <= 65535) return Math.floor(n);
    return DEFAULT_VPN_PORTS[protocol];
  }

  /** Subnets 10.69.x usadas en todos los tenants (concentrador compartido). */
  private async listUsedTunnelSubnetsAcrossTenants(): Promise<string[]> {
    const admin = await this.tenantConnections.getPublicAdminDataSource();
    const used: string[] = [];
    try {
      const rows: Array<{ schema_name: string }> = await admin.query(`
        SELECT nspname AS schema_name
        FROM pg_namespace
        WHERE nspname NOT LIKE 'pg_%'
          AND nspname <> 'information_schema'
          AND nspname <> 'public'
      `);
      for (const row of rows) {
        try {
          const tunnels: Array<{ tunnel_subnet: string }> = await admin.query(
            `SELECT tunnel_subnet FROM "${row.schema_name}"."vpn_tunnels"`,
          );
          for (const t of tunnels) {
            if (t.tunnel_subnet) used.push(t.tunnel_subnet);
          }
        } catch {
          // schema without vpn_tunnels
        }
      }
    } finally {
      await admin.destroy();
    }
    return used;
  }

  private tenantLabelFromSchema(schema: string): string {
    return schema.startsWith('tenant_')
      ? schema.slice('tenant_'.length)
      : schema;
  }

  private sanitize(t: VpnTunnel) {
    const {
      password,
      wgPrivateKey,
      setupToken,
      setupTokenExpiresAt,
      endpointHost,
      mode,
      ...rest
    } = t;
    void endpointHost;
    void mode;
    return {
      ...rest,
      protocolLabel:
        VPN_PROTOCOL_LABELS[t.protocol as VpnProtocol] ?? t.protocol,
      hasPassword: !!password,
      hasWgKeys: !!wgPrivateKey,
      setupTokenValid:
        !!setupToken &&
        !!setupTokenExpiresAt &&
        setupTokenExpiresAt.getTime() > Date.now(),
    };
  }

  async list(user: AuthUser) {
    const schema = this.requireSchema(user);
    const repo = await this.tenantConnections.getVpnTunnelRepository(schema);
    const rows = await repo.find({ order: { createdAt: 'DESC' } });
    const live = await this.readLiveVpnPeers();
    const updated = await Promise.all(
      rows.map(async (t) => {
        const next = this.deriveLiveStatus(t, live);
        if (next !== t.status) {
          t.status = next;
          await repo.save(t);
        }
        return t;
      }),
    );
    return { tunnels: updated.map((t) => this.sanitize(t)) };
  }

  /** Peers vistos en el concentrador (OpenVPN status + WG handshakes). */
  private async readLiveVpnPeers(): Promise<{
    openvpn: Set<string>;
    openvpnIps: Set<string>;
    wireguardIps: Set<string>;
  }> {
    const dir =
      this.config.get<string>('VPN_RUNTIME_STATUS_DIR')?.trim() ||
      '/vpn-runtime';
    const openvpn = new Set<string>();
    const openvpnIps = new Set<string>();
    const wireguardIps = new Set<string>();

    const readLines = async (path: string) => {
      try {
        const text = await fs.promises.readFile(path, 'utf8');
        return text
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean);
      } catch {
        return [] as string[];
      }
    };

    for (const cn of await readLines(`${dir}/connected-clients.txt`)) {
      openvpn.add(cn);
    }
    for (const ip of await readLines(`${dir}/connected-ips.txt`)) {
      openvpnIps.add(ip);
    }

    // Fallback: parse openvpn-status.log (v1 o v2)
    try {
      const text = await fs.promises.readFile(
        `${dir}/openvpn-status.log`,
        'utf8',
      );
      let section = '';
      for (const raw of text.split(/\r?\n/)) {
        const line = raw.trim();
        if (!line) continue;
        if (line.startsWith('CLIENT_LIST,')) {
          const parts = line.split(',');
          if (parts[1]) openvpn.add(parts[1].trim());
          if (parts[3] && /^\d+\.\d+\.\d+\.\d+/.test(parts[3].trim())) {
            openvpnIps.add(parts[3].trim());
          }
          continue;
        }
        if (line.startsWith('ROUTING_TABLE,')) {
          const parts = line.split(',');
          if (parts[1]) openvpnIps.add(parts[1].trim());
          if (parts[2]) openvpn.add(parts[2].trim());
          continue;
        }
        if (line.startsWith('OpenVPN CLIENT LIST') || line === 'CLIENT LIST') {
          section = 'clients';
          continue;
        }
        if (line.startsWith('ROUTING TABLE')) {
          section = 'routing';
          continue;
        }
        if (line.startsWith('GLOBAL STATS') || line === 'END') {
          section = '';
          continue;
        }
        if (section === 'clients') {
          if (line.startsWith('Updated') || line.startsWith('Common Name')) {
            continue;
          }
          const cn = line.split(',')[0]?.trim();
          if (cn) openvpn.add(cn);
        }
        if (section === 'routing') {
          if (line.startsWith('Virtual Address')) continue;
          const parts = line.split(',');
          if (parts[0]) openvpnIps.add(parts[0].trim());
          if (parts[1]) openvpn.add(parts[1].trim());
        }
      }
    } catch {
      // volume not mounted / status not ready
    }

    try {
      const text = await fs.promises.readFile(`${dir}/wg-peers.txt`, 'utf8');
      const now = Math.floor(Date.now() / 1000);
      for (const raw of text.split(/\r?\n/)) {
        const [ip, hs] = raw.trim().split(/\s+/);
        if (!ip) continue;
        const handshake = Number(hs || 0);
        if (handshake > 0 && now - handshake < 180) {
          wireguardIps.add(ip);
        }
      }
    } catch {
      // optional
    }

    return { openvpn, openvpnIps, wireguardIps };
  }

  private deriveLiveStatus(
    tunnel: VpnTunnel,
    live: {
      openvpn: Set<string>;
      openvpnIps: Set<string>;
      wireguardIps: Set<string>;
    },
  ): string {
    const prev = tunnel.status || 'pending';
    if (tunnel.protocol === 'wireguard') {
      if (live.wireguardIps.has(tunnel.clientAddress)) return 'connected';
    } else if (
      live.openvpn.has(tunnel.name) ||
      live.openvpnIps.has(tunnel.clientAddress)
    ) {
      return 'connected';
    }
    if (prev === 'connected' || prev === 'online') return 'offline';
    return prev;
  }

  /** Diagnóstico: ruta Docker → peer VPN → puertos API MikroTik. */
  async probeTunnelReachability(user: AuthUser, id: string) {
    const schema = this.requireSchema(user);
    const repo = await this.tenantConnections.getVpnTunnelRepository(schema);
    const tunnel = await repo.findOne({ where: { id } });
    if (!tunnel) throw new NotFoundException('Tunnel not found');

    type Step = {
      id: string;
      label: string;
      ok: boolean;
      detail: string;
    };
    const steps: Step[] = [];

    // 1) Ruta en el contenedor API hacia la IP del túnel
    const route = await this.probeIpRoute(tunnel.clientAddress);
    steps.push({
      id: 'docker_route',
      label: `Ruta API → ${tunnel.clientAddress}`,
      ok: route.ok,
      detail: route.detail,
    });

    // 2) ¿El concentrador ve al peer?
    const live = await this.readLiveVpnPeers();
    const peerSeen =
      tunnel.protocol === 'wireguard'
        ? live.wireguardIps.has(tunnel.clientAddress)
        : live.openvpn.has(tunnel.name) ||
          live.openvpnIps.has(tunnel.clientAddress);
    steps.push({
      id: 'vpn_peer',
      label:
        tunnel.protocol === 'wireguard'
          ? 'Peer WireGuard en concentrador'
          : 'Cliente OpenVPN en concentrador',
      ok: peerSeen,
      detail: peerSeen
        ? `Peer activo (${tunnel.protocol === 'wireguard' ? tunnel.clientAddress : tunnel.name})`
        : 'No aparece en el status del concentrador (¿MikroTik conectado? ¿sync/volumen /vpn-runtime?)',
    });

    // 3) TCP a puertos de gestión
    const ports = [8729, 8728, 443];
    let reachable = false;
    let tcpDetail = '';
    const portResults: Array<{ port: number; ok: boolean; error?: string }> =
      [];
    for (const port of ports) {
      const r = await this.tcpProbe(tunnel.clientAddress, port, 2500);
      portResults.push({ port, ok: r.ok, error: r.error });
      if (r.ok) {
        reachable = true;
        tcpDetail = `OK ${tunnel.clientAddress}:${port}`;
        break;
      }
      tcpDetail = r.error || tcpDetail;
    }
    if (!reachable) {
      tcpDetail = portResults
        .map((p) => `${p.port}: ${p.ok ? 'ok' : p.error || 'fail'}`)
        .join(' · ');
    }
    steps.push({
      id: 'mgmt_tcp',
      label: 'API RouterOS (8729 / 8728 / 443)',
      ok: reachable,
      detail: tcpDetail,
    });

    let status = this.deriveLiveStatus(tunnel, live);
    if (reachable || peerSeen) status = 'connected';
    else if (status === 'connected' || status === 'online') status = 'offline';

    tunnel.status = status;
    await repo.save(tunnel);

    const failed = steps.find((s) => !s.ok);
    const summary = reachable
      ? `Llegamos a la gestión en ${tcpDetail}`
      : peerSeen && !reachable
        ? 'VPN up, pero la API no abre 8729/8728/443 (activa api-ssl en el MikroTik o re-aplica Script)'
        : !route.ok
          ? 'Falla la ruta Docker: recrea api+vpn con el compose nuevo (NET_ADMIN + volumen /vpn-runtime)'
          : !peerSeen
            ? 'El concentrador no ve al cliente: revisa ovpn-client en el MikroTik'
            : failed?.detail || 'Sin conectividad';

    return {
      ok: reachable || peerSeen,
      status,
      clientAddress: tunnel.clientAddress,
      serverAddress: tunnel.serverAddress,
      reachable,
      peerSeen,
      routeOk: route.ok,
      summary,
      steps,
      detail: summary,
      tunnel: this.sanitize(tunnel),
    };
  }

  private async probeIpRoute(
    dest: string,
  ): Promise<{ ok: boolean; detail: string }> {
    const execFileAsync = promisify(execFile);
    const vpnHost =
      this.config.get<string>('VPN_ROUTE_GATEWAY_HOST')?.trim() ||
      'vpn-concentrator';
    let expectedGw = '';
    try {
      const { stdout } = await execFileAsync('getent', ['hosts', vpnHost], {
        timeout: 2000,
      });
      expectedGw = stdout.trim().split(/\s+/)[0] || '';
    } catch {
      expectedGw = '';
    }

    try {
      const { stdout } = await execFileAsync('ip', ['route', 'get', dest], {
        timeout: 3000,
      });
      const out = stdout.trim().replace(/\s+/g, ' ');
      const via = out.match(/\bvia\s+(\d+\.\d+\.\d+\.\d+)/)?.[1] || '';
      const def = await this.readDefaultGateway();
      if (via && def && via === def) {
        return {
          ok: false,
          detail: `Ruta incorrecta (via gateway Docker ${via}, no ${vpnHost}). Recrea api con NET_ADMIN + entrypoint de ruta. ${out}`,
        };
      }
      if (expectedGw && via && via !== expectedGw) {
        return {
          ok: false,
          detail: `Ruta via ${via}, esperado ${vpnHost}(${expectedGw}). ${out}`,
        };
      }
      if (expectedGw && via === expectedGw) {
        return { ok: true, detail: out };
      }
      // sin "via" (on-link) o sin DNS aún
      return {
        ok: Boolean(via || /\bdev\b/.test(out)),
        detail: out || '(sin salida)',
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        ok: false,
        detail: `No se pudo consultar ruta: ${msg}`,
      };
    }
  }

  private async readDefaultGateway(): Promise<string> {
    const execFileAsync = promisify(execFile);
    try {
      const { stdout } = await execFileAsync(
        'ip',
        ['route', 'show', 'default'],
        { timeout: 2000 },
      );
      return stdout.match(/\bvia\s+(\d+\.\d+\.\d+\.\d+)/)?.[1] || '';
    } catch {
      return '';
    }
  }

  private tcpProbe(
    host: string,
    port: number,
    timeoutMs: number,
  ): Promise<{ ok: boolean; error?: string }> {
    return new Promise((resolve) => {
      const socket = new net.Socket();
      let done = false;
      const finish = (ok: boolean, error?: string) => {
        if (done) return;
        done = true;
        socket.destroy();
        resolve({ ok, error });
      };
      socket.setTimeout(timeoutMs);
      socket.once('connect', () => finish(true));
      socket.once('timeout', () => finish(false, `ETIMEDOUT ${host}:${port}`));
      socket.once('error', (e) =>
        finish(false, e.message || `error ${host}:${port}`),
      );
      socket.connect(port, host);
    });
  }

  async create(user: AuthUser, dto: CreateVpnTunnelDto) {
    const schema = this.requireSchema(user);
    const repo = await this.tenantConnections.getVpnTunnelRepository(schema);
    const existing = await repo.find();
    const protocol = dto.protocol as VpnProtocol;
    this.requireVpnPublicHost();

    const count = existing.length + 1;
    const name = (dto.name?.trim() || `tunnel${count}`).slice(0, 80);
    if (existing.some((t) => t.name === name)) {
      throw new BadRequestException(`Ya existe un túnel llamado ${name}`);
    }

    const alloc = dto.tunnelSubnet?.trim()
      ? this.parseSubnet(dto.tunnelSubnet.trim())
      : allocateTunnelSubnet(await this.listUsedTunnelSubnetsAcrossTenants());

    const password =
      protocol === 'wireguard'
        ? null
        : dto.password?.trim() || randomPassword(12);

    let wgPrivateKey: string | null = null;
    let wgPublicKey: string | null = null;
    if (protocol === 'wireguard') {
      this.requireWgServerPublicKey();
      const kp = generateWireguardKeyPair();
      wgPrivateKey = kp.privateKey;
      wgPublicKey = kp.publicKey;
    }

    const tunnel = await repo.save(
      repo.create({
        name,
        protocol,
        mode: 'outbound',
        endpointHost: null,
        tunnelSubnet: alloc.tunnelSubnet,
        clientAddress: alloc.clientAddress,
        serverAddress: alloc.serverAddress,
        password,
        wgPrivateKey,
        wgPublicKey,
        tunnelRoutes: (
          dto.tunnelRoutes?.trim() || DEFAULT_VPN_TUNNEL_ROUTES
        ).trim(),
        status: 'pending',
        note: dto.note?.trim() || null,
        setupToken: null,
        setupTokenExpiresAt: null,
      }),
    );

    return this.sanitize(tunnel);
  }

  private parseSubnet(cidr: string) {
    const m = cidr.match(/^(\d+\.\d+\.\d+)\.0\/24$/);
    if (!m) {
      throw new BadRequestException('tunnelSubnet must be like 10.69.10.0/24');
    }
    return {
      tunnelSubnet: cidr,
      serverAddress: `${m[1]}.1`,
      clientAddress: `${m[1]}.2`,
    };
  }

  async update(user: AuthUser, id: string, dto: UpdateVpnTunnelDto) {
    const schema = this.requireSchema(user);
    const repo = await this.tenantConnections.getVpnTunnelRepository(schema);
    const tunnel = await repo.findOne({ where: { id } });
    if (!tunnel) throw new NotFoundException('Tunnel not found');

    if (dto.name !== undefined) {
      const name = dto.name.trim();
      const clash = await repo.findOne({ where: { name } });
      if (clash && clash.id !== id) {
        throw new BadRequestException(`Ya existe un túnel llamado ${name}`);
      }
      tunnel.name = name;
    }
    if (dto.tunnelSubnet !== undefined && dto.tunnelSubnet.trim()) {
      const alloc = this.parseSubnet(dto.tunnelSubnet.trim());
      tunnel.tunnelSubnet = alloc.tunnelSubnet;
      tunnel.serverAddress = alloc.serverAddress;
      tunnel.clientAddress = alloc.clientAddress;
    }
    if (dto.tunnelRoutes !== undefined) {
      tunnel.tunnelRoutes =
        dto.tunnelRoutes.trim() || DEFAULT_VPN_TUNNEL_ROUTES;
    }
    if (dto.password !== undefined && dto.password !== '') {
      tunnel.password = dto.password;
    }
    if (dto.note !== undefined) tunnel.note = dto.note.trim() || null;

    await repo.save(tunnel);
    return this.sanitize(tunnel);
  }

  async remove(user: AuthUser, id: string) {
    const schema = this.requireSchema(user);
    const repo = await this.tenantConnections.getVpnTunnelRepository(schema);
    const tunnel = await repo.findOne({ where: { id } });
    if (!tunnel) throw new NotFoundException('Tunnel not found');
    await repo.delete({ id });
    return { ok: true };
  }

  private scriptContext(tunnel: VpnTunnel) {
    const protocol = tunnel.protocol as VpnProtocol;
    const host = this.requireVpnPublicHost();
    const { host: epHost, port } = vpnEndpoint(
      protocol,
      host,
      this.vpnPortFor(protocol),
    );
    return {
      name: tunnel.name,
      protocol,
      password: tunnel.password,
      clientAddress: tunnel.clientAddress,
      serverAddress: tunnel.serverAddress,
      tunnelRoutes: tunnel.tunnelRoutes.split(/\r?\n/),
      vpnHost: epHost,
      vpnPort: port,
      wgPrivateKey: tunnel.wgPrivateKey,
      wgServerPublicKey: this.wgServerPublicKey(),
    };
  }

  private buildRouterScript(tunnel: VpnTunnel): string {
    try {
      return buildMikrotikVpnScript(this.scriptContext(tunnel));
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Error generando script VPN';
      throw new BadRequestException(msg);
    }
  }

  async getSetup(user: AuthUser, id: string) {
    const schema = this.requireSchema(user);
    const repo = await this.tenantConnections.getVpnTunnelRepository(schema);
    const tunnel = await repo.findOne({ where: { id } });
    if (!tunnel) throw new NotFoundException('Tunnel not found');

    this.requireVpnPublicHost();
    if (tunnel.protocol === 'wireguard') {
      this.requireWgServerPublicKey();
    }

    const token = randomSetupToken();
    tunnel.setupToken = token;
    tunnel.setupTokenExpiresAt = new Date(Date.now() + 5 * 60 * 1000);
    if (tunnel.status === 'pending') {
      tunnel.status = 'configured';
    }
    await repo.save(tunnel);

    const ctx = this.scriptContext(tunnel);
    const script = this.buildRouterScript(tunnel);
    const acsUrlHint = `http://${tunnel.serverAddress}:${ACS_HINT_PORT}`;
    const apiBase = await this.publicUrls.resolvePublicApiUrl();
    const fetchUrl = apiBase ? `${apiBase}/public/vpn-setup/${token}` : '';
    const bootstrap = fetchUrl
      ? buildMikrotikBootstrapCommand({ fetchUrl })
      : null;

    return {
      tunnel: this.sanitize(tunnel),
      protocolLabel:
        VPN_PROTOCOL_LABELS[tunnel.protocol as VpnProtocol] ?? tunnel.protocol,
      expiresInSeconds: 300,
      endpoint: { host: ctx.vpnHost, port: ctx.vpnPort },
      script,
      acsUrlHint,
      bootstrap,
      fetchUrl: fetchUrl || null,
      note: apiBase
        ? `Bootstrap/script en MikroTik → ${ctx.vpnHost}:${ctx.vpnPort}. El concentrador sincroniza el usuario/peer solo.`
        : 'PUBLIC_API_URL no está configurada: usa el script completo (pegar todo).',
    };
  }

  /**
   * Config completa del concentrador WireGuard (todos los peers multi-tenant).
   * Requiere VPN_WIREGUARD_SERVER_PRIVATE_KEY para el bloque [Interface].
   */
  async getWireguardConcentratorConfig() {
    const publicKey = this.requireWgServerPublicKey();
    const privateKey = this.wgServerPrivateKey();
    if (!privateKey) {
      throw new BadRequestException(
        'Define VPN_WIREGUARD_SERVER_PRIVATE_KEY para generar el conf del concentrador',
      );
    }

    const peers: WireguardConcentratorPeerInput[] = [];
    const admin = await this.tenantConnections.getPublicAdminDataSource();
    try {
      const rows: Array<{ schema_name: string }> = await admin.query(`
        SELECT nspname AS schema_name
        FROM pg_namespace
        WHERE nspname NOT LIKE 'pg_%'
          AND nspname <> 'information_schema'
          AND nspname <> 'public'
      `);
      for (const row of rows) {
        try {
          const tunnels: Array<{
            name: string;
            protocol: string;
            mode: string;
            wg_public_key: string | null;
            client_address: string;
            server_address: string;
            tunnel_routes: string;
          }> = await admin.query(
            `SELECT name, protocol, mode, wg_public_key, client_address, server_address, tunnel_routes
             FROM "${row.schema_name}"."vpn_tunnels"
             WHERE protocol = 'wireguard'
               AND COALESCE(mode, 'outbound') = 'outbound'
               AND wg_public_key IS NOT NULL`,
          );
          for (const t of tunnels) {
            peers.push({
              tenantLabel: this.tenantLabelFromSchema(row.schema_name),
              tunnelName: t.name,
              clientPublicKey: t.wg_public_key!,
              clientAddress: t.client_address,
              serverAddress: t.server_address,
              lanRoutes: (t.tunnel_routes || '').split(/\r?\n/),
            });
          }
        } catch {
          // no table
        }
      }
    } finally {
      await admin.destroy();
    }

    const listenPort = this.vpnPortFor('wireguard');
    const conf = buildWireguardConcentratorConf({
      privateKey,
      listenPort,
      peers,
    });

    return {
      host: this.requireVpnPublicHost(),
      listenPort,
      publicKey,
      peerCount: peers.length,
      peers: peers.map((p) => ({
        tenant: p.tenantLabel,
        tunnel: p.tunnelName,
        clientAddress: p.clientAddress,
        serverAddress: p.serverAddress,
        clientPublicKey: p.clientPublicKey,
      })),
      conf,
    };
  }

  /** Usuarios OpenVPN del concentrador (todos los tenants, modo outbound). */
  async getOpenVpnConcentratorConfig() {
    const host = this.requireVpnPublicHost();
    const users: OpenVpnConcentratorUserInput[] = [];
    const admin = await this.tenantConnections.getPublicAdminDataSource();
    try {
      const rows: Array<{ schema_name: string }> = await admin.query(`
        SELECT nspname AS schema_name
        FROM pg_namespace
        WHERE nspname NOT LIKE 'pg_%'
          AND nspname <> 'information_schema'
          AND nspname <> 'public'
      `);
      for (const row of rows) {
        try {
          const tunnels: Array<{
            name: string;
            protocol: string;
            password: string | null;
            client_address: string;
            server_address: string;
            tunnel_routes: string;
          }> = await admin.query(
            `SELECT name, protocol, password, client_address, server_address, tunnel_routes
             FROM "${row.schema_name}"."vpn_tunnels"
             WHERE protocol IN ('openvpn_tcp', 'openvpn_udp')
               AND COALESCE(mode, 'outbound') = 'outbound'
               AND password IS NOT NULL`,
          );
          for (const t of tunnels) {
            const protocol = t.protocol as 'openvpn_tcp' | 'openvpn_udp';
            users.push({
              tenantLabel: this.tenantLabelFromSchema(row.schema_name),
              tunnelName: t.name,
              username: t.name,
              password: t.password!,
              clientAddress: t.client_address,
              serverAddress: t.server_address,
              protocol,
              vpnHost: host,
              vpnPort: this.vpnPortFor(protocol),
              lanRoutes: (t.tunnel_routes || '').split(/\r?\n/),
            });
          }
        } catch {
          // no table
        }
      }
    } finally {
      await admin.destroy();
    }

    const conf = users
      .map((u) => buildOpenVpnConcentratorUserConfig(u))
      .join('\n\n');
    const mikrotikCommands = users
      .map((u) => buildOpenVpnConcentratorMikrotikCommands(u))
      .join('\n\n');

    return {
      host,
      ports: {
        openvpn_tcp: this.vpnPortFor('openvpn_tcp'),
        openvpn_udp: this.vpnPortFor('openvpn_udp'),
      },
      userCount: users.length,
      users: users.map((u) => ({
        tenant: u.tenantLabel,
        tunnel: u.tunnelName,
        username: u.username,
        protocol: u.protocol,
        port: u.vpnPort,
        clientAddress: u.clientAddress,
        serverAddress: u.serverAddress,
      })),
      conf,
      mikrotikCommands,
    };
  }

  /**
   * Estado máquina para el contenedor concentrador (sync CCD / users / wg0).
   * Incluye passwords OpenVPN — solo red interna + secret.
   */
  async getConcentratorSyncState() {
    const host = this.config.get<string>('VPN_PUBLIC_HOST')?.trim() || '';
    const openvpnUsers: Array<{
      username: string;
      password: string;
      clientAddress: string;
      serverAddress: string;
      protocol: 'openvpn_tcp' | 'openvpn_udp';
      lanRoutes: string[];
    }> = [];
    const wireguardPeers: Array<{
      clientPublicKey: string;
      clientAddress: string;
      serverAddress: string;
      lanRoutes: string[];
    }> = [];

    const admin = await this.tenantConnections.getPublicAdminDataSource();
    try {
      const rows: Array<{ schema_name: string }> = await admin.query(`
        SELECT nspname AS schema_name
        FROM pg_namespace
        WHERE nspname NOT LIKE 'pg_%'
          AND nspname <> 'information_schema'
          AND nspname <> 'public'
      `);
      for (const row of rows) {
        try {
          const tunnels: Array<{
            name: string;
            protocol: string;
            mode: string | null;
            password: string | null;
            wg_public_key: string | null;
            client_address: string;
            server_address: string;
            tunnel_routes: string;
          }> = await admin.query(
            `SELECT name, protocol, mode, password, wg_public_key,
                    client_address, server_address, tunnel_routes
             FROM "${row.schema_name}"."vpn_tunnels"
             WHERE COALESCE(mode, 'outbound') = 'outbound'`,
          );
          for (const t of tunnels) {
            const routes = (t.tunnel_routes || '')
              .split(/\r?\n/)
              .map((r) => r.trim())
              .filter(Boolean);
            if (
              (t.protocol === 'openvpn_tcp' || t.protocol === 'openvpn_udp') &&
              t.password
            ) {
              openvpnUsers.push({
                username: t.name,
                password: t.password,
                clientAddress: t.client_address,
                serverAddress: t.server_address,
                protocol: t.protocol,
                lanRoutes: routes,
              });
            }
            if (t.protocol === 'wireguard' && t.wg_public_key) {
              wireguardPeers.push({
                clientPublicKey: t.wg_public_key,
                clientAddress: t.client_address,
                serverAddress: t.server_address,
                lanRoutes: routes,
              });
            }
          }
        } catch {
          // schema without vpn_tunnels
        }
      }
    } finally {
      await admin.destroy();
    }

    return {
      host,
      ports: {
        openvpnTcp: this.vpnPortFor('openvpn_tcp'),
        openvpnUdp: this.vpnPortFor('openvpn_udp'),
        wireguard: this.vpnPortFor('wireguard'),
      },
      wireguard: {
        privateKey: this.wgServerPrivateKey() || '',
        publicKey:
          this.config.get<string>('VPN_WIREGUARD_SERVER_PUBLIC_KEY')?.trim() ||
          '',
        peers: wireguardPeers,
      },
      openvpnUsers,
      generatedAt: new Date().toISOString(),
    };
  }

  async getSetupByTokenAcrossTenants(token: string): Promise<string> {
    const admin = await this.tenantConnections.getPublicAdminDataSource();
    try {
      const rows: Array<{ schema_name: string }> = await admin.query(`
      SELECT nspname AS schema_name
      FROM pg_namespace
      WHERE nspname NOT LIKE 'pg_%'
        AND nspname <> 'information_schema'
        AND nspname <> 'public'
    `);

      for (const row of rows) {
        const schema = row.schema_name;
        try {
          const found: Array<{ id: string }> = await admin.query(
            `SELECT id FROM "${schema}"."vpn_tunnels"
           WHERE setup_token = $1
             AND setup_token_expires_at > now()
           LIMIT 1`,
            [token],
          );
          if (!found.length) continue;
          const repo =
            await this.tenantConnections.getVpnTunnelRepository(schema);
          const tunnel = await repo.findOne({ where: { id: found[0].id } });
          if (!tunnel) continue;
          return this.buildRouterScript(tunnel);
        } catch {
          // schema may lack table
        }
      }
      throw new NotFoundException('Setup token invalid or expired');
    } finally {
      await admin.destroy();
    }
  }

  async importToRouter(
    user: AuthUser,
    id: string,
    deviceId: string,
    phase: 'connect' | 'plan' | 'apply' | 'verify' | 'all' = 'all',
  ) {
    if (phase === 'all') {
      const stages: Array<Record<string, unknown>> = [];
      for (const p of ['connect', 'plan', 'apply', 'verify'] as const) {
        const r = await this.importToRouterPhase(user, id, deviceId, p);
        const { phase: completedPhase, ...rest } = r;
        void completedPhase;
        stages.push({ phase: p, ...rest });
        if (!r.ok) {
          return {
            ok: false,
            phase: 'all' as const,
            stages,
            note: r.note || r.detail || `Falló en fase ${p}`,
            errors: r.errors ?? [],
            tunnel: r.tunnel,
          };
        }
      }
      const last = stages[stages.length - 1];
      return {
        ok: true,
        phase: 'all' as const,
        stages,
        note: (last.note as string) || 'Importación completa',
        detail: last.detail,
        errors: (last.errors as string[]) || [],
        tunnel: last.tunnel,
        addedRoutes: last.addedRoutes,
        skippedRoutes: last.skippedRoutes,
        checks: last.checks,
      };
    }
    return this.importToRouterPhase(user, id, deviceId, phase);
  }

  private async importToRouterPhase(
    user: AuthUser,
    id: string,
    deviceId: string,
    phase: 'connect' | 'plan' | 'apply' | 'verify',
  ) {
    const schema = this.requireSchema(user);
    const repo = await this.tenantConnections.getVpnTunnelRepository(schema);
    const tunnel = await repo.findOne({ where: { id } });
    if (!tunnel) throw new NotFoundException('Tunnel not found');

    const devices =
      await this.tenantConnections.getNetworkDeviceRepository(schema);
    const device = await devices.findOne({ where: { id: deviceId } });
    if (!device) throw new NotFoundException('Router not found');
    if (device.type === 'router' && !device.subtype) {
      device.subtype = 'mikrotik';
      await devices.save(device);
    }
    if (device.subtype !== 'mikrotik') {
      throw new BadRequestException(
        'Solo se puede importar a routers MikroTik',
      );
    }
    if (!device.mgmtHost || !device.mgmtUsername || !device.mgmtPassword) {
      throw new BadRequestException(
        'El router no tiene credenciales de gestión configuradas',
      );
    }
    const protocol = device.mgmtProtocol ?? 'api_ssl';
    if (protocol !== 'api_ssl' && protocol !== 'api_plain') {
      throw new BadRequestException(
        'La importación requiere API MikroTik (api_ssl o api_plain)',
      );
    }

    const port = device.mgmtPort ?? (protocol === 'api_plain' ? 8728 : 8729);
    const useTls = protocol === 'api_ssl';
    const conn = {
      host: device.mgmtHost,
      port,
      username: device.mgmtUsername,
      password: device.mgmtPassword,
      useTls,
    };

    const ctx = this.scriptContext(tunnel);
    const script = this.buildRouterScript(tunnel);
    const iface = vpnClientInterfaceName(ctx);
    const desiredRoutes = desiredVpnClientRouteCidrs(ctx);
    const tag = `isp-control ${tunnel.name}`;

    if (phase === 'connect') {
      const probe = await this.mikrotik.probe({
        host: conn.host,
        port: conn.port,
        username: conn.username,
        password: conn.password,
        protocol: useTls ? 'api_ssl' : 'api_plain',
      });
      return {
        ok: probe.ok,
        phase,
        detail: probe.ok
          ? `API OK · ${probe.identity || conn.host}${
              probe.version ? ` · ${probe.version}` : ''
            }`
          : probe.error || 'No se pudo conectar al MikroTik',
        identity: probe.identity ?? null,
        errors: probe.ok ? [] : [probe.error || 'connect failed'],
        tunnel: this.sanitize(tunnel),
        note: probe.ok
          ? 'Conexión RouterOS verificada'
          : 'No hay API RouterOS (¿8729/8728? ¿api-ssl?)',
      };
    }

    // Shared: iface exists?
    const ifaceProbe = await this.mikrotik.runWords({
      ...conn,
      words: ['/interface/print', `?name=${iface}`],
    });
    if (!ifaceProbe.ok) {
      return {
        ok: false,
        phase,
        detail: ifaceProbe.error || 'No se pudo listar interfaces',
        errors: [ifaceProbe.error || 'interface print failed'],
        tunnel: this.sanitize(tunnel),
        note: 'Fallo al consultar interfaces en el MikroTik',
      };
    }
    const ifaceExists = (ifaceProbe.rows?.length ?? 0) > 0;
    const mode = ifaceExists ? ('incremental' as const) : ('full' as const);

    if (phase === 'plan') {
      if (!ifaceExists) {
        return {
          ok: true,
          phase,
          mode,
          iface,
          ifaceExists: false,
          pendingCommands: scriptToApiBatches(script).length,
          addedRoutes: desiredRoutes,
          skippedRoutes: [] as string[],
          firewallPending: [
            'vpn-fwd-in',
            'vpn-fwd-out',
            'vpn-input',
            'vpn-no-masq',
          ],
          detail: `Interfaz ${iface} no existe → importación completa (${scriptToApiBatches(script).length} comandos)`,
          note: 'Plan: script completo del túnel',
          tunnel: this.sanitize(tunnel),
          errors: [] as string[],
        };
      }

      const plan = await this.buildIncrementalImportPlan(
        conn,
        ctx,
        tunnel,
        iface,
      );
      return {
        ok: true,
        phase,
        mode,
        iface,
        ifaceExists: true,
        pendingCommands: plan.commands.length,
        addedRoutes: plan.missingRoutes,
        skippedRoutes: plan.skippedRoutes,
        firewallPending: plan.firewallPending,
        updatedWgAllowed: plan.updatedWgAllowed,
        detail:
          plan.commands.length === 0
            ? 'Nada pendiente: rutas y reglas ya están'
            : `Pendiente: ${plan.missingRoutes.length} ruta(s), firewall ${plan.firewallPending.length}, cmds ${plan.commands.length}`,
        note: 'Plan incremental listo',
        tunnel: this.sanitize(tunnel),
        errors: [] as string[],
      };
    }

    if (phase === 'apply') {
      if (!ifaceExists) {
        const batches = scriptToApiBatches(script);
        const results = await this.mikrotik.runWordsMany({
          ...conn,
          commands: batches,
        });
        const failed = results.filter((r) => !r.ok);
        tunnel.lastImportedDeviceId = device.id;
        tunnel.lastImportedAt = new Date();
        tunnel.status =
          failed.length === results.length ? 'offline' : 'configured';
        await repo.save(tunnel);

        return {
          ok: failed.length < results.length || results.length === 0,
          phase,
          mode: 'full' as const,
          applied: results.length,
          failed: failed.length,
          addedRoutes: desiredRoutes,
          skippedRoutes: [] as string[],
          updatedWgAllowed: tunnel.protocol === 'wireguard',
          errors: failed
            .slice(0, 8)
            .map((f) => f.error)
            .filter(Boolean) as string[],
          script,
          detail: `Script completo: ${results.length - failed.length}/${results.length} OK`,
          note: 'Primera importación: se aplicó el script completo del túnel.',
          tunnel: this.sanitize(tunnel),
        };
      }

      const plan = await this.buildIncrementalImportPlan(
        conn,
        ctx,
        tunnel,
        iface,
      );
      const results =
        plan.commands.length > 0
          ? await this.mikrotik.runWordsMany({
              ...conn,
              commands: plan.commands,
            })
          : [];
      const failed = results.filter((r) => !r.ok);

      tunnel.lastImportedDeviceId = device.id;
      tunnel.lastImportedAt = new Date();
      tunnel.status =
        plan.commands.length > 0 && failed.length === results.length
          ? 'offline'
          : 'configured';
      await repo.save(tunnel);

      return {
        ok: failed.length === 0,
        phase,
        mode: 'incremental' as const,
        applied: results.length,
        failed: failed.length,
        addedRoutes: plan.missingRoutes,
        skippedRoutes: plan.skippedRoutes,
        updatedWgAllowed: plan.updatedWgAllowed,
        firewallPending: plan.firewallPending,
        errors: failed
          .slice(0, 8)
          .map((f) => f.error)
          .filter(Boolean) as string[],
        script,
        detail:
          plan.commands.length === 0
            ? 'Nada que aplicar'
            : `Aplicados ${results.length - failed.length}/${results.length}`,
        note:
          plan.missingRoutes.length === 0 &&
          !plan.updatedWgAllowed &&
          plan.commands.length === 0
            ? 'Nada que añadir: rutas y reglas ya estaban en el MikroTik.'
            : `Sync incremental: +${plan.missingRoutes.length} ruta(s)${
                plan.updatedWgAllowed ? ', WG allowed-address actualizado' : ''
              }; ${plan.skippedRoutes.length} ya existían.`,
        tunnel: this.sanitize(tunnel),
      };
    }

    // verify
    const checks: Array<{
      id: string;
      label: string;
      ok: boolean;
      detail: string;
    }> = [];

    checks.push({
      id: 'iface',
      label: `Interfaz ${iface}`,
      ok: ifaceExists,
      detail: ifaceExists ? 'Presente' : 'No encontrada en el router',
    });

    const existingRoutes = await this.mikrotik.runWords({
      ...conn,
      words: ['/ip/route/print'],
    });
    const existingCidrs = new Set<string>();
    for (const row of existingRoutes.rows ?? []) {
      const cidr = normalizeRouteCidr(row['dst-address']);
      if (cidr) existingCidrs.add(cidr);
    }
    const missingAfter = desiredRoutes.filter((c) => !existingCidrs.has(c));
    checks.push({
      id: 'routes',
      label: 'Rutas del túnel',
      ok: missingAfter.length === 0,
      detail:
        missingAfter.length === 0
          ? `${desiredRoutes.length} rutas OK`
          : `Faltan: ${missingAfter.join(', ')}`,
    });

    const filterPrint = await this.mikrotik.runWords({
      ...conn,
      words: ['/ip/firewall/filter/print'],
    });
    const filterComments = (filterPrint.rows ?? []).map((r) => r.comment || '');
    for (const key of ['vpn-fwd-in', 'vpn-fwd-out', 'vpn-input'] as const) {
      const ok = filterComments.some((c) => c.includes(`${tag} ${key}`));
      checks.push({
        id: key,
        label: `Firewall ${key}`,
        ok,
        detail: ok ? 'OK' : 'No encontrada',
      });
    }

    const natPrint = await this.mikrotik.runWords({
      ...conn,
      words: ['/ip/firewall/nat/print'],
    });
    const hasNoMasq = (natPrint.rows ?? []).some((r) =>
      (r.comment || '').includes(`${tag} vpn-no-masq`),
    );
    checks.push({
      id: 'vpn-no-masq',
      label: 'NAT no-masquerade túnel',
      ok: hasNoMasq,
      detail: hasNoMasq ? 'OK' : 'No encontrada',
    });

    const allOk = checks.every((c) => c.ok);
    return {
      ok: allOk,
      phase,
      mode,
      checks,
      addedRoutes: desiredRoutes.filter((c) => existingCidrs.has(c)),
      skippedRoutes: missingAfter,
      detail: allOk
        ? 'Verificación OK: interfaz, rutas y firewall'
        : `Verificación incompleta (${checks.filter((c) => !c.ok).length} fallos)`,
      note: allOk
        ? 'Reglas confirmadas en el MikroTik'
        : 'Algunas reglas/rutas no aparecen; reintenta Apply o revisa el script',
      errors: checks.filter((c) => !c.ok).map((c) => `${c.label}: ${c.detail}`),
      tunnel: this.sanitize(tunnel),
    };
  }

  private async buildIncrementalImportPlan(
    conn: {
      host: string;
      port: number;
      username: string;
      password: string;
      useTls: boolean;
    },
    ctx: VpnScriptContext,
    tunnel: VpnTunnel,
    iface: string,
  ) {
    const desiredRoutes = desiredVpnClientRouteCidrs(ctx);
    const existingRoutes = await this.mikrotik.runWords({
      ...conn,
      words: ['/ip/route/print'],
    });
    const existingCidrs = new Set<string>();
    for (const row of existingRoutes.rows ?? []) {
      const cidr = normalizeRouteCidr(row['dst-address']);
      if (cidr) existingCidrs.add(cidr);
    }

    const missingRoutes = desiredRoutes.filter((c) => !existingCidrs.has(c));
    const skippedRoutes = desiredRoutes.filter((c) => existingCidrs.has(c));

    const commands: string[][] = [];
    for (const cidr of missingRoutes) {
      const kind = cidr === `${ctx.serverAddress}/32` ? 'peer' : 'route';
      commands.push(buildIpRouteAddWords(cidr, iface, tunnel.name, kind));
    }

    const tag = `isp-control ${tunnel.name}`;
    const filterPrint = await this.mikrotik.runWords({
      ...conn,
      words: ['/ip/firewall/filter/print'],
    });
    const filterComments = new Set(
      (filterPrint.rows ?? []).map((r) => r.comment || '').filter(Boolean),
    );
    const firewallPending: string[] = [];
    const needFwdIn = ![...filterComments].some((c) =>
      c.includes(`${tag} vpn-fwd-in`),
    );
    const needFwdOut = ![...filterComments].some((c) =>
      c.includes(`${tag} vpn-fwd-out`),
    );
    const needInput = ![...filterComments].some((c) =>
      c.includes(`${tag} vpn-input`),
    );
    if (needFwdIn) {
      firewallPending.push('vpn-fwd-in');
      commands.push([
        '/ip/firewall/filter/add',
        '=chain=forward',
        `=in-interface=${iface}`,
        '=action=accept',
        `=comment=${tag} vpn-fwd-in`,
        '=place-before=0',
      ]);
    }
    if (needFwdOut) {
      firewallPending.push('vpn-fwd-out');
      commands.push([
        '/ip/firewall/filter/add',
        '=chain=forward',
        `=out-interface=${iface}`,
        '=action=accept',
        `=comment=${tag} vpn-fwd-out`,
        '=place-before=0',
      ]);
    }
    if (needInput) {
      firewallPending.push('vpn-input');
      commands.push([
        '/ip/firewall/filter/add',
        '=chain=input',
        `=in-interface=${iface}`,
        '=action=accept',
        `=comment=${tag} vpn-input`,
        '=place-before=0',
      ]);
    }

    const natPrint = await this.mikrotik.runWords({
      ...conn,
      words: ['/ip/firewall/nat/print'],
    });
    const hasNoMasq = (natPrint.rows ?? []).some((r) =>
      (r.comment || '').includes(`${tag} vpn-no-masq`),
    );
    if (!hasNoMasq) {
      firewallPending.push('vpn-no-masq');
      commands.push([
        '/ip/firewall/nat/add',
        '=chain=srcnat',
        `=out-interface=${iface}`,
        '=action=accept',
        `=comment=${tag} vpn-no-masq`,
        '=place-before=0',
      ]);
    }

    let updatedWgAllowed = false;
    if (tunnel.protocol === 'wireguard') {
      const peers = await this.mikrotik.runWords({
        ...conn,
        words: ['/interface/wireguard/peers/print', `?interface=${iface}`],
      });
      const peer = peers.rows?.[0];
      const peerId = peer?.['.id'];
      if (peerId) {
        const allowed = desiredWgClientAllowedAddress(ctx);
        const current = (peer['allowed-address'] || '').replace(/\s/g, '');
        if (current !== allowed) {
          commands.push([
            '/interface/wireguard/peers/set',
            `=.id=${peerId}`,
            `=allowed-address=${allowed}`,
          ]);
          updatedWgAllowed = true;
        }
      }
    }

    return {
      commands,
      missingRoutes,
      skippedRoutes,
      firewallPending,
      updatedWgAllowed,
    };
  }
}
