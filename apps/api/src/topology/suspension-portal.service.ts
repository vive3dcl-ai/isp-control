import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { lookup } from 'dns/promises';
import { Repository } from 'typeorm';
import type { AuthUser } from '../auth/auth.types';
import { TenantConnectionService } from '../database/tenant-connection.service';
import { Tenant } from '../tenants/entities/tenant.entity';
import type { ClientService } from '../crm/entities/client-service.entity';
import { NetworkDevice } from './entities/network-device.entity';
import { MikrotikClient } from './mikrotik.client';
import {
  DEFAULT_SUSPENSION_PORTAL_TEMPLATE,
  renderSuspensionPortalTemplate,
  resolveSuspensionPortalTemplateId,
  SUSPENSION_PORTAL_TEMPLATES,
  type SuspensionPortalTemplateVars,
} from './suspension-portal-templates';
import {
  internalSuspensionPortalUrl,
  isReservedTenantSlug,
  normalizePortalUrl,
  parsePortalUrl,
  type PortalTarget,
} from './suspension-portal-url';
import { PlatformPublicUrlsService } from '../platform/platform-public-urls.service';

export const SUSPENDED_LIST = 'isp-control-suspended';
/** Destinos permitidos mientras está suspendido (portal aparte). */
export const SUSPENDED_ALLOW_LIST = 'isp-control-suspended-allow';

const COMMENT_NAT = 'isp-control-suspended-nat-http';
const COMMENT_DNS_UDP = 'isp-control-suspended-allow-dns-udp';
const COMMENT_DNS_TCP = 'isp-control-suspended-allow-dns-tcp';
const COMMENT_PORTAL = 'isp-control-suspended-allow-portal';
const COMMENT_PAYMENTS = 'isp-control-suspended-allow-payments';
const COMMENT_DROP = 'isp-control-suspended-drop';

/**
 * Dominios de pago permitidos en suspensión (HTTPS incluido).
 * Ampliar esta lista cuando se agreguen más métodos (Stripe, PayPal, etc.).
 * MikroTik resuelve FQDN → IP en la address-list.
 */
export const SUSPENSION_PAYMENT_ALLOW_DOMAINS: readonly string[] = [
  // Mercado Pago / Mercado Libre
  'www.mercadopago.com',
  'mercadopago.com',
  'api.mercadopago.com',
  'sdk.mercadopago.com',
  'www.mercadopago.com.ar',
  'www.mercadopago.com.mx',
  'www.mercadopago.cl',
  'www.mercadopago.com.co',
  'www.mercadopago.com.pe',
  'www.mercadopago.com.uy',
  'www.mercadopago.com.br',
  'www.mercadopago.com.ve',
  'www.mercadolibre.com',
  'www.mercadolibre.com.ar',
  'www.mercadolibre.com.mx',
  'www.mercadolibre.cl',
  'www.mercadolibre.com.co',
  'www.mercadolibre.com.pe',
  'www.mercadolibre.com.uy',
  'www.mercadolibre.com.br',
  'api.mercadolibre.com',
  'http2.mlstatic.com',
  'secure.mlstatic.com',
  'static.mlstatic.com',
  'www.mlstatic.com',
];

function svcComment(serviceId: string) {
  return `isp-control-svc:${serviceId}`;
}

function allowDomainComment(domain: string) {
  return `isp-control-allow:${domain}`;
}

type MikroTikConn = {
  host: string;
  port: number;
  username: string;
  password: string;
  useTls: boolean;
};

export type ConfigureRouterResult = {
  routerId: string;
  routerName: string;
  ok: boolean;
  message: string;
};

@Injectable()
export class SuspensionPortalService {
  private readonly logger = new Logger(SuspensionPortalService.name);

  constructor(
    private readonly tenantConnections: TenantConnectionService,
    private readonly mikrotik: MikrotikClient,
    private readonly publicUrls: PlatformPublicUrlsService,
    @InjectRepository(Tenant)
    private readonly tenants: Repository<Tenant>,
  ) {}

