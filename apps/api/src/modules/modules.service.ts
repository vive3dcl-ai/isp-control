import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import type { AuthUser } from '../auth/auth.types';
import { Tenant } from '../tenants/entities/tenant.entity';
import { TenantConnectionService } from '../database/tenant-connection.service';
import {
  EMPTY_ASISTENTE_IA_CONFIG,
  EMPTY_MERCADOPAGO_CONFIG,
  EMPTY_SMTP_CONFIG,
  EMPTY_WHATSAPP_CONFIG,
  baileysNeedsAttention,
  formatMercadoPagoCountries,
  getModuleDefinition,
  isAsistenteIaConfigured,
  isMercadoPagoCheckoutProCountry,
  isMercadoPagoConfigured,
  isSmtpConfigured,
  isWhatsAppConfigured,
  MERCADOPAGO_CHECKOUT_PRO_COUNTRY_LABELS,
  MERCADOPAGO_DEVELOPERS_URL,
  MODULE_CATALOG,
  normalizeEnabledModules,
  WHATSAPP_BAILEYS_MAX_SLOTS,
  type AsistenteIaModuleConfig,
  type MercadoPagoModuleConfig,
  type ModuleId,
  type SmtpModuleConfig,
  type WhatsAppModuleConfig,
  type WhatsAppBaileysStatus,
} from './module-catalog';
import {
  assertKnownModules,
  UpdateAsistenteIaConfigDto,
  UpdateMercadoPagoConfigDto,
  UpdateModulePricingDto,
  UpdateSmtpConfigDto,
  UpdateTenantModulesDto,
  UpdateWhatsAppConfigDto,
  WhatsAppBaileysStatusDto,
} from './dto/modules.dto';
import { PlatformModulePricing } from './entities/platform-module-pricing.entity';
import { FxService } from './fx.service';
import { PlatformSubscriptionService } from '../platform/platform-subscription.service';
import { PlatformBrandingService } from '../platform/platform-branding.service';
import { escapeHtml } from '../platform/platform-email-layout';
import { WhatsAppBaileysClient } from './whatsapp-baileys.client';
import { TenantMailerService } from './tenant-mailer.service';
import { PlatformAiQuotaService } from '../ai/platform-ai-quota.service';
import { PlatformAiSettingsService } from '../ai/platform-ai-settings.service';
import { PlatformAiCapabilitiesService } from '../ai/platform-ai-capabilities.service';
import { AiProviderRouter } from '../ai/ai-provider.router';
import { AI_VENDORS, isAiVendorId } from '../ai/ai-providers';
import { listAiModels } from '../ai/adapters/list-models';
import { PlatformAiRestorePointsService } from '../ai/platform-ai-restore-points.service';
import { PlatformAiChatSessionsService } from '../ai/platform-ai-chat-sessions.service';
import type { AsistenteChatDto } from './dto/modules.dto';

@Injectable()
export class ModulesService {
  private readonly logger = new Logger(ModulesService.name);
  private aiInternalColumnEnsured = false;

  constructor(
    @InjectRepository(Tenant)
    private readonly tenants: Repository<Tenant>,
    @InjectRepository(PlatformModulePricing)
    private readonly pricing: Repository<PlatformModulePricing>,
    private readonly tenantConnections: TenantConnectionService,
    private readonly fx: FxService,
    @Inject(forwardRef(() => PlatformSubscriptionService))
    private readonly subscriptions: PlatformSubscriptionService,
    private readonly baileys: WhatsAppBaileysClient,
    private readonly tenantMailer: TenantMailerService,
    private readonly branding: PlatformBrandingService,
    private readonly aiRouter: AiProviderRouter,
    private readonly aiQuota: PlatformAiQuotaService,
    private readonly platformAi: PlatformAiSettingsService,
    private readonly aiCapabilities: PlatformAiCapabilitiesService,
    private readonly aiRestorePoints: PlatformAiRestorePointsService,
    private readonly aiChatSessions: PlatformAiChatSessionsService,
    private readonly dataSource: DataSource,
  ) {}

  async listCatalog() {
    const catalog = await this.catalogWithPricingAndFx();
    const slots = await this.getBaileysSlots();
    return catalog.map((m) =>
      m.id === 'whatsapp'
        ? {
            ...m,
            baileysSlotsUsed: slots.used,
            baileysSlotsMax: slots.max,
          }
        : m,
    );
  }

