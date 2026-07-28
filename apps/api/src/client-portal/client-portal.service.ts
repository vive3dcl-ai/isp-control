import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'crypto';
import { In, Repository } from 'typeorm';
import type { AuthUser, JwtPayload, LoginResponse } from '../auth/auth.types';
import { Tenant } from '../tenants/entities/tenant.entity';
import { TenantConnectionService } from '../database/tenant-connection.service';
import { TenantMailerService } from '../modules/tenant-mailer.service';
import {
  EMPTY_MERCADOPAGO_CONFIG,
  isMercadoPagoConfigured,
  normalizeEnabledModules,
  type MercadoPagoModuleConfig,
  type ModuleId,
} from '../modules/module-catalog';
import { PlatformPublicUrlsService } from '../platform/platform-public-urls.service';
import {
  emailCtaButton,
  escapeHtml,
} from '../platform/platform-email-layout';
import { InvoicePdfService } from '../billing/invoice-pdf.service';
import { Invoice } from '../billing/entities/invoice.entity';
import {
  ClientPortalUser,
  type ClientPortalUserStatus,
} from './entities/client-portal-user.entity';
import { ClientPortalInvite } from './entities/client-portal-invite.entity';

const INVITE_TTL_MS = 7 * 24 * 3600_000;
const PORTAL_INVOICE_STATUSES = ['issued', 'sent', 'paid', 'overdue'] as const;
const PAYABLE_STATUSES = new Set(['issued', 'sent', 'overdue']);

@Injectable()
export class ClientPortalService {
  private readonly logger = new Logger(ClientPortalService.name);

  constructor(
    @InjectRepository(ClientPortalUser)
    private readonly users: Repository<ClientPortalUser>,
    @InjectRepository(ClientPortalInvite)
    private readonly invites: Repository<ClientPortalInvite>,
    @InjectRepository(Tenant)
    private readonly tenants: Repository<Tenant>,
    private readonly tenantConnections: TenantConnectionService,
    private readonly mailer: TenantMailerService,
    private readonly publicUrls: PlatformPublicUrlsService,
    private readonly invoicePdf: InvoicePdfService,
    private readonly jwt: JwtService,
  ) {}

  private assertModule(tenant: Tenant, id: ModuleId = 'client_portal') {
    if (!normalizeEnabledModules(tenant.enabledModules).includes(id)) {
      throw new ForbiddenException(
        'El portal de clientes no está contratado para esta empresa',
      );
    }
  }

  private async requireTenantBySlug(slug: string): Promise<Tenant> {
    const tenant = await this.tenants.findOne({
      where: { slug: slug.trim().toLowerCase() },
    });
    if (!tenant || tenant.status === 'inactive') {
      throw new NotFoundException('Empresa no encontrada');
    }
    this.assertModule(tenant);
    return tenant;
  }

  private requirePortalUser(user: AuthUser) {
    if (
      user.role !== 'client_portal' ||
      !user.tenantId ||
      !user.schemaName ||
      !user.clientId
    ) {
      throw new ForbiddenException('Sesión de portal requerida');
    }
    return {
      portalUserId: user.sub,
      tenantId: user.tenantId,
      schemaName: user.schemaName,
      clientId: user.clientId,
      slug: user.tenantSlug ?? '',
    };
  }

  private hashToken(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }

  private clientDisplayName(c: {
    firstName?: string;
    lastName?: string;
    companyName?: string;
    isCompany?: boolean;
  }) {
    if (c.isCompany && c.companyName?.trim()) return c.companyName.trim();
    return [c.firstName, c.lastName].filter(Boolean).join(' ').trim() || 'Cliente';
  }

  private serializeUser(u: ClientPortalUser, tenant?: Tenant) {
    return {
      id: u.id,
      tenantId: u.tenantId,
      tenantName: tenant?.name ?? null,
      tenantSlug: tenant?.slug ?? null,
      clientId: u.clientId,
      email: u.email.startsWith('__client__') ? '' : u.email,
      name: u.name,
      firstName: u.firstName,
      lastName: u.lastName,
      companyName: u.companyName,
      documentType: u.documentType,
      documentNumber: u.documentNumber,
      isCompany: u.isCompany,
      companyTaxId: u.companyTaxId,
      isLead: u.isLead,
      phone: u.phone,
      street: u.street,
      city: u.city,
      zipCode: u.zipCode,
      latitude: u.latitude,
      longitude: u.longitude,
      note: u.note,
      isActive: u.isActive,
      zoneId: u.zoneId,
      status: u.status,
      archivedAt: u.archivedAt,
      createdAt: u.createdAt,
      updatedAt: u.updatedAt,
    };
  }

