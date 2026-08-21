import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PlatformPaymentMethod } from './entities/platform-payment-method.entity';
import {
  EMPTY_MERCADOPAGO_CONFIG,
  EMPTY_PAYPAL_CONFIG,
  emptyPlatformPaymentConfig,
  isMercadoPagoConfigured,
  isPayPalConfigured,
  PLATFORM_PAYMENT_PROVIDERS,
  type MercadoPagoModuleConfig,
  type PayPalModuleConfig,
  type PlatformPaymentProviderId,
} from './module-catalog';
import { UpdatePlatformPaymentMethodDto } from './dto/modules.dto';

@Injectable()
export class PlatformPaymentsService {
  constructor(
    @InjectRepository(PlatformPaymentMethod)
    private readonly methods: Repository<PlatformPaymentMethod>,
  ) {}

  /** Lista proveedores del catálogo + estado guardado (crea fila si falta). */
  async list() {
    const existing = await this.methods.find({ order: { createdAt: 'ASC' } });
    const byProvider = new Map(existing.map((m) => [m.provider, m]));

    const rows = [];
    for (const p of PLATFORM_PAYMENT_PROVIDERS) {
      let row = byProvider.get(p.id);
      if (!row) {
        row = await this.methods.save(
          this.methods.create({
            provider: p.id,
            name: p.name,
            enabled: false,
            environment: 'sandbox',
            integration: p.integration,
            config: emptyPlatformPaymentConfig(p.id),
          }),
        );
      }
      rows.push(this.serialize(row, p.description));
    }
    return rows;
  }

  async get(id: string) {
    const row = await this.require(id);
    const meta = PLATFORM_PAYMENT_PROVIDERS.find((p) => p.id === row.provider);
    return this.serialize(row, meta?.description ?? '');
  }

  async update(id: string, dto: UpdatePlatformPaymentMethodDto) {
    const row = await this.require(id);
    if (dto.enabled !== undefined) row.enabled = dto.enabled;
    if (dto.environment !== undefined) row.environment = dto.environment;

    if (row.provider === 'mercadopago') {
      const prev = {
        ...EMPTY_MERCADOPAGO_CONFIG,
        ...(row.config as Partial<MercadoPagoModuleConfig>),
      };
      const next: MercadoPagoModuleConfig = {
        environment: dto.environment ?? prev.environment ?? row.environment,
        integration: 'checkout_pro',
        publicKey:
          dto.publicKey !== undefined ? dto.publicKey.trim() : prev.publicKey,
        accessToken:
          dto.accessToken != null && dto.accessToken !== ''
            ? dto.accessToken
            : prev.accessToken,
        webhookSecret:
          dto.webhookSecret !== undefined
            ? dto.webhookSecret.trim()
            : prev.webhookSecret,
      };
      row.environment = next.environment;
      row.integration = 'checkout_pro';
      row.config = next;
    } else if (row.provider === 'paypal') {
      const prev = {
        ...EMPTY_PAYPAL_CONFIG,
        ...(row.config as Partial<PayPalModuleConfig>),
      };
      const next: PayPalModuleConfig = {
        environment: dto.environment ?? prev.environment ?? row.environment,
        integration: 'checkout',
        clientId:
          dto.clientId !== undefined ? dto.clientId.trim() : prev.clientId,
        clientSecret:
          dto.clientSecret != null && dto.clientSecret !== ''
            ? dto.clientSecret
            : prev.clientSecret,
        webhookId:
          dto.webhookId !== undefined
            ? dto.webhookId.trim()
            : prev.webhookId,
      };
      row.environment = next.environment;
      row.integration = 'checkout';
      row.config = next;
    }

    await this.methods.save(row);
    return this.get(id);
  }

  private async require(id: string) {
    const row = await this.methods.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Payment method not found');
    return row;
  }

  private serialize(row: PlatformPaymentMethod, description: string) {
    if (row.provider === 'mercadopago') {
      const cfg = {
        ...EMPTY_MERCADOPAGO_CONFIG,
        ...(row.config as Partial<MercadoPagoModuleConfig>),
      };
      return {
        id: row.id,
        provider: row.provider as PlatformPaymentProviderId,
        name: row.name,
        description,
        enabled: row.enabled,
        environment: row.environment,
        integration: 'checkout_pro' as const,
        configured: isMercadoPagoConfigured(cfg),
        publicKey: cfg.publicKey,
        hasAccessToken: !!cfg.accessToken,
        hasWebhookSecret: !!cfg.webhookSecret,
        accessToken: '',
        webhookSecret: '',
        updatedAt: row.updatedAt,
      };
    }

    if (row.provider === 'paypal') {
      const cfg = {
        ...EMPTY_PAYPAL_CONFIG,
        ...(row.config as Partial<PayPalModuleConfig>),
      };
      return {
        id: row.id,
        provider: row.provider as PlatformPaymentProviderId,
        name: row.name,
        description,
        enabled: row.enabled,
        environment: row.environment,
        integration: 'checkout' as const,
        configured: isPayPalConfigured(cfg),
        clientId: cfg.clientId,
        hasClientSecret: !!cfg.clientSecret,
        hasWebhookId: !!cfg.webhookId,
        clientSecret: '',
        webhookId: '',
        updatedAt: row.updatedAt,
      };
    }

    return {
      id: row.id,
      provider: row.provider,
      name: row.name,
      description,
      enabled: row.enabled,
      environment: row.environment,
      integration: row.integration,
      configured: false,
      updatedAt: row.updatedAt,
    };
  }
}
