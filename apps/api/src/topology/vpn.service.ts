import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AuthUser } from '../auth/auth.types';
import { TenantConnectionService } from '../database/tenant-connection.service';
import { MikrotikClient } from './mikrotik.client';
import type { VpnTunnel } from './entities/vpn-tunnel.entity';
import {
  CreateVpnTunnelDto,
  UpdateVpnTunnelDto,
} from './dto/vpn.dto';
import {
  DEFAULT_VPN_PORTS,
  DEFAULT_VPN_TUNNEL_ROUTES,
  VPN_MODE_LABELS,
  VPN_PROTOCOL_LABELS,
  type VpnMode,
  type VpnProtocol,
} from './vpn.constants';
import {
  allocateTunnelSubnet,
  buildLocalOpenVpnClientConfig,
  buildMikrotikBootstrapCommand,
  buildMikrotikOpenVpnServerScript,
  buildMikrotikVpnScript,
  buildWireguardConcentratorApplyCommands,
  buildWireguardConcentratorConf,
  buildWireguardConcentratorPeer,
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

  private isReverse(tunnel: VpnTunnel): boolean {
    return (tunnel.mode || 'outbound') === 'reverse';
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
    return schema.startsWith('tenant_') ? schema.slice('tenant_'.length) : schema;
  }

  private concentratorPeerFromTunnel(
    schema: string,
    tunnel: VpnTunnel,
  ): WireguardConcentratorPeerInput | null {
    if (tunnel.protocol !== 'wireguard' || this.isReverse(tunnel)) return null;
    if (!tunnel.wgPublicKey) return null;
    return {
      tenantLabel: this.tenantLabelFromSchema(schema),
      tunnelName: tunnel.name,
      clientPublicKey: tunnel.wgPublicKey,
      clientAddress: tunnel.clientAddress,
      serverAddress: tunnel.serverAddress,
      lanRoutes: tunnel.tunnelRoutes.split(/\r?\n/),
    };
  }

  private concentratorOpenVpnUserFromTunnel(
    schema: string,
    tunnel: VpnTunnel,
  ): OpenVpnConcentratorUserInput | null {
    if (this.isReverse(tunnel)) return null;
    if (
      tunnel.protocol !== 'openvpn_tcp' &&
      tunnel.protocol !== 'openvpn_udp'
    ) {
      return null;
    }
    if (!tunnel.password) return null;
    const protocol = tunnel.protocol as 'openvpn_tcp' | 'openvpn_udp';
    return {
      tenantLabel: this.tenantLabelFromSchema(schema),
      tunnelName: tunnel.name,
      username: tunnel.name,
      password: tunnel.password,
      clientAddress: tunnel.clientAddress,
      serverAddress: tunnel.serverAddress,
      protocol,
      vpnHost: this.requireVpnPublicHost(),
      vpnPort: this.vpnPortFor(protocol),
      lanRoutes: tunnel.tunnelRoutes.split(/\r?\n/),
    };
  }

  private sanitize(t: VpnTunnel) {
    const {
      password,
      wgPrivateKey,
      setupToken,
      setupTokenExpiresAt,
      ...rest
    } = t;
    const mode = (t.mode || 'outbound') as VpnMode;
    return {
      ...rest,
      mode,
      protocolLabel:
        VPN_PROTOCOL_LABELS[t.protocol as VpnProtocol] ?? t.protocol,
      modeLabel: VPN_MODE_LABELS[mode] ?? mode,
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
    return { tunnels: rows.map((t) => this.sanitize(t)) };
  }

  async create(user: AuthUser, dto: CreateVpnTunnelDto) {
    const schema = this.requireSchema(user);
    const repo = await this.tenantConnections.getVpnTunnelRepository(schema);
    const existing = await repo.find();
    const mode = (dto.mode?.trim() || 'outbound') as VpnMode;
    let protocol = dto.protocol as VpnProtocol;

    if (mode === 'reverse') {
      if (protocol !== 'openvpn_tcp') {
        throw new BadRequestException(
          'El modo inverso solo soporta OpenVPN TCP en esta versión',
        );
      }
      protocol = 'openvpn_tcp';
      const host = dto.endpointHost?.trim();
      if (!host) {
        throw new BadRequestException(
          'endpointHost (IP/hostname público del MikroTik) es requerido en modo inverso',
        );
      }
    } else {
      this.requireVpnPublicHost();
    }

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
      if (mode !== 'reverse') this.requireWgServerPublicKey();
      const kp = generateWireguardKeyPair();
      wgPrivateKey = kp.privateKey;
      wgPublicKey = kp.publicKey;
    }

    const tunnel = await repo.save(
      repo.create({
        name,
        protocol,
        mode,
        endpointHost:
          mode === 'reverse' ? dto.endpointHost!.trim() : null,
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
      throw new BadRequestException(
        'tunnelSubnet must be like 10.69.10.0/24',
      );
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
    if (dto.endpointHost !== undefined) {
      if (this.isReverse(tunnel)) {
        const host = dto.endpointHost.trim();
        if (!host) {
          throw new BadRequestException(
            'endpointHost no puede quedar vacío en modo inverso',
          );
        }
        tunnel.endpointHost = host;
      }
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
    const reverse = this.isReverse(tunnel);
    const host = reverse
      ? (tunnel.endpointHost || '').trim()
      : this.requireVpnPublicHost();
    if (reverse && !host) {
      throw new BadRequestException(
        'endpointHost requerido en modo inverso para generar scripts',
      );
    }
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
      const ctx = this.scriptContext(tunnel);
      return this.isReverse(tunnel)
        ? buildMikrotikOpenVpnServerScript(ctx)
        : buildMikrotikVpnScript(ctx);
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

    if (!this.isReverse(tunnel)) {
      this.requireVpnPublicHost();
      if (tunnel.protocol === 'wireguard') {
        this.requireWgServerPublicKey();
      }
    }

    const token = randomSetupToken();
    tunnel.setupToken = token;
    tunnel.setupTokenExpiresAt = new Date(Date.now() + 5 * 60 * 1000);
    await repo.save(tunnel);

    const ctx = this.scriptContext(tunnel);
    const reverse = this.isReverse(tunnel);
    const script = this.buildRouterScript(tunnel);
    const acsClientConfig = reverse
      ? buildLocalOpenVpnClientConfig(ctx)
      : null;
    const acsUrlHint = reverse
      ? `http://${tunnel.clientAddress}:${ACS_HINT_PORT}`
      : `http://${tunnel.serverAddress}:${ACS_HINT_PORT}`;
    const apiBase = await this.publicUrls.resolvePublicApiUrl();
    const fetchUrl = apiBase
      ? `${apiBase}/public/vpn-setup/${token}`
      : '';
    const bootstrap = fetchUrl
      ? buildMikrotikBootstrapCommand({ fetchUrl })
      : null;

    const mode = (tunnel.mode || 'outbound') as VpnMode;
    const peer = this.concentratorPeerFromTunnel(schema, tunnel);
    const concentratorPeerConfig = peer
      ? buildWireguardConcentratorPeer(peer)
      : null;
    const concentratorApplyCommands = peer
      ? buildWireguardConcentratorApplyCommands(peer)
      : null;
    const ovpnUser = this.concentratorOpenVpnUserFromTunnel(schema, tunnel);
    const concentratorOpenVpnConfig = ovpnUser
      ? buildOpenVpnConcentratorUserConfig(ovpnUser)
      : null;
    const concentratorOpenVpnMikrotik = ovpnUser
      ? buildOpenVpnConcentratorMikrotikCommands(ovpnUser)
      : null;

    return {
      tunnel: this.sanitize(tunnel),
      protocolLabel:
        VPN_PROTOCOL_LABELS[tunnel.protocol as VpnProtocol] ??
        tunnel.protocol,
      mode,
      modeLabel: VPN_MODE_LABELS[mode] ?? mode,
      expiresInSeconds: 300,
      endpoint: { host: ctx.vpnHost, port: ctx.vpnPort },
      script,
      acsClientConfig,
      acsUrlHint,
      bootstrap,
      fetchUrl: fetchUrl || null,
      concentratorPeerConfig,
      concentratorApplyCommands,
      concentratorOpenVpnConfig,
      concentratorOpenVpnMikrotik,
      note: reverse
        ? `Modo inverso: el MikroTik escucha OpenVPN TCP en ${ctx.vpnHost}:${ctx.vpnPort}. Aplica el script servidor, exporta el CA y conecta el ACS con el .ovpn (remote = IP/hostname del MikroTik, no VPN_PUBLIC_HOST).`
        : peer
          ? `1) Peer en concentrador WireGuard. 2) Bootstrap/script en MikroTik → ${ctx.vpnHost}:${ctx.vpnPort}.`
          : ovpnUser
            ? `1) Crea el usuario/CCD en el concentrador OpenVPN. 2) Bootstrap/script en MikroTik → connect-to=${ctx.vpnHost} port=${ctx.vpnPort}.`
            : apiBase
              ? 'Copia el comando bootstrap en el terminal RouterOS (válido ~5 min).'
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

  async importToRouter(user: AuthUser, id: string, deviceId: string) {
    const schema = this.requireSchema(user);
    const repo = await this.tenantConnections.getVpnTunnelRepository(schema);
    const tunnel = await repo.findOne({ where: { id } });
    if (!tunnel) throw new NotFoundException('Tunnel not found');

    const devices =
      await this.tenantConnections.getNetworkDeviceRepository(schema);
    const device = await devices.findOne({ where: { id: deviceId } });
    if (!device) throw new NotFoundException('Router not found');
    if (device.subtype !== 'mikrotik') {
      throw new BadRequestException('Solo se puede importar a routers MikroTik');
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

    const port =
      device.mgmtPort ?? (protocol === 'api_plain' ? 8728 : 8729);
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
    const reverse = this.isReverse(tunnel);

    // ¿Ya existe la interfaz del túnel? → sync incremental de rutas/reglas
    const ifaceProbe = await this.mikrotik.runWords({
      ...conn,
      words: ['/interface/print', `?name=${iface}`],
    });
    const ifaceExists =
      !reverse &&
      ifaceProbe.ok &&
      (ifaceProbe.rows?.length ?? 0) > 0;

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
        mode: 'full' as const,
        tunnel: this.sanitize(tunnel),
        applied: results.length,
        failed: failed.length,
        addedRoutes: desiredVpnClientRouteCidrs(ctx),
        skippedRoutes: [] as string[],
        updatedWgAllowed: tunnel.protocol === 'wireguard',
        errors: failed.slice(0, 5).map((f) => f.error),
        script,
        note: reverse
          ? 'Importación completa (modo inverso).'
          : 'Primera importación: se aplicó el script completo del túnel.',
      };
    }

    // --- Incremental: rutas + firewall + WG allowed-address ---
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
      const kind =
        cidr === `${ctx.serverAddress}/32` ? 'peer' : 'route';
      commands.push(buildIpRouteAddWords(cidr, iface, tunnel.name, kind));
    }

    // Firewall de acceso: solo si falta alguna regla de este túnel
    const tag = `isp-control ${tunnel.name}`;
    const filterPrint = await this.mikrotik.runWords({
      ...conn,
      words: ['/ip/firewall/filter/print'],
    });
    const filterComments = new Set(
      (filterPrint.rows ?? [])
        .map((r) => r.comment || '')
        .filter(Boolean),
    );
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
        words: [
          '/interface/wireguard/peers/print',
          `?interface=${iface}`,
        ],
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

    const results =
      commands.length > 0
        ? await this.mikrotik.runWordsMany({ ...conn, commands })
        : [];
    const failed = results.filter((r) => !r.ok);

    tunnel.lastImportedDeviceId = device.id;
    tunnel.lastImportedAt = new Date();
    tunnel.status =
      commands.length > 0 && failed.length === results.length
        ? 'offline'
        : 'configured';
    await repo.save(tunnel);

    return {
      ok: failed.length === 0,
      mode: 'incremental' as const,
      tunnel: this.sanitize(tunnel),
      applied: results.length,
      failed: failed.length,
      addedRoutes: missingRoutes,
      skippedRoutes,
      updatedWgAllowed,
      errors: failed.slice(0, 5).map((f) => f.error),
      script,
      note:
        missingRoutes.length === 0 && !updatedWgAllowed && commands.length === 0
          ? 'Nada que añadir: rutas y reglas ya estaban en el MikroTik.'
          : `Sync incremental: +${missingRoutes.length} ruta(s)${
              updatedWgAllowed ? ', WG allowed-address actualizado' : ''
            }; ${skippedRoutes.length} ya existían.`,
    };
  }
}