  private portalEmailFor(clientId: string, email: string) {
    const e = email.toLowerCase().trim();
    if (e && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return e;
    return `__client__${clientId}@local`;
  }

  private applyClientSnapshot(
    user: ClientPortalUser,
    client: {
      id: string;
      firstName: string;
      lastName: string;
      companyName: string;
      documentType: string;
      documentNumber: string;
      isCompany: boolean;
      companyTaxId: string;
      isLead: boolean;
      email: string;
      phone: string;
      street: string;
      city: string;
      zipCode: string;
      latitude: number | null;
      longitude: number | null;
      note: string;
      isActive: boolean;
      zoneId: string | null;
    },
  ) {
    user.clientId = client.id;
    user.email = this.portalEmailFor(client.id, client.email);
    user.name = this.clientDisplayName(client);
    user.firstName = client.firstName ?? '';
    user.lastName = client.lastName ?? '';
    user.companyName = client.companyName ?? '';
    user.documentType = client.documentType ?? '';
    user.documentNumber = client.documentNumber ?? '';
    user.isCompany = !!client.isCompany;
    user.companyTaxId = client.companyTaxId ?? '';
    user.isLead = !!client.isLead;
    user.phone = client.phone ?? '';
    user.street = client.street ?? '';
    user.city = client.city ?? '';
    user.zipCode = client.zipCode ?? '';
    user.latitude = client.latitude ?? null;
    user.longitude = client.longitude ?? null;
    user.note = client.note ?? '';
    user.isActive = client.isActive !== false;
    user.zoneId = client.zoneId ?? null;
  }

  /**
   * Persiste snapshot del cliente CRM en public (sin servicios).
   * Visible en Admin → Clientes aunque el tenant borre el CRM.
   */
  async syncClientSnapshot(opts: {
    tenantId: string;
    client: {
      id: string;
      firstName: string;
      lastName: string;
      companyName: string;
      documentType: string;
      documentNumber: string;
      isCompany: boolean;
      companyTaxId: string;
      isLead: boolean;
      email: string;
      phone: string;
      street: string;
      city: string;
      zipCode: string;
      latitude: number | null;
      longitude: number | null;
      note: string;
      isActive: boolean;
      zoneId: string | null;
    };
  }) {
    let user = await this.users.findOne({
      where: { tenantId: opts.tenantId, clientId: opts.client.id },
    });
    const email = this.portalEmailFor(opts.client.id, opts.client.email);
    if (!user) {
      const byEmail = await this.users.findOne({
        where: { tenantId: opts.tenantId, email },
      });
      if (byEmail && byEmail.clientId !== opts.client.id) {
        // Email ya ligado a otro cliente: snapshot con placeholder único.
        user = this.users.create({
          tenantId: opts.tenantId,
          clientId: opts.client.id,
          status: 'stored',
          passwordHash: null,
          archivedAt: null,
        });
        this.applyClientSnapshot(user, {
          ...opts.client,
          email: '',
        });
      } else if (byEmail) {
        user = byEmail;
        this.applyClientSnapshot(user, opts.client);
      } else {
        user = this.users.create({
          tenantId: opts.tenantId,
          clientId: opts.client.id,
          status: 'stored',
          passwordHash: null,
          archivedAt: null,
        });
        this.applyClientSnapshot(user, opts.client);
      }
    } else {
      this.applyClientSnapshot(user, opts.client);
    }
    if (!opts.client.isActive || opts.client.isLead) {
      if (user.status === 'active' || user.status === 'invited') {
        // keep portal status; only mark archived when inactive
      }
      if (!opts.client.isActive) {
        user.archivedAt = user.archivedAt ?? new Date();
      }
    } else {
      user.archivedAt = null;
    }
    if (user.status !== 'active' && user.status !== 'invited' && user.status !== 'disabled') {
      user.status = 'stored';
    }
    await this.users.save(user);
    return user;
  }

  private async signPortalSession(
    u: ClientPortalUser,
    tenant: Tenant,
  ): Promise<LoginResponse> {
    const payload: JwtPayload = {
      sub: u.id,
      email: u.email,
      name: u.name || u.email,
      role: 'client_portal',
      tenantId: tenant.id,
      tenantSlug: tenant.slug,
      schemaName: tenant.schemaName,
      clientId: u.clientId,
    };
    return {
      accessToken: await this.jwt.signAsync(payload),
      redirectTo: `/${tenant.slug}/portal`,
      user: {
        id: u.id,
        email: u.email,
        name: u.name || u.email,
        role: 'client_portal',
        tenantId: tenant.id,
        tenantSlug: tenant.slug,
        clientId: u.clientId,
      },
    };
  }

  async getBranding(slug: string) {
    const tenant = await this.requireTenantBySlug(slug);
    return {
      slug: tenant.slug,
      name: tenant.name,
      logoUrl: tenant.logoUrl || null,
      currency: tenant.currency,
    };
  }

  async login(slug: string, email: string, password: string) {
    const tenant = await this.requireTenantBySlug(slug);
    const row = await this.users.findOne({
      where: {
        tenantId: tenant.id,
        email: email.toLowerCase().trim(),
      },
    });
    if (!row || row.status === 'disabled' || row.archivedAt) {
      throw new UnauthorizedException('Credenciales inválidas');
    }
    if (row.status === 'stored' || row.email.startsWith('__client__')) {
      throw new UnauthorizedException('Credenciales inválidas');
    }
    if (!row.passwordHash || row.status !== 'active') {
      throw new UnauthorizedException(
        'Cuenta pendiente de activación. Revisa tu correo de bienvenida.',
      );
    }
    const ok = await bcrypt.compare(password, row.passwordHash);
    if (!ok) throw new UnauthorizedException('Credenciales inválidas');
    return this.signPortalSession(row, tenant);
  }

  async getInvite(token: string) {
    const invite = await this.invites.findOne({
      where: { tokenHash: this.hashToken(token) },
      relations: { portalUser: true },
    });
    if (!invite || invite.usedAt || invite.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException('Invitación inválida o expirada');
    }
    const tenant = await this.tenants.findOne({
      where: { id: invite.portalUser.tenantId },
    });
    if (!tenant) throw new NotFoundException('Empresa no encontrada');
    this.assertModule(tenant);
    return {
      email: invite.portalUser.email,
      name: invite.portalUser.name,
      companyName: tenant.name,
      slug: tenant.slug,
      expiresAt: invite.expiresAt,
    };
  }

  async activateInvite(token: string, password: string) {
    const invite = await this.invites.findOne({
      where: { tokenHash: this.hashToken(token) },
      relations: { portalUser: true },
    });
    if (!invite || invite.usedAt || invite.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException('Invitación inválida o expirada');
    }
    const user = invite.portalUser;
    if (user.status === 'disabled' || user.archivedAt) {
      throw new ForbiddenException('Cuenta deshabilitada');
    }
    const tenant = await this.tenants.findOne({ where: { id: user.tenantId } });
    if (!tenant) throw new NotFoundException('Empresa no encontrada');
    this.assertModule(tenant);

    user.passwordHash = await bcrypt.hash(password, 10);
    user.status = 'active';
    await this.users.save(user);
    invite.usedAt = new Date();
    await this.invites.save(invite);
    return this.signPortalSession(user, tenant);
  }

  async me(auth: AuthUser) {
    const ctx = this.requirePortalUser(auth);
    const user = await this.users.findOne({ where: { id: ctx.portalUserId } });
    if (!user || user.status === 'disabled') {
      throw new UnauthorizedException('Sesión inválida');
    }
    const tenant = await this.tenants.findOne({ where: { id: ctx.tenantId } });
    const paymentMethods = await this.listPaymentMethods(tenant!);
    return {
      ...this.serializeUser(user, tenant ?? undefined),
      paymentMethods,
    };
  }

  async updateProfile(auth: AuthUser, dto: { name?: string; email?: string }) {
    const ctx = this.requirePortalUser(auth);
    const user = await this.users.findOne({ where: { id: ctx.portalUserId } });
    if (!user) throw new NotFoundException('Usuario no encontrado');
    if (dto.name !== undefined) user.name = dto.name.trim().slice(0, 180);
    if (dto.email !== undefined) {
      const email = dto.email.toLowerCase().trim();
      const clash = await this.users.findOne({
        where: { tenantId: ctx.tenantId, email },
      });
      if (clash && clash.id !== user.id) {
        throw new BadRequestException('Ese correo ya está en uso');
      }
      user.email = email;
    }
    await this.users.save(user);
    const tenant = await this.tenants.findOne({ where: { id: ctx.tenantId } });
    return this.serializeUser(user, tenant ?? undefined);
  }

  async changePassword(
    auth: AuthUser,
    currentPassword: string,
    newPassword: string,
  ) {
    const ctx = this.requirePortalUser(auth);
    const user = await this.users.findOne({ where: { id: ctx.portalUserId } });
    if (!user?.passwordHash) {
      throw new BadRequestException('Cuenta sin contraseña');
    }
    const ok = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!ok) throw new BadRequestException('Contraseña actual incorrecta');
    user.passwordHash = await bcrypt.hash(newPassword, 10);
    await this.users.save(user);
    return { ok: true };
  }