  async listForTenantAdmin(tenantId: string) {
    const tenant = await this.requireTenant(tenantId);
    const enabled = new Set(normalizeEnabledModules(tenant.enabledModules));
    const catalog = await this.catalogWithPricingAndFx();
    const country = (tenant.country || '').toUpperCase();
    const modules = catalog.map((m) => {
      const available =
        !m.availableCountries || m.availableCountries.includes(country);
      return {
        ...m,
        enabled: enabled.has(m.id),
        available,
        tenantCountry: country || null,
        unavailableReason: available
          ? null
          : m.id === 'mercadopago'
            ? `Mercado Pago Checkout Pro solo está disponible para: ${formatMercadoPagoCountries()}. Cambia el país de la empresa.`
            : 'No disponible para el país de esta empresa.',
      };
    });
    return {
      modules,
      aiInternalEnabled: tenant.aiInternalEnabled !== false,
    };
  }

  async updateModulePricing(moduleId: string, dto: UpdateModulePricingDto) {
    const def = getModuleDefinition(moduleId);
    if (!def) throw new NotFoundException(`Módulo desconocido: ${moduleId}`);
    if (!def.billable) {
      throw new BadRequestException('Solo los módulos de pago tienen precio');
    }
    // Add-ons de plataforma se cobran en USD; la conversión a CLP es referencia.
    const currency =
      def.priceCurrency === 'USD' || moduleId === 'mercadopago'
        ? 'USD'
        : dto.priceCurrency.trim().toUpperCase();
    if (currency.length !== 3) {
      throw new BadRequestException('Moneda inválida (ISO 4217)');
    }
    let row = await this.pricing.findOne({ where: { moduleId } });
    if (!row) {
      row = this.pricing.create({ moduleId });
    }
    row.priceMonthly = dto.priceMonthly.toFixed(2);
    row.priceCurrency = currency;
    await this.pricing.save(row);
    const catalog = await this.catalogWithPricingAndFx();
    return catalog.find((m) => m.id === moduleId)!;
  }

  async updateTenantModules(tenantId: string, dto: UpdateTenantModulesDto) {
    const unknown = assertKnownModules(dto.enabledModules);
    if (unknown) {
      throw new BadRequestException(`Módulo desconocido: ${unknown}`);
    }
    const tenant = await this.requireTenant(tenantId);
    const country = (tenant.country || '').toUpperCase();
    const requested = normalizeEnabledModules(dto.enabledModules);
    for (const id of requested) {
      const def = getModuleDefinition(id);
      if (
        def?.availableCountries &&
        !def.availableCountries.includes(country)
      ) {
        throw new BadRequestException(
          id === 'mercadopago'
            ? `Mercado Pago Checkout Pro solo se puede activar si el país de la empresa es uno de: ${formatMercadoPagoCountries()}.`
            : `El módulo ${id} no está disponible para este país.`,
        );
      }
    }
    tenant.enabledModules = requested;
    if (dto.aiInternalEnabled != null) {
      tenant.aiInternalEnabled = dto.aiInternalEnabled;
    }
    await this.tenants.save(tenant);
    return this.listForTenantAdmin(tenantId);
  }

  private async catalogWithPricingAndFx() {
    const rows = await this.pricing.find();
    const byId = new Map(rows.map((r) => [r.moduleId, r]));
    let fx: Awaited<ReturnType<FxService['getUsdClp']>> | null = null;
    try {
      fx = await this.fx.getUsdClp();
    } catch {
      fx = null;
    }

    return MODULE_CATALOG.map((m) => {
      const override = byId.get(m.id);
      if (!m.billable) {
        return {
          ...m,
          priceMonthly: null as number | null,
          priceCurrency: null as string | null,
          priceClp: null as number | null,
          fxRate: null as number | null,
          fxRateDate: null as string | null,
          fxStale: false,
        };
      }
      const priceMonthly =
        override?.priceMonthly != null
          ? Number(override.priceMonthly)
          : m.priceMonthly;
      const priceCurrency =
        m.priceCurrency === 'USD' || m.id === 'mercadopago'
          ? 'USD'
          : override?.priceCurrency != null
            ? override.priceCurrency
            : m.priceCurrency;

      let priceClp: number | null = null;
      if (
        priceCurrency === 'USD' &&
        priceMonthly != null &&
        fx &&
        Number.isFinite(fx.rate)
      ) {
        priceClp = Math.round(priceMonthly * fx.rate);
      }

      return {
        ...m,
        priceMonthly,
        priceCurrency,
        priceClp,
        fxRate: fx?.rate ?? null,
        fxRateDate: fx?.rateDate ?? null,
        fxStale: fx?.stale ?? false,
      };
    });
  }

