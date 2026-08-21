import {
  BadRequestException,
  Injectable,
  Inject,
  Logger,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import type { AuthUser } from '../auth/auth.types';
import { TenantConnectionService } from '../database/tenant-connection.service';
import { Tenant } from '../tenants/entities/tenant.entity';
import { TenantMailerService } from '../modules/tenant-mailer.service';
import { TenantWhatsAppService } from '../modules/tenant-whatsapp.service';
import { ClientService } from '../crm/entities/client-service.entity';
import { ServicePlan } from '../crm/entities/service-plan.entity';
import { BillingSettings } from './entities/billing-settings.entity';
import { InvoiceTemplate } from './entities/invoice-template.entity';
import { Invoice } from './entities/invoice.entity';
import { BillingProduct } from './entities/billing-product.entity';
import {
  DEFAULT_INVOICE_TEMPLATES,
  TEMPLATE_VERSION_TAG,
} from './default-templates';
import {
  CreateBillingProductDto,
  CreateInvoiceDto,
  CreateInvoiceTemplateDto,
  UpdateBillingProductDto,
  UpdateBillingSettingsDto,
  UpdateInvoiceTemplateDto,
} from './dto/billing.dto';
import { InvoicePdfService } from './invoice-pdf.service';
import { CrmService } from '../crm/crm.service';
import {
  computeFirstPeriod as computePeriodForRegime,
  computeServiceFirstPeriod,
  dateOnDayOfMonth,
  daysInclusive,
  effectiveBillingRegime,
  formatIsoDate,
  parseIsoDate,
  addDays as addDaysUtc,
  rollPeriod,
  rollServicePeriod,
  type BillingRegime,
} from './billing-period.util';

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    private readonly tenantConnections: TenantConnectionService,
    @InjectRepository(Tenant)
    private readonly tenants: Repository<Tenant>,
    private readonly mailer: TenantMailerService,
    private readonly whatsapp: TenantWhatsAppService,
    private readonly invoicePdf: InvoicePdfService,
    @Inject(forwardRef(() => CrmService))
    private readonly crm: CrmService,
  ) {}

  private requireSchema(user: AuthUser): string {
    if (!user.schemaName) {
      throw new BadRequestException('Tenant schema required');
    }
    return user.schemaName;
  }

  // —— Settings ——

  async getSettings(user: AuthUser) {
    const settings = await this.ensureSettings(this.requireSchema(user));
    return this.serializeSettings(settings);
  }

  async updateSettings(user: AuthUser, dto: UpdateBillingSettingsDto) {
    const schema = this.requireSchema(user);
    const repo =
      await this.tenantConnections.getBillingSettingsRepository(schema);
    const settings = await this.ensureSettings(schema);

    if (dto.timezone !== undefined) settings.timezone = dto.timezone.trim();
    if (dto.invoicePrefix !== undefined)
      settings.invoicePrefix = dto.invoicePrefix.trim() || 'F';
    if (dto.periodsEnabled !== undefined)
      settings.periodsEnabled = dto.periodsEnabled;
    if (dto.periodsCron !== undefined)
      settings.periodsCron = this.assertCron(dto.periodsCron);
    if (dto.generateEnabled !== undefined)
      settings.generateEnabled = dto.generateEnabled;
    if (dto.generateCron !== undefined)
      settings.generateCron = this.assertCron(dto.generateCron);
    if (dto.sendEnabled !== undefined) settings.sendEnabled = dto.sendEnabled;
    if (dto.sendCron !== undefined)
      settings.sendCron = this.assertCron(dto.sendCron);
    if (dto.defaultDueDays !== undefined)
      settings.defaultDueDays = dto.defaultDueDays;
    if (dto.graceDaysAfterDue !== undefined)
      settings.graceDaysAfterDue = dto.graceDaysAfterDue;
    if (dto.billingCycleDay !== undefined)
      settings.billingCycleDay = dto.billingCycleDay;
    if (dto.billingRegime !== undefined) {
      settings.billingRegime = dto.billingRegime;
    }
    if (effectiveBillingRegime(settings.billingRegime) === 'from_install') {
      settings.periodsEnabled = false;
    }

    await repo.save(settings);
    return this.serializeSettings(settings);
  }

  async ensureSettings(schema: string): Promise<BillingSettings> {
    const repo =
      await this.tenantConnections.getBillingSettingsRepository(schema);
    let settings = await repo.findOne({ where: {} });
    if (!settings) {
      settings = await repo.save(repo.create({}));
      await this.ensureDefaultTemplates(schema);
    }
    return settings;
  }

  private assertCron(expr: string): string {
    const trimmed = expr.trim();
    if (trimmed.split(/\s+/).length !== 5) {
      throw new BadRequestException(
        'Cron inválido: use 5 campos (min hour day month weekday)',
      );
    }
    return trimmed;
  }

  private serializeSettings(s: BillingSettings) {
    return {
      id: s.id,
      timezone: s.timezone,
      invoicePrefix: s.invoicePrefix,
      nextInvoiceNumber: s.nextInvoiceNumber,
      periodsEnabled: s.periodsEnabled,
      periodsCron: s.periodsCron,
      periodsLastRunAt: s.periodsLastRunAt,
      generateEnabled: s.generateEnabled,
      generateCron: s.generateCron,
      generateLastRunAt: s.generateLastRunAt,
      sendEnabled: s.sendEnabled,
      sendCron: s.sendCron,
      sendLastRunAt: s.sendLastRunAt,
      defaultDueDays: s.defaultDueDays,
      graceDaysAfterDue: s.graceDaysAfterDue,
      billingCycleDay: s.billingCycleDay,
      billingRegime: effectiveBillingRegime(s.billingRegime),
      updatedAt: s.updatedAt,
    };
  }

  // —— Templates ——

  async listTemplates(user: AuthUser) {
    const schema = this.requireSchema(user);
    await this.ensureSettings(schema);
    await this.upgradeDefaultTemplatesIfStale(schema);
    const repo =
      await this.tenantConnections.getInvoiceTemplateRepository(schema);
    const rows = await repo.find({ order: { type: 'ASC', name: 'ASC' } });
    return rows.map((t) => this.serializeTemplate(t));
  }

  async createTemplate(user: AuthUser, dto: CreateInvoiceTemplateDto) {
    const schema = this.requireSchema(user);
    const repo =
      await this.tenantConnections.getInvoiceTemplateRepository(schema);
    if (dto.isDefault) {
      await repo.update({ type: dto.type }, { isDefault: false });
    }
    const row = await repo.save(
      repo.create({
        type: dto.type,
        name: dto.name.trim(),
        subject: (dto.subject ?? '').trim(),
        bodyHtml: dto.bodyHtml ?? '',
        isDefault: dto.isDefault ?? false,
        isActive: dto.isActive ?? true,
      }),
    );
    return this.serializeTemplate(row);
  }

  async updateTemplate(
    user: AuthUser,
    id: string,
    dto: UpdateInvoiceTemplateDto,
  ) {
    const schema = this.requireSchema(user);
    const repo =
      await this.tenantConnections.getInvoiceTemplateRepository(schema);
    const row = await repo.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Plantilla no encontrada');

    if (dto.type !== undefined) row.type = dto.type;
    if (dto.name !== undefined) row.name = dto.name.trim();
    if (dto.subject !== undefined) row.subject = dto.subject.trim();
    if (dto.bodyHtml !== undefined) row.bodyHtml = dto.bodyHtml;
    if (dto.isActive !== undefined) row.isActive = dto.isActive;
    if (dto.isDefault === true) {
      await repo.update({ type: row.type }, { isDefault: false });
      row.isDefault = true;
    } else if (dto.isDefault === false) {
      row.isDefault = false;
    }

    await repo.save(row);
    return this.serializeTemplate(row);
  }

  async deleteTemplate(user: AuthUser, id: string) {
    const schema = this.requireSchema(user);
    const repo =
      await this.tenantConnections.getInvoiceTemplateRepository(schema);
    const row = await repo.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Plantilla no encontrada');
    await repo.delete({ id });
    return { ok: true };
  }

  async ensureDefaultTemplates(schema: string) {
    const repo =
      await this.tenantConnections.getInvoiceTemplateRepository(schema);
    // Inserta defaults faltantes (p. ej. tipo «manual» en tenants ya existentes).
    for (const t of DEFAULT_INVOICE_TEMPLATES) {
      if (!t.isDefault) continue;
      const existing = await repo.findOne({
        where: { type: t.type, isDefault: true },
      });
      if (!existing) {
        await repo.save(repo.create(t));
      }
    }
    await this.upgradeDefaultTemplatesIfStale(schema);
  }

  /**
   * Default templates created before the professional layout lack
   * {{invoice.itemsTable}} / {{company.logo}}. Upgrade them in place.
   */
  private async upgradeDefaultTemplatesIfStale(schema: string) {
    const repo =
      await this.tenantConnections.getInvoiceTemplateRepository(schema);
    for (const seed of DEFAULT_INVOICE_TEMPLATES) {
      if (!seed.isDefault) continue;
      const existing = await repo.findOne({
        where: { type: seed.type, isDefault: true },
      });
      if (!existing) continue;
      const body = existing.bodyHtml || '';
      if (body.includes(TEMPLATE_VERSION_TAG)) continue;
      existing.name = seed.name;
      existing.subject = seed.subject;
      existing.bodyHtml = seed.bodyHtml;
      existing.isActive = true;
      await repo.save(existing);
    }
  }

  /** Overwrite the seeded default templates with the latest professional layout. */
  async resetDefaultTemplates(user: AuthUser) {
    const schema = this.requireSchema(user);
    await this.ensureSettings(schema);
    const repo =
      await this.tenantConnections.getInvoiceTemplateRepository(schema);
    for (const t of DEFAULT_INVOICE_TEMPLATES) {
      const existing = await repo.findOne({
        where: { type: t.type, isDefault: true },
      });
      if (existing) {
        existing.name = t.name;
        existing.subject = t.subject;
        existing.bodyHtml = t.bodyHtml;
        existing.isActive = true;
        await repo.save(existing);
      } else {
        await repo.save(repo.create(t));
      }
    }
    return this.listTemplates(user);
  }

  private serializeTemplate(t: InvoiceTemplate) {
    return {
      id: t.id,
      type: t.type,
      name: t.name,
      subject: t.subject,
      bodyHtml: t.bodyHtml,
      isDefault: t.isDefault,
      isActive: t.isActive,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    };
  }

  // —— Invoices (core) ——

  async listInvoices(user: AuthUser, limit = 50) {
    const schema = this.requireSchema(user);
    const repo = await this.tenantConnections.getInvoiceRepository(schema);
    const rows = await repo.find({
      relations: { items: true },
      order: { createdAt: 'DESC' },
      take: Math.min(limit, 200),
    });
    return rows.map((i) => this.serializeInvoice(i));
  }

  /**
   * Resumen contable: KPIs de cobranza + facturas con cliente,
   * agrupables por mes de emisión (vista Contabilidad).
   */
  async accountingOverview(user: AuthUser) {
    const schema = this.requireSchema(user);
    const invRepo = await this.tenantConnections.getInvoiceRepository(schema);
    const clientRepo =
      await this.tenantConnections.getClientRepository(schema);

    const rows = await invRepo.find({
      order: { issueDate: 'DESC', createdAt: 'DESC' },
      take: 5000,
    });

    const clientIds = [...new Set(rows.map((r) => r.clientId))];
    const clients =
      clientIds.length === 0
        ? []
        : await clientRepo.find({ where: { id: In(clientIds) } });
    const clientById = new Map(clients.map((c) => [c.id, c]));

    const now = new Date();
    const monthStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
    )
      .toISOString()
      .slice(0, 10);
    const monthEnd = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0),
    )
      .toISOString()
      .slice(0, 10);
    const currentMonthKey = monthStart.slice(0, 7);

    let salesThisMonth = 0;
    let estimatedEarnings = 0;
    let overdueTotal = 0;
    let invoicedThisMonth = 0;
    let paidCountThisMonth = 0;
    let openInvoiceCount = 0;
    let voidedThisMonth = 0;

    const monthBuckets = new Map<
      string,
      {
        key: string;
        invoiceCount: number;
        total: number;
        paid: number;
        pending: number;
        overdue: number;
      }
    >();

    const invoices = rows.map((inv) => {
      const total = Number(inv.total) || 0;
      const monthKey = (inv.issueDate || '').slice(0, 7);
      const inCurrentMonth =
        inv.issueDate >= monthStart && inv.issueDate <= monthEnd;
      const isOpen =
        inv.status === 'issued' ||
        inv.status === 'sent' ||
        inv.status === 'overdue';

      if (inv.status === 'paid' && inCurrentMonth) {
        salesThisMonth += total;
        paidCountThisMonth += 1;
      }
      if (isOpen) {
        estimatedEarnings += total;
        openInvoiceCount += 1;
      }
      if (inv.status === 'overdue') overdueTotal += total;
      if (inCurrentMonth && inv.status !== 'void' && inv.status !== 'draft') {
        invoicedThisMonth += total;
      }
      if (inv.status === 'void' && inCurrentMonth) voidedThisMonth += total;

      if (monthKey) {
        let bucket = monthBuckets.get(monthKey);
        if (!bucket) {
          bucket = {
            key: monthKey,
            invoiceCount: 0,
            total: 0,
            paid: 0,
            pending: 0,
            overdue: 0,
          };
          monthBuckets.set(monthKey, bucket);
        }
        bucket.invoiceCount += 1;
        if (inv.status !== 'void' && inv.status !== 'draft') {
          bucket.total += total;
        }
        if (inv.status === 'paid') bucket.paid += total;
        if (isOpen) bucket.pending += total;
        if (inv.status === 'overdue') bucket.overdue += total;
      }

      const client = clientById.get(inv.clientId);
      return {
        ...this.serializeInvoice(inv),
        items: [],
        clientName: client ? accountingClientName(client) : 'Cliente',
        clientEmail: client?.email ?? '',
      };
    });

    const months = [...monthBuckets.values()].sort((a, b) =>
      a.key < b.key ? 1 : a.key > b.key ? -1 : 0,
    );

    const collectionRateThisMonth =
      invoicedThisMonth > 0
        ? Math.round((salesThisMonth / invoicedThisMonth) * 1000) / 10
        : 0;

    return {
      currentMonth: currentMonthKey,
      kpis: {
        salesThisMonth,
        estimatedEarnings,
        overdueTotal,
        invoicedThisMonth,
        paidCountThisMonth,
        openInvoiceCount,
        voidedThisMonth,
        collectionRateThisMonth,
        invoiceCount: rows.length,
      },
      months,
      invoices,
    };
  }

  async listClientInvoices(user: AuthUser, clientId: string, limit = 100) {
    const schema = this.requireSchema(user);
    const clients = await this.tenantConnections.getClientRepository(schema);
    const client = await clients.findOne({ where: { id: clientId } });
    if (!client) throw new NotFoundException('Cliente no encontrado');
    const repo = await this.tenantConnections.getInvoiceRepository(schema);
    const rows = await repo.find({
      where: { clientId },
      relations: { items: true },
      order: { createdAt: 'DESC' },
      take: Math.min(limit, 200),
    });
    return rows.map((i) => this.serializeInvoice(i));
  }

  async getInvoice(user: AuthUser, id: string) {
    const schema = this.requireSchema(user);
    const built = await this.buildInvoiceEmail(schema, id);
    return {
      ...this.serializeInvoice(built.invoice),
      clientEmail: built.clientEmail,
      clientName: built.clientName,
      subject: built.subject,
      bodyHtml: built.bodyHtml,
    };
  }

  /** Detalle compacto para el Asistente (sin HTML de email). */
  async getInvoiceCompact(user: AuthUser, id: string) {
    const schema = this.requireSchema(user);
    const repo = await this.tenantConnections.getInvoiceRepository(schema);
    const inv = await repo.findOne({
      where: { id },
      relations: { items: true },
    });
    if (!inv) throw new NotFoundException('Factura no encontrada');
    const clients = await this.tenantConnections.getClientRepository(schema);
    const client = await clients.findOne({ where: { id: inv.clientId } });
    return {
      ...this.serializeInvoice(inv),
      clientName: client ? accountingClientName(client) : null,
      clientPhone: client?.phone ?? null,
      clientEmail: client?.email ?? null,
    };
  }

  /**
   * Busca facturas por número, cliente, estado o texto libre.
   * status: paid|overdue|issued|sent|draft|void|open (open = issued+sent+overdue)
   */
  async searchInvoices(
    user: AuthUser,
    opts?: {
      q?: string;
      status?: string;
      clientId?: string;
      limit?: number;
    },
  ) {
    const schema = this.requireSchema(user);
    const limit = Math.min(Math.max(opts?.limit ?? 40, 1), 100);
    const q = (opts?.q ?? '').trim().toLowerCase();
    const status = (opts?.status ?? '').trim().toLowerCase();
    const clientId = opts?.clientId?.trim() || '';

    const repo = await this.tenantConnections.getInvoiceRepository(schema);
    const where = clientId ? { clientId } : {};
    const rows = await repo.find({
      where,
      relations: { items: true },
      order: { createdAt: 'DESC' },
      take: 2000,
    });

    const clientIds = [...new Set(rows.map((r) => r.clientId))];
    const clients =
      clientIds.length === 0
        ? []
        : await (
            await this.tenantConnections.getClientRepository(schema)
          ).find({ where: { id: In(clientIds) } });
    const clientById = new Map(clients.map((c) => [c.id, c]));

    const openStatuses = new Set(['issued', 'sent', 'overdue']);
    let filtered = rows;
    if (status === 'open' || status === 'debt' || status === 'deuda') {
      filtered = filtered.filter((i) => openStatuses.has(i.status));
    } else if (status === 'overdue' || status === 'vencida') {
      filtered = filtered.filter((i) => i.status === 'overdue');
    } else if (status) {
      filtered = filtered.filter((i) => i.status === status);
    }

    if (q) {
      filtered = filtered.filter((i) => {
        const c = clientById.get(i.clientId);
        const hay = [
          i.number,
          i.status,
          i.notes,
          i.periodStart,
          i.periodEnd,
          c?.firstName,
          c?.lastName,
          c?.companyName,
          c?.phone,
          c?.email,
          c?.documentNumber,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return hay.includes(q);
      });
    }

    const sliced = filtered.slice(0, limit);
    let debtTotal = 0;
    let overdueTotal = 0;
    for (const i of filtered) {
      const total = Number(i.total) || 0;
      if (openStatuses.has(i.status)) debtTotal += total;
      if (i.status === 'overdue') overdueTotal += total;
    }

    return {
      q: q || null,
      status: status || null,
      clientId: clientId || null,
      returned: sliced.length,
      matched: filtered.length,
      debtTotal: Number(debtTotal.toFixed(2)),
      overdueTotal: Number(overdueTotal.toFixed(2)),
      invoices: sliced.map((i) => {
        const c = clientById.get(i.clientId);
        return {
          ...this.serializeInvoice(i),
          clientName: c ? accountingClientName(c) : null,
          clientPhone: c?.phone ?? null,
        };
      }),
    };
  }

  async sendInvoice(user: AuthUser, id: string, emailOverride?: string) {
    const schema = this.requireSchema(user);
    const built = await this.buildInvoiceEmail(schema, id);
    const to = (emailOverride?.trim() || built.clientEmail).toLowerCase();
    if (!to) {
      throw new BadRequestException(
        'El cliente no tiene correo. Indica uno para reenviar.',
      );
    }
    const pdf = await this.renderInvoicePdf(built);
    await this.mailer.sendMail(schema, {
      to,
      subject: built.subject,
      title: built.subject,
      html: built.bodyHtml,
      attachments: [
        {
          filename: this.invoicePdfFileName(built.invoice.number),
          content: pdf,
          contentType: 'application/pdf',
        },
      ],
    });
    const whatsapp = await this.trySendInvoiceWhatsApp(schema, built, pdf);
    const repo = await this.tenantConnections.getInvoiceRepository(schema);
    if (
      built.invoice.status === 'draft' ||
      built.invoice.status === 'issued' ||
      built.invoice.status === 'overdue'
    ) {
      built.invoice.status = 'sent';
    }
    built.invoice.sentAt = new Date();
    await repo.save(built.invoice);
    return {
      ok: true,
      sentTo: to,
      whatsapp,
      invoice: this.serializeInvoice(built.invoice),
    };
  }

  // —— Products (catálogo) ——

  async listProducts(user: AuthUser) {
    const schema = this.requireSchema(user);
    const repo =
      await this.tenantConnections.getBillingProductRepository(schema);
    const rows = await repo.find({ order: { name: 'ASC' } });
    return rows.map((p) => this.serializeProduct(p));
  }

  async createProduct(user: AuthUser, dto: CreateBillingProductDto) {
    const schema = this.requireSchema(user);
    const repo =
      await this.tenantConnections.getBillingProductRepository(schema);
    const product = await repo.save(
      repo.create({
        name: dto.name.trim(),
        description: dto.description?.trim() ?? '',
        unitPrice: dto.unitPrice.toFixed(2),
        isActive: dto.isActive ?? true,
      }),
    );
    return this.serializeProduct(product);
  }

  async updateProduct(
    user: AuthUser,
    id: string,
    dto: UpdateBillingProductDto,
  ) {
    const schema = this.requireSchema(user);
    const repo =
      await this.tenantConnections.getBillingProductRepository(schema);
    const product = await repo.findOne({ where: { id } });
    if (!product) throw new NotFoundException('Producto no encontrado');
    if (dto.name !== undefined) product.name = dto.name.trim();
    if (dto.description !== undefined)
      product.description = dto.description.trim();
    if (dto.unitPrice !== undefined)
      product.unitPrice = dto.unitPrice.toFixed(2);
    if (dto.isActive !== undefined) product.isActive = dto.isActive;
    await repo.save(product);
    return this.serializeProduct(product);
  }

  async deleteProduct(user: AuthUser, id: string) {
    const schema = this.requireSchema(user);
    const repo =
      await this.tenantConnections.getBillingProductRepository(schema);
    const product = await repo.findOne({ where: { id } });
    if (!product) throw new NotFoundException('Producto no encontrado');
    await repo.remove(product);
    return { ok: true };
  }

  private serializeProduct(p: BillingProduct) {
    return {
      id: p.id,
      name: p.name,
      description: p.description,
      unitPrice: p.unitPrice,
      isActive: p.isActive,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    };
  }

  // —— Factura manual ——

  async createManualInvoice(user: AuthUser, dto: CreateInvoiceDto) {
    const schema = this.requireSchema(user);
    const clients = await this.tenantConnections.getClientRepository(schema);
    const client = await clients.findOne({ where: { id: dto.clientId } });
    if (!client) throw new NotFoundException('Cliente no encontrado');

    const items = dto.items.map((it) => ({
      description: it.description.trim(),
      quantity: it.quantity,
      unitPrice: it.unitPrice,
    }));

    const invoice = await this.createInvoiceInSchema(schema, {
      clientId: dto.clientId,
      type: 'manual',
      items,
      notes: dto.notes?.trim() ?? '',
    });

    let sentTo: string | null = null;
    if (dto.sendEmail) {
      try {
        const res = await this.sendInvoice(user, invoice.id, dto.email);
        sentTo = res.sentTo;
      } catch (err) {
        this.logger.warn(
          `Factura manual ${invoice.number} creada pero no se envió: ${(err as Error).message}`,
        );
      }
    }

    const full = await this.getInvoice(user, invoice.id);
    return { ...full, sentTo };
  }

  private async nextNumber(schema: string): Promise<string> {
    const repo =
      await this.tenantConnections.getBillingSettingsRepository(schema);
    const settings = await this.ensureSettings(schema);
    const n = settings.nextInvoiceNumber;
    settings.nextInvoiceNumber = n + 1;
    await repo.save(settings);
    return `${settings.invoicePrefix}-${String(n).padStart(5, '0')}`;
  }

  private async tenantCurrency(schema: string): Promise<string> {
    const tenant = await this.tenants.findOne({
      where: { schemaName: schema },
    });
    return tenant?.currency || 'USD';
  }

  async createInvoiceInSchema(
    schema: string,
    input: {
      clientId: string;
      clientServiceId?: string | null;
      type: Invoice['type'];
      status?: Invoice['status'];
      items: Array<{
        description: string;
        quantity?: number;
        unitPrice: number;
      }>;
      periodStart?: string | null;
      periodEnd?: string | null;
      notes?: string;
      dueDays?: number;
    },
  ) {
    const settings = await this.ensureSettings(schema);
    const invRepo = await this.tenantConnections.getInvoiceRepository(schema);
    const itemRepo =
      await this.tenantConnections.getInvoiceItemRepository(schema);
    const currency = await this.tenantCurrency(schema);
    const today = new Date().toISOString().slice(0, 10);
    const dueDays = input.dueDays ?? settings.defaultDueDays;
    const due = new Date();
    due.setUTCDate(due.getUTCDate() + dueDays);

    let subtotal = 0;
    const prepared = input.items.map((it, idx) => {
      const qty = it.quantity ?? 1;
      const amount = Math.round(qty * it.unitPrice * 100) / 100;
      subtotal += amount;
      return {
        description: it.description,
        quantity: qty.toFixed(4),
        unitPrice: it.unitPrice.toFixed(2),
        amount: amount.toFixed(2),
        sortOrder: idx,
      };
    });
    subtotal = Math.round(subtotal * 100) / 100;

    const invoice = await invRepo.save(
      invRepo.create({
        number: await this.nextNumber(schema),
        clientId: input.clientId,
        clientServiceId: input.clientServiceId ?? null,
        type: input.type,
        status: input.status ?? 'issued',
        currency,
        subtotal: subtotal.toFixed(2),
        tax: '0.00',
        total: subtotal.toFixed(2),
        periodStart: input.periodStart ?? null,
        periodEnd: input.periodEnd ?? null,
        issueDate: today,
        dueDate: due.toISOString().slice(0, 10),
        notes: input.notes ?? '',
      }),
    );

    for (const it of prepared) {
      await itemRepo.save(
        itemRepo.create({
          invoiceId: invoice.id,
          ...it,
        }),
      );
    }

    const full = await invRepo.findOne({
      where: { id: invoice.id },
      relations: { items: true },
    });
    return full!;
  }

  /**
   * After assigning a plan to a client: init periods + installation fee invoice
   * (immediate) or flag fee for first recurring invoice.
   */
  async onClientServiceCreated(schema: string, service: ClientService) {
    const plans = await this.tenantConnections.getServicePlanRepository(schema);
    const plan = await plans.findOne({ where: { id: service.servicePlanId } });
    if (!plan) return;

    await this.initServicePeriods(schema, service, plan);

    const fee = Number(plan.installationFee ?? 0);
    if (!(fee > 0)) return;

    const services =
      await this.tenantConnections.getClientServiceRepository(schema);

    if (plan.installationFeeOnFirstInvoice) {
      service.installationFeePending = true;
      await services.save(service);
      return;
    }

    await this.createInvoiceInSchema(schema, {
      clientId: service.clientId,
      clientServiceId: service.id,
      type: 'installation',
      items: [
        {
          description: `Instalación — ${plan.invoiceLabel || plan.name}`,
          unitPrice: fee,
        },
      ],
      notes: 'Cargo de instalación al alta del servicio',
    });
    service.installationInvoiced = true;
    service.installationFeePending = false;
    await services.save(service);
  }

  async initServicePeriods(
    schema: string,
    service: ClientService,
    plan: ServicePlan,
  ) {
    const settings = await this.ensureSettings(schema);
    const regime = this.regimeOf(settings);
    const services =
      await this.tenantConnections.getClientServiceRepository(schema);
    const from = await this.resolveServiceStartDate(schema, service, regime);
    const { periodStart, periodEnd, nextBillingDate } = computeServiceFirstPeriod(
      from,
      regime,
      !!service.billingProrate,
      settings.billingCycleDay ?? 1,
    );
    service.activeFrom = service.activeFrom || from;
    service.periodStart = periodStart;
    service.periodEnd = periodEnd;
    service.nextBillingDate = nextBillingDate;
    await services.save(service);
  }

  private regimeOf(settings: BillingSettings): BillingRegime {
    return effectiveBillingRegime(settings.billingRegime);
  }

  private async resolveServiceStartDate(
    schema: string,
    service: ClientService,
    regime: BillingRegime,
  ): Promise<string> {
    if (service.activeFrom) return service.activeFrom;
    if (regime === 'from_install') {
      const clients = await this.tenantConnections.getClientRepository(schema);
      const client = await clients.findOne({
        where: { id: service.clientId },
      });
      if (client?.installDay) {
        return dateOnDayOfMonth(
          new Date().toISOString().slice(0, 10),
          client.installDay,
        );
      }
    }
    return new Date().toISOString().slice(0, 10);
  }

  /**
   * Assign install day on imported clients and seed missing service.activeFrom.
   */
  async applyClientInstallDay(
    schema: string,
    clientId: string,
    installDay: number,
  ) {
    const day = Math.min(31, Math.max(1, Math.floor(installDay)));
    const clients = await this.tenantConnections.getClientRepository(schema);
    const client = await clients.findOne({ where: { id: clientId } });
    if (!client) throw new NotFoundException('Client not found');
    client.installDay = day;
    await clients.save(client);

    const services =
      await this.tenantConnections.getClientServiceRepository(schema);
    const plans = await this.tenantConnections.getServicePlanRepository(schema);
    const rows = await services.find({ where: { clientId } });
    const today = new Date().toISOString().slice(0, 10);
    const from = dateOnDayOfMonth(today, day);
    for (const svc of rows) {
      if (svc.activeFrom) continue;
      svc.activeFrom = from;
      const plan = await plans.findOne({ where: { id: svc.servicePlanId } });
      if (plan) {
        await this.initServicePeriods(schema, svc, plan);
      } else {
        await services.save(svc);
      }
    }
  }

  computeFirstPeriod(
    activeFrom: string,
    plan: Pick<ServicePlan, 'billingAnchor' | 'billingCycleDay'>,
    regime?: BillingRegime,
  ): { periodStart: string; periodEnd: string; nextBillingDate: string } {
    const resolved =
      regime ??
      (plan.billingAnchor === 'installation'
        ? 'from_install'
        : 'calendar_month');
    return computePeriodForRegime(activeFrom, resolved, 1);
  }

  /** Advance periods for services whose period already ended. */
  async runMaintainPeriods(schema: string) {
    const settings = await this.ensureSettings(schema);
    const regime = this.regimeOf(settings);
    if (regime === 'from_install') {
      return { advanced: 0 };
    }
    const cycleDay = settings.billingCycleDay ?? 1;
    const services =
      await this.tenantConnections.getClientServiceRepository(schema);
    const today = new Date().toISOString().slice(0, 10);
    const active = await services.find({
      where: [{ status: 'active' }, { status: 'suspended' }],
    });

    let advanced = 0;
    for (const svc of active) {
      if (!svc.periodEnd || svc.periodEnd >= today) continue;
      const next = rollPeriod(svc.periodEnd, regime, cycleDay);
      svc.periodStart = next.periodStart;
      svc.periodEnd = next.periodEnd;
      svc.nextBillingDate = next.nextBillingDate;
      await services.save(svc);
      advanced += 1;
    }
    return { advanced };
  }

  /**
   * Generate invoices for services due today (next_billing_date <= today).
   * Se emite UNA factura por cliente con la suma de sus servicios vencidos
   * (un ítem por servicio + instalación pendiente). Si el envío está activo,
   * las facturas recién emitidas se mandan por correo al terminar.
   */
  async runGenerateInvoices(schema: string) {
    const settings = await this.ensureSettings(schema);
    const services =
      await this.tenantConnections.getClientServiceRepository(schema);
    const plans = await this.tenantConnections.getServicePlanRepository(schema);
    const planById = new Map(
      (await plans.find()).map((p) => [p.id, p] as const),
    );
    const today = new Date().toISOString().slice(0, 10);
    const due = await services
      .createQueryBuilder('s')
      .where('s.status = :status', { status: 'active' })
      .andWhere('s.next_billing_date IS NOT NULL')
      .andWhere('s.next_billing_date <= :today', { today })
      .getMany();

    // Agrupar servicios vencidos por cliente.
    const byClient = new Map<string, ClientService[]>();
    for (const svc of due) {
      if (!planById.has(svc.servicePlanId)) continue;
      const list = byClient.get(svc.clientId) ?? [];
      list.push(svc);
      byClient.set(svc.clientId, list);
    }

    let created = 0;
    const createdInvoiceIds: string[] = [];

    for (const [clientId, clientServices] of byClient) {
      const items: Array<{
        description: string;
        unitPrice: number;
        quantity?: number;
      }> = [];
      let allProrate = true;
      let minStart: string | null = null;
      let maxEnd: string | null = null;

      for (const svc of clientServices) {
        const plan = planById.get(svc.servicePlanId)!;
        const monthly = Number(svc.price);
        const companyRegime = this.regimeOf(settings);
        const prorateEligible =
          companyRegime === 'calendar_month' ||
          (companyRegime === 'from_install' && svc.billingProrate);
        const isProrate =
          prorateEligible &&
          svc.periodStart &&
          svc.periodEnd &&
          daysInclusive(svc.periodStart, svc.periodEnd) <
            daysInMonth(parseDate(svc.periodStart));

        if (isProrate && svc.periodStart && svc.periodEnd) {
          const days = daysInclusive(svc.periodStart, svc.periodEnd);
          const dim = daysInMonth(parseDate(svc.periodStart));
          const amount = Math.round(((monthly * days) / dim) * 100) / 100;
          items.push({
            description: `${plan.invoiceLabel || plan.name} (prorrateo ${days}/${dim} días)`,
            unitPrice: amount,
          });
        } else {
          allProrate = false;
          items.push({
            description: plan.invoiceLabel || plan.name,
            unitPrice: monthly,
          });
        }

        if (svc.installationFeePending && Number(plan.installationFee) > 0) {
          allProrate = false;
          items.push({
            description: `Instalación — ${plan.invoiceLabel || plan.name}`,
            unitPrice: Number(plan.installationFee),
          });
          svc.installationFeePending = false;
          svc.installationInvoiced = true;
        }

        if (
          svc.additionalDecoFeePending &&
          Number(svc.additionalDecoCount) > 0
        ) {
          const unit = Number(svc.additionalDecoUnitPrice ?? 0);
          const n = Number(svc.additionalDecoCount);
          if (unit > 0 && n > 0) {
            allProrate = false;
            items.push({
              description: `Decos adicionales (${n}) — ${plan.invoiceLabel || plan.name}`,
              unitPrice: Math.round(unit * n * 100) / 100,
            });
          }
          svc.additionalDecoFeePending = false;
        }

        if (svc.periodStart && (!minStart || svc.periodStart < minStart)) {
          minStart = svc.periodStart;
        }
        if (svc.periodEnd && (!maxEnd || svc.periodEnd > maxEnd)) {
          maxEnd = svc.periodEnd;
        }
      }

      const invoice = await this.createInvoiceInSchema(schema, {
        clientId,
        clientServiceId:
          clientServices.length === 1 ? clientServices[0].id : null,
        type: allProrate ? 'prorate' : 'service',
        items,
        periodStart: minStart,
        periodEnd: maxEnd,
      });
      createdInvoiceIds.push(invoice.id);

      // Roll each included service's period forward after invoicing.
      const companyRegime = this.regimeOf(settings);
      const cycleDay = settings.billingCycleDay ?? 1;
      for (const svc of clientServices) {
        if (svc.periodEnd) {
          const next = rollServicePeriod(
            svc.periodEnd,
            companyRegime,
            !!svc.billingProrate,
            cycleDay,
          );
          svc.periodStart = next.periodStart;
          svc.periodEnd = next.periodEnd;
          svc.nextBillingDate = next.nextBillingDate;
        }
        await services.save(svc);
      }
      created += 1;
    }

    // Enviar automáticamente las facturas recién emitidas.
    let sent = 0;
    if (settings.sendEnabled && createdInvoiceIds.length > 0) {
      for (const invoiceId of createdInvoiceIds) {
        if (await this.sendIssuedInvoice(schema, invoiceId)) sent += 1;
      }
    }

    return { created, sent };
  }

  /**
   * Marca facturas vencidas y suspende servicios activos tras el plazo de gracia.
   */
  async runOverdueCutoff(schema: string) {
    const settings = await this.ensureSettings(schema);
    const grace = settings.graceDaysAfterDue ?? 2;
    const invRepo = await this.tenantConnections.getInvoiceRepository(schema);
    const today = new Date().toISOString().slice(0, 10);
    const open = await invRepo.find({
      where: { status: In(['issued', 'sent', 'overdue']) },
    });

    let markedOverdue = 0;
    let suspendedServices = 0;
    const clientsCut = new Set<string>();

    for (const inv of open) {
      if (!inv.dueDate) continue;
      if (inv.dueDate < today && inv.status !== 'overdue') {
        inv.status = 'overdue';
        await invRepo.save(inv);
        markedOverdue += 1;
      }
      const cutoff = formatIsoDate(
        addDaysUtc(parseIsoDate(inv.dueDate), grace),
      );
      if (today <= cutoff || clientsCut.has(inv.clientId)) continue;
      const n = await this.crm.autoSuspendClientForOverdue(schema, inv.clientId);
      if (n > 0) {
        clientsCut.add(inv.clientId);
        suspendedServices += n;
      }
    }

    if (markedOverdue > 0 || suspendedServices > 0) {
      this.logger.log(
        `Corte mora ${schema}: ${markedOverdue} vencidas, ${suspendedServices} servicios suspendidos`,
      );
    }
    return { markedOverdue, suspendedServices };
  }

  /** Envía facturas emitidas por correo y, si corresponde, WhatsApp. */
  async runSendInvoices(schema: string) {
    const repo = await this.tenantConnections.getInvoiceRepository(schema);
    const pending = await repo.find({
      where: { status: 'issued' },
      relations: { items: true },
    });
    let sent = 0;
    let failed = 0;
    for (const inv of pending) {
      if (await this.sendIssuedInvoice(schema, inv.id)) sent += 1;
      else failed += 1;
    }
    if (sent > 0 || failed > 0) {
      this.logger.log(
        `Envío facturas en ${schema}: ${sent} ok, ${failed} fallidas`,
      );
    }
    return { sent, failed };
  }

  /**
   * Envía una factura `issued` por correo con PDF; WhatsApp es best-effort.
   * Devuelve true si se envió; false si se omitió o falló (registra warning).
   */
  private async sendIssuedInvoice(
    schema: string,
    invoiceId: string,
  ): Promise<boolean> {
    const repo = await this.tenantConnections.getInvoiceRepository(schema);
    try {
      const built = await this.buildInvoiceEmail(schema, invoiceId);
      if (!built.clientEmail) {
        this.logger.warn(
          `Factura ${built.invoice.number}: cliente sin email, se omite`,
        );
        return false;
      }
      const pdf = await this.renderInvoicePdf(built);
      await this.mailer.sendMail(schema, {
        to: built.clientEmail,
        subject: built.subject,
        title: built.subject,
        html: built.bodyHtml,
        attachments: [
          {
            filename: this.invoicePdfFileName(built.invoice.number),
            content: pdf,
            contentType: 'application/pdf',
          },
        ],
      });
      const whatsapp = await this.trySendInvoiceWhatsApp(schema, built, pdf);
      if (whatsapp.status === 'failed') {
        this.logger.warn(
          `Factura ${built.invoice.number}: correo enviado, WhatsApp falló: ${whatsapp.error}`,
        );
      } else if (
        whatsapp.status === 'skipped' &&
        whatsapp.reason !== 'module_disabled'
      ) {
        this.logger.warn(
          `Factura ${built.invoice.number}: WhatsApp omitido (${whatsapp.reason})`,
        );
      }
      built.invoice.status = 'sent';
      built.invoice.sentAt = new Date();
      await repo.save(built.invoice);
      return true;
    } catch (err) {
      this.logger.warn(
        `No se envió factura ${invoiceId}: ${(err as Error).message}`,
      );
      return false;
    }
  }

  private async buildInvoiceEmail(schema: string, invoiceId: string) {
    const invRepo = await this.tenantConnections.getInvoiceRepository(schema);
    const invoice = await invRepo.findOne({
      where: { id: invoiceId },
      relations: { items: true },
    });
    if (!invoice) throw new NotFoundException('Factura no encontrada');

    const clients = await this.tenantConnections.getClientRepository(schema);
    const client = await clients.findOne({ where: { id: invoice.clientId } });
    if (!client)
      throw new NotFoundException('Cliente de la factura no encontrado');

    let serviceName = '';
    if (invoice.clientServiceId) {
      const services =
        await this.tenantConnections.getClientServiceRepository(schema);
      const svc = await services.findOne({
        where: { id: invoice.clientServiceId },
      });
      serviceName = svc?.name ?? '';
    }

    const templates =
      await this.tenantConnections.getInvoiceTemplateRepository(schema);
    await this.ensureDefaultTemplates(schema);
    let template = await templates.findOne({
      where: { type: invoice.type, isDefault: true, isActive: true },
    });
    if (!template) {
      template = await templates.findOne({
        where: { type: invoice.type, isActive: true },
      });
    }
    if (!template) {
      throw new BadRequestException(
        `No hay plantilla activa para facturas de tipo ${invoice.type}`,
      );
    }

    const tenant = await this.tenants.findOne({
      where: { schemaName: schema },
    });
    if (!tenant) throw new NotFoundException('Empresa no encontrada');

    const clientName =
      [client.firstName, client.lastName].filter(Boolean).join(' ').trim() ||
      client.companyName ||
      'Cliente';
    const vars = this.invoiceTemplateVars({
      invoice,
      clientName,
      clientEmail: client.email ?? '',
      clientPhone: client.phone ?? '',
      clientAddress: [client.street, client.city].filter(Boolean).join(', '),
      serviceName,
      tenant,
    });
    return {
      invoice,
      clientEmail: (client.email ?? '').trim().toLowerCase(),
      clientPhone: (client.phone ?? '').trim(),
      clientAddress: [client.street, client.city].filter(Boolean).join(', '),
      clientName,
      tenant,
      subject: renderPlaceholders(template.subject, vars),
      bodyHtml: renderPlaceholders(template.bodyHtml, vars),
    };
  }

  private renderInvoicePdf(
    built: Awaited<ReturnType<BillingService['buildInvoiceEmail']>>,
  ) {
    return this.invoicePdf.render({
      invoice: built.invoice,
      tenant: built.tenant,
      clientName: built.clientName,
      clientEmail: built.clientEmail,
      clientPhone: built.clientPhone,
      clientAddress: built.clientAddress,
    });
  }

  private invoicePdfFileName(invoiceNumber: string) {
    const safe = invoiceNumber.replace(/[^a-zA-Z0-9_-]/g, '_');
    return `factura-${safe}.pdf`;
  }

  private async trySendInvoiceWhatsApp(
    schema: string,
    built: Awaited<ReturnType<BillingService['buildInvoiceEmail']>>,
    pdf: Buffer,
  ) {
    try {
      return await this.whatsapp.sendInvoiceDocument({
        schemaName: schema,
        phone: built.clientPhone,
        invoiceNumber: built.invoice.number,
        clientName: built.clientName,
        companyName: built.tenant.name,
        pdf,
      });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Factura ${built.invoice.number}: WhatsApp falló sin afectar correo: ${error}`,
      );
      return {
        status: 'failed' as const,
        provider: 'baileys' as const,
        error,
      };
    }
  }

  private invoiceTemplateVars(input: {
    invoice: Invoice;
    clientName: string;
    clientEmail: string;
    clientPhone: string;
    clientAddress: string;
    serviceName: string;
    tenant: Tenant;
  }) {
    const { invoice, tenant } = input;
    const currency = invoice.currency || tenant.currency || 'USD';
    const money = (v: string | number) => formatMoneyAmount(v, currency);
    const items = (invoice.items ?? [])
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder);
    const itemsTable = items
      .map(
        (it) => `<tr>
      <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;color:#374151;">${escapeHtml(it.description)}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;text-align:right;color:#6b7280;">${escapeHtml(it.quantity)}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;text-align:right;color:#6b7280;">${money(it.unitPrice)}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;text-align:right;color:#111827;">${money(it.amount)}</td>
    </tr>`,
      )
      .join('\n');

    const logo = tenant.logoUrl
      ? `<img src="${escapeAttr(tenant.logoUrl)}" alt="logo" style="max-height:56px;max-width:180px;margin-bottom:10px;object-fit:contain;" />`
      : '';
    const footer = tenant.invoiceFooter?.trim()
      ? `<div style="margin-top:24px;padding-top:16px;border-top:1px solid #e5e7eb;color:#9ca3af;font-size:11px;line-height:1.5;">${escapeHtml(tenant.invoiceFooter).replace(/\n/g, '<br/>')}</div>`
      : '';

    return {
      'invoice.number': invoice.number,
      'invoice.type': invoice.type,
      'invoice.docLabel': tenant.invoiceDocLabel || 'Factura',
      'invoice.status': invoice.status,
      'invoice.total': money(invoice.total),
      'invoice.subtotal': money(invoice.subtotal),
      'invoice.tax': money(invoice.tax),
      'invoice.currency': currency,
      'invoice.periodStart': invoice.periodStart ?? '',
      'invoice.periodEnd': invoice.periodEnd ?? '',
      'invoice.issueDate': invoice.issueDate,
      'invoice.dueDate': invoice.dueDate ?? '',
      'invoice.notes': invoice.notes ?? '',
      'invoice.itemsTable': itemsTable,
      'client.name': input.clientName,
      'client.email': input.clientEmail,
      'client.phone': input.clientPhone,
      'client.address': input.clientAddress,
      'service.name': input.serviceName,
      'company.name': tenant.name,
      'company.legalName': tenant.legalName || tenant.name,
      'company.phone': tenant.phone ?? '',
      'company.email': tenant.email ?? '',
      'company.address': tenant.address ?? '',
      'company.city': tenant.city ?? '',
      'company.country': tenant.country ?? '',
      'company.taxId': tenant.taxId ?? '',
      'company.legalRepresentative': tenant.legalRepresentative ?? '',
      'company.logo': logo,
      'company.footer': footer,
    };
  }

  private serializeInvoice(inv: Invoice) {
    return {
      id: inv.id,
      number: inv.number,
      clientId: inv.clientId,
      clientServiceId: inv.clientServiceId,
      type: inv.type,
      status: inv.status,
      currency: inv.currency,
      subtotal: inv.subtotal,
      tax: inv.tax,
      total: inv.total,
      periodStart: inv.periodStart,
      periodEnd: inv.periodEnd,
      issueDate: inv.issueDate,
      dueDate: inv.dueDate,
      sentAt: inv.sentAt,
      notes: inv.notes,
      items: (inv.items ?? [])
        .slice()
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((it) => ({
          id: it.id,
          description: it.description,
          quantity: it.quantity,
          unitPrice: it.unitPrice,
          amount: it.amount,
          sortOrder: it.sortOrder,
        })),
      createdAt: inv.createdAt,
      updatedAt: inv.updatedAt,
    };
  }
}

function parseDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function accountingClientName(c: {
  firstName: string;
  lastName: string;
  companyName: string;
  isCompany: boolean;
}): string {
  if (c.isCompany && c.companyName?.trim()) return c.companyName.trim();
  const person = [c.firstName, c.lastName].filter(Boolean).join(' ').trim();
  if (person && c.companyName?.trim()) {
    return `${person} (${c.companyName.trim()})`;
  }
  return person || c.companyName?.trim() || 'Cliente';
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d.getTime());
  x.setUTCDate(x.getUTCDate() + n);
  return x;
}

function addMonthsClamp(d: Date, months: number): Date {
  const x = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
  const day = x.getUTCDate();
  x.setUTCDate(1);
  x.setUTCMonth(x.getUTCMonth() + months);
  const dim = daysInMonth(x);
  x.setUTCDate(Math.min(day, dim));
  return x;
}

function endOfMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
}

function daysInMonth(d: Date): number {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0),
  ).getUTCDate();
}

function daysInRange(startIso: string, endIso: string): number {
  const a = parseDate(startIso).getTime();
  const b = parseDate(endIso).getTime();
  return Math.floor((b - a) / 86_400_000) + 1;
}

function renderPlaceholders(
  source: string,
  vars: Record<string, string>,
): string {
  return source.replace(
    /\{\{\s*([\w.]+)\s*\}\}/g,
    (_, key: string) => vars[key] ?? '',
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function formatMoneyAmount(value: string | number, currency: string): string {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return String(value);
  try {
    return new Intl.NumberFormat('es-CL', {
      style: 'currency',
      currency: currency || 'USD',
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return `${n.toFixed(2)} ${currency}`;
  }
}