  async listServices(auth: AuthUser) {
    const ctx = this.requirePortalUser(auth);
    const repo = await this.tenantConnections.getClientServiceRepository(
      ctx.schemaName,
    );
    const onuRepo = await this.tenantConnections.getOnuRepository(
      ctx.schemaName,
    );
    const rows = await repo.find({
      where: { clientId: ctx.clientId },
      relations: { servicePlan: true },
      order: { createdAt: 'DESC' },
    });
    const onuIds = rows.map((r) => r.onuId).filter(Boolean) as string[];
    const onus = onuIds.length
      ? await onuRepo.find({ where: { id: In(onuIds) } })
      : [];
    const onuById = new Map(onus.map((o) => [o.id, o]));
    return rows.map((s) => {
      const onu = s.onuId ? onuById.get(s.onuId) : null;
      return {
        id: s.id,
        name: s.name,
        status: s.status,
        price: s.price,
        planName: s.servicePlan?.name ?? null,
        street: s.street,
        city: s.city,
        onuId: s.onuId,
        onuName: onu?.name ?? null,
        onuSn: onu?.sn ?? null,
        signalDbm: onu?.signalDbm ?? null,
      };
    });
  }

  async serviceMetrics(auth: AuthUser, serviceId: string, hours = 24) {
    const ctx = this.requirePortalUser(auth);
    const svcRepo = await this.tenantConnections.getClientServiceRepository(
      ctx.schemaName,
    );
    const svc = await svcRepo.findOne({
      where: { id: serviceId, clientId: ctx.clientId },
    });
    if (!svc) throw new NotFoundException('Servicio no encontrado');
    if (!svc.onuId) {
      return { serviceId, onuId: null, hours, samples: [] };
    }
    const since = new Date(Date.now() - Math.max(1, hours) * 3600_000);
    const samples =
      await this.tenantConnections.getOnuMetricSampleRepository(ctx.schemaName);
    const rows = await samples
      .createQueryBuilder('s')
      .where('s.onu_id = :id', { id: svc.onuId })
      .andWhere('s.sampled_at >= :since', { since })
      .orderBy('s.sampled_at', 'ASC')
      .getMany();
    return {
      serviceId,
      onuId: svc.onuId,
      hours,
      samples: rows.map((s) => ({
        kind: s.kind,
        value: s.value,
        sampledAt: s.sampledAt.toISOString(),
      })),
    };
  }