  /** Public HTML for captive portal. */
  async renderSuspendedPage(tenantSlug: string): Promise<string> {
    if (isReservedTenantSlug(tenantSlug)) {
      throw new NotFoundException('Empresa no encontrada');
    }
    const tenant = await this.tenants.findOne({ where: { slug: tenantSlug } });
    if (!tenant || tenant.status !== 'active') {
      throw new NotFoundException('Empresa no encontrada');
    }
    if (!tenant.suspensionPortalEnabled) {
      throw new NotFoundException('Portal de suspensión no activo');
    }
    if (tenant.suspensionPortalMode === 'external') {
      throw new NotFoundException(
        'Este tenant usa un portal externo; no hay página interna',
      );
    }
    return this.buildPortalHtml(tenant);
  }

  listTemplates() {
    return {
      templates: SUSPENSION_PORTAL_TEMPLATES,
      defaultId: DEFAULT_SUSPENSION_PORTAL_TEMPLATE,
    };
  }

  /** Preview for settings UI (uses company branding). */
  async previewTemplate(user: AuthUser, templateId?: string): Promise<string> {
    const tenant = await this.requireTenant(user);
    return this.buildPortalHtml(tenant, templateId);
  }

  private buildPortalHtml(
    tenant: Tenant,
    templateIdOverride?: string,
  ): string {
    const brand = this.escapeHtml(tenant.name || 'ISP');
    const phone = this.escapeHtml(tenant.phone || '');
    const email = this.escapeHtml(tenant.email || '');
    const logoSrc =
      tenant.suspensionPortalLogoUrl?.trim() || tenant.logoUrl?.trim() || '';
    const logoHtml = logoSrc
      ? `<img src="${this.escapeAttr(logoSrc)}" alt="${brand}" />`
      : '';
    const contactHtml =
      phone || email
        ? `<p class="contact">Contacto: ${[phone, email].filter(Boolean).join(' · ')}</p>`
        : '';
    const vars: SuspensionPortalTemplateVars = {
      brand,
      logoHtml,
      phone,
      email,
      contactHtml,
      message:
        'Tu servicio de internet está temporalmente suspendido. Regulariza tu pago para restablecer la conexión.',
    };
    const templateId = resolveSuspensionPortalTemplateId(
      templateIdOverride ?? tenant.suspensionPortalTemplateId,
    );
    return renderSuspensionPortalTemplate(templateId, vars);
  }