  /** Catálogo completo para el tenant (contratados y no). */
  async listForTenantApp(user: AuthUser) {
    const tenant = await this.requireTenantFromUser(user);
    const catalog = await this.catalogWithPricingAndFx();
    const base = await this.subscriptions.catalogForTenantApp(tenant.id);
    const configs = await this.tenantConnections.getModuleConfigRepository(
      tenant.schemaName,
    );

    return Promise.all(
      base.map(async (m) => {
        const def = catalog.find((c) => c.id === m.id)!;
        const row = await configs.findOne({ where: { moduleId: m.id } });
        let configured = false;
        if (m.id === 'smtp') {
          configured = isSmtpConfigured(row?.config ?? {});
        } else if (m.id === 'mercadopago') {
          configured = isMercadoPagoConfigured(row?.config ?? {});
        } else if (m.id === 'whatsapp') {
          configured = isWhatsAppConfigured(row?.config ?? {});
        } else if (m.id === 'asistente_ia') {
          configured = isAsistenteIaConfigured(row?.config ?? {});
        } else if (row?.config && Object.keys(row.config).length > 0) {
          configured = true;
        }
        const waCfg =
          m.id === 'whatsapp'
            ? {
                ...EMPTY_WHATSAPP_CONFIG,
                ...((row?.config ?? {}) as Partial<WhatsAppModuleConfig>),
              }
            : null;
        const needsAttention = baileysNeedsAttention(waCfg);
        return {
          ...m,
          priceMonthly: def.priceMonthly,
          priceCurrency: def.priceCurrency,
          priceClp: def.priceClp,
          fxRate: def.fxRate,
          fxRateDate: def.fxRateDate,
          configured,
          needsAttention: m.id === 'whatsapp' ? needsAttention : undefined,
        };
      }),
    );
  }

  async getSmtpConfig(user: AuthUser) {
    await this.assertModuleEnabled(user, 'smtp');
    const tenant = await this.requireTenantFromUser(user);
    const repo = await this.tenantConnections.getModuleConfigRepository(
      tenant.schemaName,
    );
    const row = await repo.findOne({ where: { moduleId: 'smtp' } });
    const cfg = {
      ...EMPTY_SMTP_CONFIG,
      ...((row?.config ?? {}) as Partial<SmtpModuleConfig>),
    };
    const hasPassword = !!cfg.password;
    return {
      host: cfg.host,
      port: cfg.port,
      secure: cfg.secure,
      username: cfg.username,
      fromEmail: cfg.fromEmail,
      fromName: cfg.fromName,
      hasPassword,
      /** Nunca devolver el secreto al cliente. */
      password: '',
    };
  }

  async updateSmtpConfig(user: AuthUser, dto: UpdateSmtpConfigDto) {
    await this.assertModuleEnabled(user, 'smtp');
    const tenant = await this.requireTenantFromUser(user);
    const repo = await this.tenantConnections.getModuleConfigRepository(
      tenant.schemaName,
    );
    let row = await repo.findOne({ where: { moduleId: 'smtp' } });
    const prev = {
      ...EMPTY_SMTP_CONFIG,
      ...((row?.config ?? {}) as Partial<SmtpModuleConfig>),
    };
    const next: SmtpModuleConfig = {
      host: dto.host.trim(),
      port: dto.port,
      secure: dto.secure,
      username: (dto.username ?? '').trim(),
      password:
        dto.password != null && dto.password !== ''
          ? dto.password
          : prev.password,
      fromEmail: dto.fromEmail.trim().toLowerCase(),
      fromName: (dto.fromName ?? '').trim(),
    };
    if (!row) {
      row = repo.create({ moduleId: 'smtp', config: next });
    } else {
      row.config = next;
    }
    await repo.save(row);
    return this.getSmtpConfig(user);
  }

  async testSmtpConfig(user: AuthUser, to: string) {
    await this.assertModuleEnabled(user, 'smtp');
    const tenant = await this.requireTenantFromUser(user);
    const branding = await this.branding.getPublic();
    return this.tenantMailer.sendTest(
      tenant.schemaName,
      to,
      branding.productName || 'ISP Control',
    );
  }

  async getMercadoPagoConfig(user: AuthUser) {
    await this.assertModuleEnabled(user, 'mercadopago');
    const tenant = await this.requireTenantFromUser(user);
    const repo = await this.tenantConnections.getModuleConfigRepository(
      tenant.schemaName,
    );
    const row = await repo.findOne({ where: { moduleId: 'mercadopago' } });
    const cfg = {
      ...EMPTY_MERCADOPAGO_CONFIG,
      ...((row?.config ?? {}) as Partial<MercadoPagoModuleConfig>),
    };
    const country = (tenant.country || '').toUpperCase();
    const countryOk = isMercadoPagoCheckoutProCountry(country);
    return {
      environment: cfg.environment,
      integration: 'checkout_pro' as const,
      publicKey: cfg.publicKey,
      hasAccessToken: !!cfg.accessToken,
      hasWebhookSecret: !!cfg.webhookSecret,
      accessToken: '',
      webhookSecret: '',
      country: country || null,
      countryLabel: countryOk
        ? MERCADOPAGO_CHECKOUT_PRO_COUNTRY_LABELS[country]
        : null,
      developersUrl: countryOk ? MERCADOPAGO_DEVELOPERS_URL[country] : null,
    };
  }