  private serializeInvoice(inv: Invoice) {
    return {
      id: inv.id,
      number: inv.number,
      status: inv.status,
      type: inv.type,
      currency: inv.currency,
      subtotal: inv.subtotal,
      tax: inv.tax,
      total: inv.total,
      issueDate: inv.issueDate,
      dueDate: inv.dueDate,
      periodStart: inv.periodStart,
      periodEnd: inv.periodEnd,
      notes: inv.notes,
      payable: PAYABLE_STATUSES.has(inv.status),
      items: (inv.items ?? [])
        .slice()
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((it) => ({
          id: it.id,
          description: it.description,
          quantity: it.quantity,
          unitPrice: it.unitPrice,
          amount: it.amount,
        })),
      createdAt: inv.createdAt,
    };
  }

  async listInvoices(auth: AuthUser) {
    const ctx = this.requirePortalUser(auth);
    const repo = await this.tenantConnections.getInvoiceRepository(
      ctx.schemaName,
    );
    const rows = await repo.find({
      where: {
        clientId: ctx.clientId,
        status: In([...PORTAL_INVOICE_STATUSES]),
      },
      relations: { items: true },
      order: { createdAt: 'DESC' },
      take: 200,
    });
    // Mark overdue if past due and still unpaid
    const today = new Date().toISOString().slice(0, 10);
    const toSave: Invoice[] = [];
    for (const inv of rows) {
      if (
        PAYABLE_STATUSES.has(inv.status) &&
        inv.dueDate &&
        inv.dueDate < today &&
        inv.status !== 'overdue'
      ) {
        inv.status = 'overdue';
        toSave.push(inv);
      }
    }
    if (toSave.length) await repo.save(toSave);
    const tenant = await this.tenants.findOne({ where: { id: ctx.tenantId } });
    const paymentMethods = await this.listPaymentMethods(tenant!);
    return {
      invoices: rows.map((i) => this.serializeInvoice(i)),
      paymentMethods,
    };
  }