  async configureMikrotik(
    user: AuthUser,
    routerIds: string[],
  ): Promise<{
    portalUrl: string;
    allowDomains: string[];
    results: ConfigureRouterResult[];
  }> {
    const schema = this.requireSchema(user);
    const tenant = await this.requireTenant(user);
    if (!tenant.suspensionPortalEnabled) {
      throw new BadRequestException(
        'Activa «Portal de suspensión» antes de configurar MikroTik',
      );
    }
    const uniqueIds = [...new Set(routerIds.map((id) => id.trim()).filter(Boolean))];
    if (uniqueIds.length === 0) {
      throw new BadRequestException('Selecciona al menos un MikroTik');
    }
    const portal = await this.resolvePortalTarget(tenant);
    const all = await this.listMikrotikRouters(schema);
    if (all.length === 0) {
      throw new BadRequestException(
        'No hay routers MikroTik activos con credenciales de gestión',
      );
    }
    const byId = new Map(all.map((r) => [r.id, r]));
    const missing = uniqueIds.filter((id) => !byId.has(id));
    if (missing.length > 0) {
      throw new BadRequestException(
        'Uno o más routers no existen, no están activos o carecen de credenciales de gestión',
      );
    }
    const routers = uniqueIds.map((id) => byId.get(id)!);
    const results: ConfigureRouterResult[] = [];
    const loopbackPortal =
      portal.ip === '127.0.0.1' ||
      portal.host === 'localhost' ||
      portal.host === '127.0.0.1';
    for (const router of routers) {
      try {
        const status = await this.ensureBaseRules(this.conn(router), portal);
        const base =
          status === 'ok'
            ? 'Reglas correctas — sin cambios'
            : status === 'fixed'
              ? 'Reglas corregidas (parámetros u orden)'
              : 'Reglas creadas/completadas (bloqueo excepto portal + pagos)';
        results.push({
          routerId: router.id,
          routerName: router.name,
          ok: true,
          message: loopbackPortal
            ? `${base}. Aviso: el portal apunta a ${portal.ip} — define PUBLIC_API_URL con una IP/host alcanzable desde el MikroTik`
            : base,
        });
      } catch (err) {
        results.push({
          routerId: router.id,
          routerName: router.name,
          ok: false,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
    tenant.suspensionPortalRouterIds = uniqueIds;
    tenant.suspensionPortalAppliedUrl = normalizePortalUrl(portal.url);
    await this.tenants.save(tenant);
    return {
      portalUrl: portal.url,
      allowDomains: [...SUSPENSION_PAYMENT_ALLOW_DOMAINS],
      results,
    };
  }

  async addSuspendedIp(
    user: AuthUser,
    service: ClientService,
    wanIp: string,
    routerIdHint?: string | null,
  ) {
    const schema = this.requireSchema(user);
    const tenant = await this.requireTenant(user);
    const routers = await this.routersForAction(
      schema,
      routerIdHint,
      tenant.suspensionPortalRouterIds,
    );
    if (routers.length === 0) {
      throw new BadRequestException(
        'No hay routers MikroTik para aplicar la suspensión. Ejecuta Configurar MikroTik en Empresa.',
      );
    }
    const comment = svcComment(service.id);
    const errors: string[] = [];
    let ok = 0;
    for (const router of routers) {
      try {
        const conn = this.conn(router);
        await this.assertBaseRulesExist(conn);
        await this.ensureAddressListEntry(conn, wanIp, comment);
        ok += 1;
      } catch (err) {
        errors.push(
          `${router.name}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    if (ok === 0) {
      throw new BadRequestException(
        errors.join(' · ') ||
          'No se pudo agregar la IP a la address-list. Ejecuta Configurar MikroTik.',
      );
    }
    if (errors.length) {
      this.logger.warn(
        `Suspensión parcial svc=${service.id}: ${errors.join(' · ')}`,
      );
    }
  }

  async removeSuspendedIp(
    user: AuthUser,
    service: ClientService,
    wanIp: string | null,
    routerIdHint?: string | null,
  ) {
    const schema = this.requireSchema(user);
    const tenant = await this.requireTenant(user);
    const routers = await this.routersForAction(
      schema,
      routerIdHint,
      tenant.suspensionPortalRouterIds,
    );
    const comment = svcComment(service.id);
    for (const router of routers) {
      try {
        await this.removeAddressListEntry(this.conn(router), comment, wanIp);
      } catch (err) {
        this.logger.warn(
          `No se quitó IP en ${router.name}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
  }

  private requireSchema(user: AuthUser): string {
    if (!user.schemaName) {
      throw new BadRequestException('Tenant schema required');
    }
    return user.schemaName;
  }

  private async requireTenant(user: AuthUser): Promise<Tenant> {
    if (!user.tenantId) throw new NotFoundException('Sin empresa asociada');
    const tenant = await this.tenants.findOne({ where: { id: user.tenantId } });
    if (!tenant) throw new NotFoundException('Empresa no encontrada');
    return tenant;
  }

  private conn(device: NetworkDevice): MikroTikConn {
    if (
      device.subtype !== 'mikrotik' ||
      !device.mgmtHost ||
      !device.mgmtUsername ||
      !device.mgmtPassword
    ) {
      throw new BadRequestException(
        `Router ${device.name} no es MikroTik conectado`,
      );
    }
    const protocol = device.mgmtProtocol ?? 'api_ssl';
    // El portal usa API binaria (no REST). rest_https → intentar api_ssl en 8729.
    const useApiPlain = protocol === 'api_plain';
    const useTls = !useApiPlain;
    const port =
      device.mgmtPort ??
      (useApiPlain ? 8728 : 8729);
    if (protocol === 'rest_https' && device.mgmtPort === 443) {
      // Puerto REST no sirve para API binaria
      throw new BadRequestException(
        `${device.name}: el portal de suspensión requiere API MikroTik (api_ssl :8729 o api_plain :8728), no REST :443`,
      );
    }
    return {
      host: device.mgmtHost,
      port,
      username: device.mgmtUsername,
      password: device.mgmtPassword,
      useTls,
    };
  }

  private async listMikrotikRouters(schema: string): Promise<NetworkDevice[]> {
    const repo =
      await this.tenantConnections.getNetworkDeviceRepository(schema);
    const devices = await repo.find({
      where: { type: 'router', isActive: true },
    });
    return devices.filter(
      (d) =>
        d.subtype === 'mikrotik' &&
        !!d.mgmtHost &&
        !!d.mgmtUsername &&
        !!d.mgmtPassword,
    );
  }

  private async routersForAction(
    schema: string,
    routerIdHint?: string | null,
    savedRouterIds?: string[] | null,
  ): Promise<NetworkDevice[]> {
    const all = await this.listMikrotikRouters(schema);
    if (routerIdHint) {
      const preferred = all.find((r) => r.id === routerIdHint);
      if (preferred) return [preferred];
    }
    const saved = Array.isArray(savedRouterIds)
      ? savedRouterIds.filter(Boolean)
      : [];
    if (saved.length > 0) {
      const want = new Set(saved);
      const filtered = all.filter((r) => want.has(r.id));
      if (filtered.length > 0) return filtered;
    }
    return all;
  }

  private async resolvePortalTarget(tenant: Tenant): Promise<PortalTarget> {
    let url: string;
    if (
      tenant.suspensionPortalMode === 'external' &&
      tenant.suspensionPortalExternalUrl?.trim()
    ) {
      try {
        url = parsePortalUrl(tenant.suspensionPortalExternalUrl).url;
      } catch (err) {
        throw new BadRequestException(
          err instanceof Error ? err.message : 'URL de portal externo inválida',
        );
      }
    } else if (tenant.suspensionPortalMode === 'external') {
      throw new BadRequestException(
        'Configura la URL del portal externo en Ajustes → Portal de suspensión',
      );
    } else {
      const webBase = await this.publicUrls.resolvePublicWebUrl();
      url = internalSuspensionPortalUrl(webBase, tenant.slug);
    }

    let parsed: ReturnType<typeof parsePortalUrl>;
    try {
      parsed = parsePortalUrl(url);
    } catch (err) {
      throw new BadRequestException(
        err instanceof Error
          ? err.message
          : 'PUBLIC_API_URL inválida para el portal de suspensión',
      );
    }

    let ip = parsed.host;
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(parsed.host)) {
      try {
        const resolved = await lookup(parsed.host);
        ip = resolved.address;
      } catch {
        throw new BadRequestException(
          `No se pudo resolver la IP del portal (${parsed.host}). Usa una URL con host alcanzable desde los routers.`,
        );
      }
    }
    return {
      url: parsed.url,
      host: parsed.host,
      ip,
      port: parsed.port,
    };
  }

  /**
   * Verifica reglas isp-control-*: si faltan las crea; si existen pero
   * están mal (params u orden accept→drop) las corrige; si están bien no toca.
   * Una sola sesión API por fase (lectura / escritura) para evitar errores TLS.
   */
  private async ensureBaseRules(
    conn: MikroTikConn,
    portal: { ip: string; port: number },
  ): Promise<'ok' | 'fixed' | 'created'> {
    const read = await this.runMany(conn, [
      ['/ip/firewall/nat/print'],
      ['/ip/firewall/filter/print'],
      [
        '/ip/firewall/address-list/print',
        `?list=${SUSPENDED_ALLOW_LIST}`,
      ],
    ]);
    const natRows = read[0]?.rows ?? [];
    const filterRows = read[1]?.rows ?? [];
    const allowRows = read[2]?.rows ?? [];

    const mutations: string[][] = [];
    let created = 0;
    let fixed = 0;

    const expectedNat: Record<string, string> = {
      chain: 'dstnat',
      'src-address-list': SUSPENDED_LIST,
      protocol: 'tcp',
      'dst-port': '80',
      action: 'dst-nat',
      'to-addresses': portal.ip,
      'to-ports': String(portal.port),
    };
    const nat = this.findByComment(natRows, COMMENT_NAT);
    if (!nat?.['.id']) {
      mutations.push([
        '/ip/firewall/nat/add',
        '=chain=dstnat',
        `=src-address-list=${SUSPENDED_LIST}`,
        '=protocol=tcp',
        '=dst-port=80',
        '=action=dst-nat',
        `=to-addresses=${portal.ip}`,
        `=to-ports=${portal.port}`,
        `=comment=${COMMENT_NAT}`,
      ]);
      created += 1;
    } else {
      const bad = this.mismatchedFields(nat, expectedNat);
      if (bad.length > 0 || this.isDisabled(nat)) {
        mutations.push([
          '/ip/firewall/nat/set',
          `=.id=${nat['.id']}`,
          ...bad.map((k) => `=${k}=${expectedNat[k]}`),
          ...(this.isDisabled(nat) ? ['=disabled=no'] : []),
        ]);
        fixed += 1;
      }
    }

    // Dominios de pago faltantes
    const allowComments = new Set(
      allowRows.map((r) => r.comment || '').filter(Boolean),
    );
    for (const domain of SUSPENSION_PAYMENT_ALLOW_DOMAINS) {
      const comment = allowDomainComment(domain);
      if (allowComments.has(comment)) continue;
      mutations.push([
        '/ip/firewall/address-list/add',
        `=list=${SUSPENDED_ALLOW_LIST}`,
        `=address=${domain}`,
        `=comment=${comment}`,
      ]);
      created += 1;
    }

    type FilterSpec = {
      comment: string;
      expected: Record<string, string>;
      addWords: string[];
    };
    const filterSpecs: FilterSpec[] = [
      {
        comment: COMMENT_DNS_UDP,
        expected: {
          chain: 'forward',
          'src-address-list': SUSPENDED_LIST,
          protocol: 'udp',
          'dst-port': '53',
          action: 'accept',
        },
        addWords: [
          '=chain=forward',
          `=src-address-list=${SUSPENDED_LIST}`,
          '=protocol=udp',
          '=dst-port=53',
          '=action=accept',
          `=comment=${COMMENT_DNS_UDP}`,
        ],
      },
      {
        comment: COMMENT_DNS_TCP,
        expected: {
          chain: 'forward',
          'src-address-list': SUSPENDED_LIST,
          protocol: 'tcp',
          'dst-port': '53',
          action: 'accept',
        },
        addWords: [
          '=chain=forward',
          `=src-address-list=${SUSPENDED_LIST}`,
          '=protocol=tcp',
          '=dst-port=53',
          '=action=accept',
          `=comment=${COMMENT_DNS_TCP}`,
        ],
      },
      {
        comment: COMMENT_PORTAL,
        expected: {
          chain: 'forward',
          'src-address-list': SUSPENDED_LIST,
          'dst-address': portal.ip,
          action: 'accept',
        },
        addWords: [
          '=chain=forward',
          `=src-address-list=${SUSPENDED_LIST}`,
          `=dst-address=${portal.ip}`,
          '=action=accept',
          `=comment=${COMMENT_PORTAL}`,
        ],
      },
      {
        comment: COMMENT_PAYMENTS,
        expected: {
          chain: 'forward',
          'src-address-list': SUSPENDED_LIST,
          'dst-address-list': SUSPENDED_ALLOW_LIST,
          action: 'accept',
        },
        addWords: [
          '=chain=forward',
          `=src-address-list=${SUSPENDED_LIST}`,
          `=dst-address-list=${SUSPENDED_ALLOW_LIST}`,
          '=action=accept',
          `=comment=${COMMENT_PAYMENTS}`,
        ],
      },
    ];

    const expectedDrop: Record<string, string> = {
      chain: 'forward',
      'src-address-list': SUSPENDED_LIST,
      action: 'drop',
    };
    const drop = this.findByComment(filterRows, COMMENT_DROP);
    const dropId = drop?.['.id'] ?? null;

    // Accepts primero (place-before si el drop ya existe); drop nuevo al final.
    for (const spec of filterSpecs) {
      const row = this.findByComment(filterRows, spec.comment);
      if (!row?.['.id']) {
        const add = ['/ip/firewall/filter/add', ...spec.addWords];
        if (dropId) add.push(`=place-before=${dropId}`);
        mutations.push(add);
        created += 1;
        continue;
      }
      const bad = this.mismatchedFields(row, spec.expected);
      if (bad.length > 0 || this.isDisabled(row)) {
        mutations.push([
          '/ip/firewall/filter/set',
          `=.id=${row['.id']}`,
          ...bad.map((k) => `=${k}=${spec.expected[k]}`),
          ...(this.isDisabled(row) ? ['=disabled=no'] : []),
        ]);
        fixed += 1;
      }
      if (dropId) {
        const acceptIdx = filterRows.findIndex(
          (r) => (r.comment || '') === spec.comment,
        );
        const dropIdx = filterRows.findIndex(
          (r) => (r.comment || '') === COMMENT_DROP,
        );
        if (acceptIdx >= 0 && dropIdx >= 0 && acceptIdx > dropIdx) {
          mutations.push([
            '/ip/firewall/filter/move',
            `=.id=${row['.id']}`,
            `=destination=${dropId}`,
          ]);
          fixed += 1;
        }
      }
    }

    if (!dropId) {
      mutations.push([
        '/ip/firewall/filter/add',
        '=chain=forward',
        `=src-address-list=${SUSPENDED_LIST}`,
        '=action=drop',
        `=comment=${COMMENT_DROP}`,
      ]);
      created += 1;
    } else {
      const bad = this.mismatchedFields(drop!, expectedDrop);
      if (bad.length > 0 || this.isDisabled(drop!)) {
        mutations.push([
          '/ip/firewall/filter/set',
          `=.id=${dropId}`,
          ...bad.map((k) => `=${k}=${expectedDrop[k]}`),
          ...(this.isDisabled(drop!) ? ['=disabled=no'] : []),
        ]);
        fixed += 1;
      }
    }

    if (mutations.length === 0) return 'ok';

    const write = await this.runMany(conn, mutations);
    const fail = write.find((r) => !r.ok);
    if (fail) {
      throw new BadRequestException(
        fail.error || 'Error aplicando reglas en MikroTik',
      );
    }

    if (created > 0 && fixed === 0) return 'created';
    if (fixed > 0) return 'fixed';
    return 'created';
  }

  private findByComment(
    rows: Record<string, string>[],
    comment: string,
  ): Record<string, string> | null {
    return rows.find((r) => (r.comment || '') === comment) ?? null;
  }

  private isDisabled(row: Record<string, string>) {
    const d = (row.disabled || '').toLowerCase();
    return d === 'true' || d === 'yes';
  }

  private mismatchedFields(
    row: Record<string, string>,
    expected: Record<string, string>,
  ): string[] {
    const bad: string[] = [];
    for (const [key, want] of Object.entries(expected)) {
      const got = (row[key] ?? '').trim();
      if (got.toLowerCase() !== want.trim().toLowerCase()) {
        bad.push(key);
      }
    }
    return bad;
  }

  private async runMany(conn: MikroTikConn, commands: string[][]) {
    if (commands.length === 0) return [];
    const results = await this.mikrotik.runWordsMany({
      host: conn.host,
      port: conn.port,
      username: conn.username,
      password: conn.password,
      useTls: conn.useTls,
      commands,
    });
    for (let i = 0; i < results.length; i++) {
      if (!results[i].ok) {
        throw new BadRequestException(
          results[i].error || `MikroTik falló: ${commands[i]?.[0] ?? '?'}`,
        );
      }
    }
    return results;
  }

  private async findRuleId(
    conn: MikroTikConn,
    path: '/ip/firewall/nat' | '/ip/firewall/filter',
    comment: string,
  ): Promise<string | null> {
    const res = await this.run(conn, [`${path}/print`, `?comment=${comment}`]);
    return res.rows[0]?.['.id'] ?? null;
  }

  private async assertBaseRulesExist(conn: MikroTikConn) {
    const nat = await this.hasRule(conn, '/ip/firewall/nat', COMMENT_NAT);
    const drop = await this.hasRule(conn, '/ip/firewall/filter', COMMENT_DROP);
    if (!nat || !drop) {
      throw new BadRequestException(
        'Ejecuta Configurar MikroTik en Empresa (faltan reglas base)',
      );
    }
  }

  private async ensureAddressListEntry(
    conn: MikroTikConn,
    address: string,
    comment: string,
  ) {
    const existing = await this.findAddressList(conn, comment);
    if (existing.length > 0) {
      for (const row of existing) {
        if (row.address !== address && row['.id']) {
          await this.run(conn, [
            '/ip/firewall/address-list/set',
            `=.id=${row['.id']}`,
            `=address=${address}`,
          ]);
        }
      }
      return;
    }
    await this.run(conn, [
      '/ip/firewall/address-list/add',
      `=list=${SUSPENDED_LIST}`,
      `=address=${address}`,
      `=comment=${comment}`,
    ]);
  }

  private async removeAddressListEntry(
    conn: MikroTikConn,
    comment: string,
    wanIp: string | null,
  ) {
    let rows = await this.findAddressList(conn, comment);
    if (rows.length === 0 && wanIp) {
      const byIp = await this.run(conn, [
        '/ip/firewall/address-list/print',
        `?list=${SUSPENDED_LIST}`,
        `?address=${wanIp}`,
      ]);
      rows = byIp.rows;
    }
    for (const row of rows) {
      if (!row['.id']) continue;
      await this.run(conn, [
        '/ip/firewall/address-list/remove',
        `=.id=${row['.id']}`,
      ]);
    }
  }

  private async findAddressList(conn: MikroTikConn, comment: string) {
    const res = await this.run(conn, [
      '/ip/firewall/address-list/print',
      `?list=${SUSPENDED_LIST}`,
      `?comment=${comment}`,
    ]);
    return res.rows;
  }

  private async hasRule(
    conn: MikroTikConn,
    path: '/ip/firewall/nat' | '/ip/firewall/filter',
    comment: string,
  ): Promise<boolean> {
    const res = await this.run(conn, [`${path}/print`, `?comment=${comment}`]);
    return res.rows.length > 0;
  }

  private async run(conn: MikroTikConn, words: string[]) {
    const result = await this.mikrotik.runWords({
      host: conn.host,
      port: conn.port,
      username: conn.username,
      password: conn.password,
      useTls: conn.useTls,
      words,
    });
    if (!result.ok) {
      throw new BadRequestException(
        result.error || `MikroTik falló: ${words[0]}`,
      );
    }
    return result;
  }

  private escapeHtml(s: string) {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  private escapeAttr(s: string) {
    return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  }
}