  async updateMercadoPagoConfig(
    user: AuthUser,
    dto: UpdateMercadoPagoConfigDto,
  ) {
    await this.assertModuleEnabled(user, 'mercadopago');
    const tenant = await this.requireTenantFromUser(user);
    const repo = await this.tenantConnections.getModuleConfigRepository(
      tenant.schemaName,
    );
    let row = await repo.findOne({ where: { moduleId: 'mercadopago' } });
    const prev = {
      ...EMPTY_MERCADOPAGO_CONFIG,
      ...((row?.config ?? {}) as Partial<MercadoPagoModuleConfig>),
    };
    const next: MercadoPagoModuleConfig = {
      environment: dto.environment,
      integration: 'checkout_pro',
      publicKey: dto.publicKey.trim(),
      accessToken:
        dto.accessToken != null && dto.accessToken !== ''
          ? dto.accessToken
          : prev.accessToken,
      webhookSecret:
        dto.webhookSecret !== undefined
          ? dto.webhookSecret.trim()
          : prev.webhookSecret,
    };
    if (!row) {
      row = repo.create({ moduleId: 'mercadopago', config: next });
    } else {
      row.config = next;
    }
    await repo.save(row);
    return this.getMercadoPagoConfig(user);
  }

  async getWhatsAppConfig(user: AuthUser) {
    await this.assertModuleEnabled(user, 'whatsapp');
    const tenant = await this.requireTenantFromUser(user);
    const cfg = await this.readWhatsAppConfig(tenant.schemaName);
    const slots = await this.getBaileysSlots();
    const needsAttention = baileysNeedsAttention(cfg);
    return {
      provider: cfg.provider,
      phoneNumberId: cfg.phoneNumberId,
      businessAccountId: cfg.businessAccountId,
      webhookVerifyToken: cfg.webhookVerifyToken,
      templateName: cfg.templateName,
      templateLanguage: cfg.templateLanguage,
      hasAccessToken: !!cfg.accessToken,
      accessToken: '',
      baileysStatus: cfg.baileysStatus,
      lastDisconnectAt: cfg.lastDisconnectAt,
      lastDisconnectReason: cfg.lastDisconnectReason,
      needsAttention,
      baileysSlots: slots,
      qrDataUrl: null as string | null,
    };
  }