  async getInvoice(auth: AuthUser, id: string) {
    const ctx = this.requirePortalUser(auth);
    const repo = await this.tenantConnections.getInvoiceRepository(
      ctx.schemaName,
    );
    const inv = await repo.findOne({
      where: { id, clientId: ctx.clientId },
      relations: { items: true },
    });
    if (!inv || !PORTAL_INVOICE_STATUSES.includes(inv.status as never)) {
      throw new NotFoundException('Factura no encontrada');
    }
    return this.serializeInvoice(inv);
  }

  async getInvoicePdf(auth: AuthUser, id: string): Promise<{
    filename: string;
    buffer: Buffer;
  }> {
    const ctx = this.requirePortalUser(auth);
    const repo = await this.tenantConnections.getInvoiceRepository(
      ctx.schemaName,
    );
    const inv = await repo.findOne({
      where: { id, clientId: ctx.clientId },
      relations: { items: true },
    });
    if (!inv) throw new NotFoundException('Factura no encontrada');
    const clients = await this.tenantConnections.getClientRepository(
      ctx.schemaName,
    );
    const client = await clients.findOne({ where: { id: ctx.clientId } });
    const tenant = await this.tenants.findOne({ where: { id: ctx.tenantId } });
    if (!tenant || !client) throw new NotFoundException('Datos incompletos');
    const buffer = await this.invoicePdf.render({
      invoice: inv,
      tenant,
      clientName: this.clientDisplayName(client),
      clientEmail: client.email,
      clientPhone: client.phone,
      clientAddress: [client.street, client.city].filter(Boolean).join(', '),
    });
    const safe = inv.number.replace(/[^a-zA-Z0-9_-]/g, '_');
    return { filename: `factura-${safe}.pdf`, buffer };
  }

  async listPaymentMethods(tenant: Tenant) {
    const enabled = normalizeEnabledModules(tenant.enabledModules);
    const methods: Array<{
      id: string;
      name: string;
      configured: boolean;
    }> = [];
    if (enabled.includes('mercadopago')) {
      const cfg = await this.getMercadoPagoConfig(tenant.schemaName);
      methods.push({
        id: 'mercadopago',
        name: 'Mercado Pago',
        configured: isMercadoPagoConfigured(cfg),
      });
    }
    return methods;
  }

  private async getMercadoPagoConfig(
    schemaName: string,
  ): Promise<MercadoPagoModuleConfig> {
    const repo =
      await this.tenantConnections.getModuleConfigRepository(schemaName);
    const row = await repo.findOne({ where: { moduleId: 'mercadopago' } });
    return {
      ...EMPTY_MERCADOPAGO_CONFIG,
      ...((row?.config ?? {}) as Partial<MercadoPagoModuleConfig>),
    };
  }

  async createPaymentPreference(auth: AuthUser, invoiceId: string) {
    const ctx = this.requirePortalUser(auth);
    const tenant = await this.tenants.findOne({ where: { id: ctx.tenantId } });
    if (!tenant) throw new NotFoundException('Empresa no encontrada');
    if (
      !normalizeEnabledModules(tenant.enabledModules).includes('mercadopago')
    ) {
      throw new BadRequestException(
        'Mercado Pago no está activo para esta empresa',
      );
    }
    const cfg = await this.getMercadoPagoConfig(ctx.schemaName);
    if (!isMercadoPagoConfigured(cfg)) {
      throw new BadRequestException('Mercado Pago no está configurado');
    }

    const repo = await this.tenantConnections.getInvoiceRepository(
      ctx.schemaName,
    );
    const inv = await repo.findOne({
      where: { id: invoiceId, clientId: ctx.clientId },
      relations: { items: true },
    });
    if (!inv) throw new NotFoundException('Factura no encontrada');
    if (!PAYABLE_STATUSES.has(inv.status)) {
      throw new BadRequestException('Esta factura no se puede pagar');
    }

    const webBase = await this.publicUrls.resolvePublicWebUrl();
    const apiBase = await this.publicUrls.resolvePublicApiUrl();
    const portalBase = `${webBase}/${tenant.slug}/portal`;
    const externalRef = `inv:${tenant.id}:${inv.id}`;
    const amount = Number(inv.total);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestException('Monto de factura inválido');
    }

    const body = {
      items: [
        {
          id: inv.id,
          title: `${tenant.invoiceDocLabel || 'Factura'} ${inv.number}`,
          quantity: 1,
          currency_id: inv.currency || tenant.currency || 'USD',
          unit_price: amount,
        },
      ],
      external_reference: externalRef,
      metadata: {
        tenantId: tenant.id,
        schemaName: tenant.schemaName,
        invoiceId: inv.id,
        clientId: ctx.clientId,
      },
      back_urls: {
        success: `${portalBase}/facturas?paid=${inv.id}`,
        pending: `${portalBase}/facturas?pending=${inv.id}`,
        failure: `${portalBase}/facturas?failed=${inv.id}`,
      },
      auto_return: 'approved',
      notification_url: `${apiBase}/public/client-portal/webhooks/mercadopago/${tenant.slug}`,
    };