  async updateWhatsAppConfig(user: AuthUser, dto: UpdateWhatsAppConfigDto) {
    await this.assertModuleEnabled(user, 'whatsapp');
    const tenant = await this.requireTenantFromUser(user);
    const repo = await this.tenantConnections.getModuleConfigRepository(
      tenant.schemaName,
    );
    let row = await repo.findOne({ where: { moduleId: 'whatsapp' } });
    const prev = {
      ...EMPTY_WHATSAPP_CONFIG,
      ...((row?.config ?? {}) as Partial<WhatsAppModuleConfig>),
    };

    if (dto.provider === 'baileys' && prev.provider !== 'baileys') {
      await this.assertBaileysSlotAvailable(tenant.id);
    }

    if (dto.provider === 'cloud_api' && prev.provider === 'baileys') {
      try {
        await this.baileys.logout(tenant.id);
      } catch (err) {
        this.logger.warn(
          `Logout Baileys al cambiar a Cloud API: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    const next: WhatsAppModuleConfig = {
      ...prev,
      provider: dto.provider,
      phoneNumberId: (dto.phoneNumberId ?? prev.phoneNumberId).trim(),
      businessAccountId: (
        dto.businessAccountId ?? prev.businessAccountId
      ).trim(),
      accessToken:
        dto.accessToken != null && dto.accessToken !== ''
          ? dto.accessToken
          : prev.accessToken,
      webhookVerifyToken: (
        dto.webhookVerifyToken ?? prev.webhookVerifyToken
      ).trim(),
      templateName: (dto.templateName ?? prev.templateName).trim(),
      templateLanguage: (dto.templateLanguage ?? prev.templateLanguage).trim(),
      baileysStatus:
        dto.provider === 'cloud_api' ? 'disconnected' : prev.baileysStatus,
      lastDisconnectAt:
        dto.provider === 'cloud_api' ? null : prev.lastDisconnectAt,
      lastDisconnectReason:
        dto.provider === 'cloud_api' ? null : prev.lastDisconnectReason,
    };

    if (!row) {
      row = repo.create({ moduleId: 'whatsapp', config: next });
    } else {
      row.config = next;
    }
    await repo.save(row);
    return this.getWhatsAppConfig(user);
  }

  async getAsistenteIaConfig(user: AuthUser) {
    await this.assertModuleEnabled(user, 'asistente_ia');
    const tenant = await this.requireTenantFromUser(user);
    const repo = await this.tenantConnections.getModuleConfigRepository(
      tenant.schemaName,
    );
    const row = await repo.findOne({ where: { moduleId: 'asistente_ia' } });
    const cfg = {
      ...EMPTY_ASISTENTE_IA_CONFIG,
      ...((row?.config ?? {}) as Partial<AsistenteIaModuleConfig>),
    };
    const internalAllowed = tenant.aiInternalEnabled !== false;
    const platform = await this.platformAi.getPublic();
    const quota =
      cfg.mode === 'internal'
        ? await this.aiQuota.getSnapshot(tenant.id)
        : null;
    return {
      mode: cfg.mode,
      provider: cfg.provider,
      model: cfg.model,
      enabled: cfg.enabled,
      hasApiKey: !!cfg.apiKey?.trim(),
      apiKey: '',
      internalAllowed,
      vendors: AI_VENDORS.map((v) => ({
        id: v.id,
        label: v.label,
        models: v.models,
        defaultModel: v.defaultModel,
      })),
      quota: quota
        ? {
            requestsUsed: quota.requestsUsed,
            requestsLimit: quota.requestsLimit,
            tokensUsed: quota.tokensUsed,
            tokensLimit: quota.tokensLimit,
            platformEnabled: platform.enabled,
            platformProvider: platform.provider,
            platformModel: platform.model,
          }
        : undefined,
    };
  }

  async updateAsistenteIaConfig(
    user: AuthUser,
    dto: UpdateAsistenteIaConfigDto,
  ) {
    await this.assertModuleEnabled(user, 'asistente_ia');
    const tenant = await this.requireTenantFromUser(user);
    if (dto.mode === 'internal' && tenant.aiInternalEnabled === false) {
      throw new ForbiddenException(
        'El proveedor interno no está habilitado para esta empresa. Usa API propia o contacta a soporte.',
      );
    }
    const repo = await this.tenantConnections.getModuleConfigRepository(
      tenant.schemaName,
    );
    let row = await repo.findOne({ where: { moduleId: 'asistente_ia' } });
    const prev = {
      ...EMPTY_ASISTENTE_IA_CONFIG,
      ...((row?.config ?? {}) as Partial<AsistenteIaModuleConfig>),
    };
    const next: AsistenteIaModuleConfig = {
      mode: dto.mode,
      provider: dto.provider ?? prev.provider,
      model: (dto.model ?? prev.model).trim(),
      apiKey:
        dto.apiKey != null && dto.apiKey !== ''
          ? dto.apiKey.trim()
          : prev.apiKey,
      enabled: dto.enabled ?? prev.enabled,
    };
    if (!row) {
      row = repo.create({ moduleId: 'asistente_ia', config: next });
    } else {
      row.config = next;
    }
    await repo.save(row);
    return this.getAsistenteIaConfig(user);
  }

  async testAsistenteIa(user: AuthUser) {
    await this.assertModuleEnabled(user, 'asistente_ia');
    return this.aiRouter.testConnection(user);
  }

  async chatAsistenteIa(
    user: AuthUser,
    dto: AsistenteChatDto,
    onEvent?: (event: import('../ai/ai-tool.types').AiChatStreamEvent) => void,
  ) {
    await this.assertModuleEnabled(user, 'asistente_ia');
    const dialogue = (dto.messages ?? [])
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }));
    const result = await this.aiRouter.chat(user, dialogue, {
      readOnly: dto.readOnly === true,
      restorePoints: dto.restorePoints === true,
      thinking: dto.thinking === true,
      sessionId: dto.sessionId?.trim() || undefined,
      contextSummary: dto.contextSummary?.trim() || undefined,
      onEvent,
    });

    const sessionId = dto.sessionId?.trim();
    if (sessionId && Array.isArray(dto.messages) && dto.messages.length > 0) {
      try {
        const tenant = await this.requireTenantFromUser(user);
        const reply =
          result && typeof result === 'object' && 'reply' in result
            ? String((result as { reply?: string }).reply ?? '')
            : '';
        const turnActivities =
          result &&
          typeof result === 'object' &&
          Array.isArray((result as { activities?: unknown }).activities)
            ? (
                result as {
                  activities: Array<Record<string, unknown>>;
                }
              ).activities.filter(
                (a) =>
                  a &&
                  typeof a === 'object' &&
                  typeof a.slug === 'string' &&
                  !String(a.slug).startsWith('_'),
              )
            : [];
        const contextSummary =
          result &&
          typeof result === 'object' &&
          typeof (result as { contextSummary?: unknown }).contextSummary ===
            'string'
            ? String((result as { contextSummary: string }).contextSummary)
            : (dto.contextSummary ?? '');
        const keptFromEnd =
          result &&
          typeof result === 'object' &&
          typeof (result as { keptFromEnd?: unknown }).keptFromEnd === 'number'
            ? (result as { keptFromEnd: number }).keptFromEnd
            : null;
        const contextCompacted =
          result &&
          typeof result === 'object' &&
          (result as { contextCompacted?: boolean }).contextCompacted === true;

        type SavedMsg = {
          role: 'user' | 'assistant' | 'system';
          content: string;
          id?: string;
          activities?: Array<Record<string, unknown>>;
        };

        let baseMessages: SavedMsg[] = dto.messages.map((m) => ({
          role: m.role,
          content: m.content,
          ...(m.id ? { id: m.id } : {}),
          ...(Array.isArray(m.activities) && m.activities.length
            ? { activities: m.activities as Array<Record<string, unknown>> }
            : {}),
        }));

        if (contextCompacted && keptFromEnd != null && keptFromEnd > 0) {
          const dialogueOnly = baseMessages.filter(
            (m) => m.role === 'user' || m.role === 'assistant',
          );
          const kept = dialogueOnly.slice(-keptFromEnd);
          baseMessages = [
            ...(contextSummary
              ? ([
                  {
                    role: 'system' as const,
                    content: contextSummary,
                    id: `ctx-${Date.now()}`,
                  },
                ] satisfies SavedMsg[])
              : []),
            ...kept,
          ];
        }

        const messages: SavedMsg[] = [
          ...baseMessages,
          ...(reply
            ? [
                {
                  role: 'assistant' as const,
                  content: reply,
                  ...(turnActivities.length
                    ? { activities: turnActivities }
                    : {}),
                },
              ]
            : []),
        ];
        await this.aiChatSessions.upsert({
          tenantId: tenant.id,
          userId: user.sub ?? null,
          sessionId,
          messages,
          contextSummary,
        });
      } catch (err) {
        this.logger.warn(
          `No se pudo guardar sesión de chat: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    return result;
  }

  /** Tools/skills activos globales para el agente del tenant. */
  async listAsistenteIaCapabilities(user: AuthUser) {
    await this.assertModuleEnabled(user, 'asistente_ia');
    return this.aiCapabilities.listActiveForAgent();
  }

  async listAsistenteIaRestorePoints(
    user: AuthUser,
    opts?: { sessionId?: string },
  ) {
    await this.assertModuleEnabled(user, 'asistente_ia');
    const tenant = await this.requireTenantFromUser(user);
    return this.aiRestorePoints.listForTenant(tenant.id, {
      sessionId: opts?.sessionId?.trim() || undefined,
      limit: 50,
    });
  }

  async restoreAsistenteIaPoint(user: AuthUser, id: string) {
    await this.assertModuleEnabled(user, 'asistente_ia');
    const tenant = await this.requireTenantFromUser(user);
    return this.aiRestorePoints.restore(tenant.id, id);
  }

  async listAsistenteIaSessions(user: AuthUser) {
    await this.assertModuleEnabled(user, 'asistente_ia');
    const tenant = await this.requireTenantFromUser(user);
    return this.aiChatSessions.listForUser(
      tenant.id,
      user.sub ?? null,
    );
  }

  async getAsistenteIaSession(user: AuthUser, sessionId: string) {
    await this.assertModuleEnabled(user, 'asistente_ia');
    const tenant = await this.requireTenantFromUser(user);
    return this.aiChatSessions.get(
      tenant.id,
      sessionId,
      user.sub ?? null,
    );
  }

  async deleteAsistenteIaSession(user: AuthUser, sessionId: string) {
    await this.assertModuleEnabled(user, 'asistente_ia');
    const tenant = await this.requireTenantFromUser(user);
    return this.aiChatSessions.remove(
      tenant.id,
      sessionId,
      user.sub ?? null,
    );
  }

  async listAsistenteIaModels(
    user: AuthUser,
    dto: { provider: string; apiKey?: string },
  ) {
    await this.assertModuleEnabled(user, 'asistente_ia');
    if (!isAiVendorId(dto.provider)) {
      throw new BadRequestException(`Proveedor inválido: ${dto.provider}`);
    }
    const tenant = await this.requireTenantFromUser(user);
    const cfg = await this.aiRouter.readTenantConfig(tenant.schemaName);
    const apiKey = dto.apiKey?.trim() || cfg.apiKey;
    if (!apiKey?.trim()) {
      throw new BadRequestException(
        'Indica una API key (o guárdala primero) para listar modelos',
      );
    }
    return listAiModels(dto.provider, apiKey);
  }

  async startBaileysSession(user: AuthUser) {
    await this.assertModuleEnabled(user, 'whatsapp');
    const tenant = await this.requireTenantFromUser(user);
    const cfg = await this.readWhatsAppConfig(tenant.schemaName);
    if (cfg.provider !== 'baileys') {
      throw new BadRequestException(
        'Cambia el proveedor a Baileys antes de escanear el QR',
      );
    }
    await this.assertBaileysSlotAvailable(tenant.id);
    const session = await this.baileys.start(tenant.id);
    await this.persistBaileysRuntime(tenant, session.status, {
      reason: session.reason,
    });
    const out = await this.getWhatsAppConfig(user);
    return { ...out, qrDataUrl: session.qrDataUrl ?? null };
  }

  async getBaileysSessionStatus(user: AuthUser) {
    await this.assertModuleEnabled(user, 'whatsapp');
    const tenant = await this.requireTenantFromUser(user);
    const cfg = await this.readWhatsAppConfig(tenant.schemaName);
    if (cfg.provider !== 'baileys') {
      return this.getWhatsAppConfig(user);
    }
    try {
      const session = await this.baileys.status(tenant.id);
      await this.persistBaileysRuntime(tenant, session.status, {
        reason: session.reason,
      });
      const out = await this.getWhatsAppConfig(user);
      return { ...out, qrDataUrl: session.qrDataUrl ?? null };
    } catch {
      return this.getWhatsAppConfig(user);
    }
  }

  async logoutBaileysSession(user: AuthUser) {
    await this.assertModuleEnabled(user, 'whatsapp');
    const tenant = await this.requireTenantFromUser(user);
    try {
      await this.baileys.logout(tenant.id);
    } catch (err) {
      this.logger.warn(
        `Logout Baileys: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    await this.persistBaileysRuntime(tenant, 'disconnected', {
      reason: 'Sesión cerrada manualmente',
      alert: false,
    });
    return this.getWhatsAppConfig(user);
  }

  /**
   * Callback interno del sidecar Baileys (sin JWT; secreto compartido).
   */
  async handleBaileysStatusWebhook(dto: WhatsAppBaileysStatusDto) {
    const tenant = await this.tenants.findOne({ where: { id: dto.tenantId } });
    if (!tenant) throw new NotFoundException('Tenant not found');
    const wantAlert =
      dto.alert !== false &&
      (dto.status === 'disconnected' || dto.status === 'qr');
    await this.persistBaileysRuntime(tenant, dto.status, {
      reason: dto.reason,
      alert: wantAlert,
    });
    return { ok: true };
  }

  async getBaileysSlots(): Promise<{ used: number; max: number }> {
    const used = await this.countBaileysSlots();
    return { used, max: WHATSAPP_BAILEYS_MAX_SLOTS };
  }

  private async countBaileysSlots(excludeTenantId?: string): Promise<number> {
    const all = await this.tenants.find();
    let used = 0;
    for (const t of all) {
      if (excludeTenantId && t.id === excludeTenantId) continue;
      const enabled = normalizeEnabledModules(t.enabledModules);
      if (!enabled.includes('whatsapp')) continue;
      try {
        const cfg = await this.readWhatsAppConfig(t.schemaName);
        if (cfg.provider === 'baileys') used += 1;
      } catch {
        /* schema missing / etc. */
      }
    }
    return used;
  }

  private async assertBaileysSlotAvailable(tenantId: string) {
    const cfgTenant = await this.requireTenant(tenantId);
    const current = await this.readWhatsAppConfig(cfgTenant.schemaName);
    if (current.provider === 'baileys') return; // already holding a slot
    const used = await this.countBaileysSlots(tenantId);
    if (used >= WHATSAPP_BAILEYS_MAX_SLOTS) {
      throw new BadRequestException(
        `Cupo Baileys lleno (${WHATSAPP_BAILEYS_MAX_SLOTS}/${WHATSAPP_BAILEYS_MAX_SLOTS}). Usa Cloud API o libera una sesión Baileys de otra empresa.`,
      );
    }
  }

  private async readWhatsAppConfig(
    schemaName: string,
  ): Promise<WhatsAppModuleConfig> {
    const repo =
      await this.tenantConnections.getModuleConfigRepository(schemaName);
    const row = await repo.findOne({ where: { moduleId: 'whatsapp' } });
    return {
      ...EMPTY_WHATSAPP_CONFIG,
      ...((row?.config ?? {}) as Partial<WhatsAppModuleConfig>),
    };
  }

  private async persistBaileysRuntime(
    tenant: Tenant,
    status: WhatsAppBaileysStatus,
    opts?: { reason?: string | null; alert?: boolean },
  ) {
    const repo = await this.tenantConnections.getModuleConfigRepository(
      tenant.schemaName,
    );
    let row = await repo.findOne({ where: { moduleId: 'whatsapp' } });
    const prev = {
      ...EMPTY_WHATSAPP_CONFIG,
      ...((row?.config ?? {}) as Partial<WhatsAppModuleConfig>),
    };
    const next: WhatsAppModuleConfig = {
      ...prev,
      provider: 'baileys',
      baileysStatus: status,
      lastDisconnectAt:
        status === 'disconnected' || status === 'qr'
          ? new Date().toISOString()
          : prev.lastDisconnectAt,
      lastDisconnectReason:
        status === 'disconnected' || status === 'qr'
          ? opts?.reason || prev.lastDisconnectReason
          : null,
    };

    const shouldAlert =
      opts?.alert !== false &&
      (status === 'disconnected' || status === 'qr') &&
      prev.baileysStatus === 'connected';

    if (shouldAlert) {
      next.lastAlertAt = new Date().toISOString();
    }

    if (!row) {
      row = repo.create({ moduleId: 'whatsapp', config: next });
    } else {
      row.config = next;
    }
    await repo.save(row);

    if (shouldAlert) {
      void this.sendBaileysDisconnectEmail(tenant, next).catch((err) =>
        this.logger.warn(
          `Email Baileys disconnect: ${
            err instanceof Error ? err.message : String(err)
          }`,
        ),
      );
    }
  }

  private async sendBaileysDisconnectEmail(
    tenant: Tenant,
    cfg: WhatsAppModuleConfig,
  ) {
    const to = (tenant.email || '').trim();
    if (!to) {
      this.logger.warn(
        `Tenant ${tenant.slug} sin email; no se avisó desconexión WhatsApp`,
      );
      return;
    }
    const reason =
      cfg.lastDisconnectReason ||
      (cfg.baileysStatus === 'qr'
        ? 'Se requiere escanear el QR de nuevo'
        : 'Sesión desconectada');
    await this.tenantMailer.sendMail(tenant.schemaName, {
      to,
      subject: `[${tenant.name}] WhatsApp Baileys requiere atención`,
      title: 'WhatsApp requiere atención',
      html: `<p style="margin:0 0 14px">Hola,</p>
<p style="margin:0 0 14px">La sesión de <strong>WhatsApp Baileys</strong> de <strong>${escapeHtml(tenant.name)}</strong> necesita atención.</p>
<p style="margin:0 0 14px"><strong>Estado:</strong> ${escapeHtml(String(cfg.baileysStatus))}<br/>
<strong>Motivo:</strong> ${escapeHtml(reason)}</p>
<p style="margin:0 0 14px">Entra a <em>Ajustes → Empresa → Integraciones → WhatsApp</em> para reconectar (escanea el QR si hace falta).</p>
<p style="margin:0;color:#64748b;font-size:13px">Baileys no es oficial y puede desconectarse; Cloud API es la opción estable.</p>`,
    });
  }

  private async assertModuleEnabled(user: AuthUser, moduleId: ModuleId) {
    const tenant = await this.requireTenantFromUser(user);
    const enabled = normalizeEnabledModules(tenant.enabledModules);
    if (!enabled.includes(moduleId)) {
      throw new ForbiddenException(`Módulo ${moduleId} no habilitado`);
    }
  }

  private async requireTenant(id: string) {
    await this.ensureAiInternalColumn();
    const tenant = await this.tenants.findOne({ where: { id } });
    if (!tenant) throw new NotFoundException('Tenant not found');
    // Normaliza en lectura por si el tenant es anterior al sistema de módulos.
    if (!tenant.enabledModules?.length) {
      tenant.enabledModules = normalizeEnabledModules([]);
      await this.tenants.save(tenant);
    } else {
      tenant.enabledModules = normalizeEnabledModules(tenant.enabledModules);
    }
    if (tenant.aiInternalEnabled == null) {
      tenant.aiInternalEnabled = true;
    }
    return tenant;
  }

  /** Columna añadida sin migrate formal (prod con synchronize=false). */
  private async ensureAiInternalColumn() {
    if (this.aiInternalColumnEnsured) return;
    await this.dataSource.query(`
      ALTER TABLE public.tenants
      ADD COLUMN IF NOT EXISTS ai_internal_enabled boolean NOT NULL DEFAULT true
    `);
    this.aiInternalColumnEnsured = true;
  }

  private async requireTenantFromUser(user: AuthUser) {
    if (!user.tenantId) {
      throw new ForbiddenException('Tenant context required');
    }
    return this.requireTenant(user.tenantId);
  }
}