    const res = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const data = (await res.json()) as {
      id?: string;
      init_point?: string;
      sandbox_init_point?: string;
      message?: string;
      error?: string;
    };
    if (!res.ok || !data.id) {
      this.logger.warn(
        `MP preference failed: ${JSON.stringify(data).slice(0, 300)}`,
      );
      throw new BadRequestException(
        data.message || data.error || 'No se pudo crear el pago en Mercado Pago',
      );
    }
    const checkoutUrl =
      cfg.environment === 'sandbox'
        ? data.sandbox_init_point || data.init_point
        : data.init_point || data.sandbox_init_point;
    if (!checkoutUrl) {
      throw new BadRequestException('Mercado Pago no devolvió URL de pago');
    }
    return {
      ok: true,
      preferenceId: data.id,
      checkoutUrl,
      provider: 'mercadopago' as const,
    };
  }

  async handleMercadoPagoWebhook(slug: string, query: Record<string, string>) {
    const tenant = await this.tenants.findOne({
      where: { slug: slug.trim().toLowerCase() },
    });
    if (!tenant) return { ok: true, ignored: true };
    const cfg = await this.getMercadoPagoConfig(tenant.schemaName);
    if (!isMercadoPagoConfigured(cfg)) return { ok: true, ignored: true };

    const topic = query.topic || query.type || '';
    const id = query['data.id'] || query.id || '';
    if (!id || (topic && !/payment/i.test(topic))) {
      return { ok: true, ignored: true };
    }

    const payRes = await fetch(
      `https://api.mercadopago.com/v1/payments/${encodeURIComponent(id)}`,
      {
        headers: { Authorization: `Bearer ${cfg.accessToken}` },
      },
    );
    if (!payRes.ok) return { ok: true, ignored: true };
    const payment = (await payRes.json()) as {
      status?: string;
      external_reference?: string;
      metadata?: { invoiceId?: string; schemaName?: string };
    };
    if (payment.status !== 'approved') return { ok: true, pending: true };

    let invoiceId = payment.metadata?.invoiceId;
    const ref = payment.external_reference || '';
    if (!invoiceId && ref.startsWith('inv:')) {
      const parts = ref.split(':');
      invoiceId = parts[2];
    }
    if (!invoiceId) return { ok: true, ignored: true };

    const invRepo = await this.tenantConnections.getInvoiceRepository(
      tenant.schemaName,
    );
    const inv = await invRepo.findOne({ where: { id: invoiceId } });
    if (!inv) return { ok: true, ignored: true };
    if (inv.status !== 'paid') {
      inv.status = 'paid';
      await invRepo.save(inv);
      this.logger.log(
        `Invoice ${inv.number} marked paid via Mercado Pago (${id})`,
      );
    }
    return { ok: true, paid: true, invoiceId: inv.id };
  }

  /**
   * Upsert portal user + send welcome/invite email.
   * Never throws to CRM callers — returns soft result.
   */
  async inviteClient(opts: {
    tenantId: string;
    schemaName: string;
    clientId: string;
    email: string;
    name: string;
    forceResend?: boolean;
    client?: {
      id: string;
      firstName: string;
      lastName: string;
      companyName: string;
      documentType: string;
      documentNumber: string;
      isCompany: boolean;
      companyTaxId: string;
      isLead: boolean;
      email: string;
      phone: string;
      street: string;
      city: string;
      zipCode: string;
      latitude: number | null;
      longitude: number | null;
      note: string;
      isActive: boolean;
      zoneId: string | null;
    };
  }): Promise<{ sent: boolean; skipped?: string; error?: string }> {
    const tenant = await this.tenants.findOne({ where: { id: opts.tenantId } });
    if (!tenant) return { sent: false, skipped: 'tenant_missing' };
    if (
      !normalizeEnabledModules(tenant.enabledModules).includes('client_portal')
    ) {
      return { sent: false, skipped: 'module_disabled' };
    }
    const email = opts.email.toLowerCase().trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return { sent: false, skipped: 'invalid_email' };
    }

    let user = opts.client
      ? await this.syncClientSnapshot({
          tenantId: tenant.id,
          client: opts.client,
        })
      : await this.users.findOne({
          where: { tenantId: tenant.id, clientId: opts.clientId },
        });

    if (!user) {
      const byEmail = await this.users.findOne({
        where: { tenantId: tenant.id, email },
      });
      if (byEmail && byEmail.clientId !== opts.clientId) {
        return { sent: false, skipped: 'email_taken' };
      }
      user = byEmail;
    }
    if (!user) {
      user = this.users.create({
        tenantId: tenant.id,
        clientId: opts.clientId,
        email,
        name: opts.name,
        status: 'invited',
        passwordHash: null,
        archivedAt: null,
      });
    } else {
      user.email = email;
      user.name = opts.name || user.name;
      user.clientId = opts.clientId;
      user.archivedAt = null;
      if (user.status === 'disabled' || user.status === 'stored') {
        user.status = 'invited';
      }
      if (user.status === 'active' && !opts.forceResend) {
        await this.users.save(user);
        return { sent: false, skipped: 'already_active' };
      }
      if (user.status === 'active' && opts.forceResend) {
        // keep active; just send reset-style invite
      } else if (user.status !== 'active') {
        user.status = 'invited';
      }
    }
    await this.users.save(user);

    const rawToken = randomBytes(32).toString('hex');
    await this.invites.save(
      this.invites.create({
        portalUserId: user.id,
        tokenHash: this.hashToken(rawToken),
        expiresAt: new Date(Date.now() + INVITE_TTL_MS),
        usedAt: null,
      }),
    );

    const webBase = await this.publicUrls.resolvePublicWebUrl();
    const activateUrl = `${webBase}/${tenant.slug}/portal/activar?token=${rawToken}`;
    try {
      await this.mailer.sendMail(opts.schemaName, {
        to: email,
        subject: `Bienvenido a ${tenant.name} — crea tu cuenta`,
        title: 'Activa tu portal',
        html: this.welcomeHtml({
          companyName: tenant.name,
          clientName: opts.name || email,
          activateUrl,
        }),
      });
      return { sent: true };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Portal invite mail failed for ${email}: ${error}`);
      return { sent: false, error };
    }
  }

  private welcomeHtml(opts: {
    companyName: string;
    clientName: string;
    activateUrl: string;
  }) {
    return `
      <p style="margin:0 0 14px">Hola ${escapeHtml(opts.clientName)},</p>
      <p style="margin:0 0 14px">Tu servicio en <strong>${escapeHtml(opts.companyName)}</strong> ya está activo. Crea tu cuenta en el portal de clientes para ver servicios, consumo, señal y facturas.</p>
      ${emailCtaButton(opts.activateUrl, 'Crear mi cuenta')}
      <p style="margin:0;color:#64748b;font-size:13px">El enlace caduca en 7 días. Si no solicitaste esto, ignora este correo.</p>
    `;
  }

  async resendInviteForClient(auth: AuthUser, clientId: string) {
    if (!auth.tenantId || !auth.schemaName) {
      throw new BadRequestException('Tenant required');
    }
    const clients = await this.tenantConnections.getClientRepository(
      auth.schemaName,
    );
    const client = await clients.findOne({ where: { id: clientId } });
    if (!client) throw new NotFoundException('Cliente no encontrado');
    if (client.isLead) {
      throw new BadRequestException('Los leads no tienen portal');
    }
    if (!client.isActive) {
      throw new BadRequestException('El cliente no está activo');
    }
    const result = await this.inviteClient({
      tenantId: auth.tenantId,
      schemaName: auth.schemaName,
      clientId: client.id,
      email: client.email,
      name: this.clientDisplayName(client),
      forceResend: true,
      client,
    });
    if (result.skipped === 'module_disabled') {
      throw new ForbiddenException('Portal de clientes no contratado');
    }
    if (result.skipped === 'invalid_email') {
      throw new BadRequestException('El cliente no tiene un correo válido');
    }
    if (result.error) {
      throw new BadRequestException(result.error);
    }
    return { ok: true, ...result };
  }

  async onClientArchivedOrDeleted(tenantId: string, clientId: string) {
    const user = await this.users.findOne({
      where: { tenantId, clientId },
    });
    if (!user) return;
    user.archivedAt = new Date();
    user.status = 'disabled';
    await this.users.save(user);
  }

  async adminList(opts: {
    tenantId?: string;
    status?: string;
    q?: string;
    limit?: number;
  }) {
    const qb = this.users
      .createQueryBuilder('u')
      .leftJoinAndSelect('u.tenant', 't')
      .orderBy('u.createdAt', 'DESC')
      .take(Math.min(opts.limit ?? 200, 500));
    if (opts.tenantId) {
      qb.andWhere('u.tenant_id = :tenantId', { tenantId: opts.tenantId });
    }
    if (opts.status) {
      qb.andWhere('u.status = :status', { status: opts.status });
    }
    if (opts.q?.trim()) {
      const q = `%${opts.q.trim().toLowerCase()}%`;
      qb.andWhere(
        `(LOWER(u.email) LIKE :q OR LOWER(u.name) LIKE :q OR LOWER(t.name) LIKE :q
          OR LOWER(u.first_name) LIKE :q OR LOWER(u.last_name) LIKE :q
          OR LOWER(u.company_name) LIKE :q OR LOWER(u.phone) LIKE :q
          OR LOWER(u.street) LIKE :q OR LOWER(u.city) LIKE :q
          OR LOWER(u.document_number) LIKE :q)`,
        { q },
      );
    }
    const rows = await qb.getMany();
    return rows.map((u) => this.serializeUser(u, u.tenant));
  }

  async adminSetStatus(id: string, status: ClientPortalUserStatus) {
    const user = await this.users.findOne({
      where: { id },
      relations: { tenant: true },
    });
    if (!user) throw new NotFoundException('Usuario no encontrado');
    user.status = status;
    if (status === 'disabled') {
      user.archivedAt = user.archivedAt ?? new Date();
    }
    await this.users.save(user);
    return this.serializeUser(user, user.tenant);
  }

  async portalStatusForClient(tenantId: string, clientId: string) {
    const user = await this.users.findOne({
      where: { tenantId, clientId },
    });
    if (!user) return { linked: false as const };
    return {
      linked: true as const,
      status: user.status,
      email: user.email,
      archivedAt: user.archivedAt,
    };
  }
}
