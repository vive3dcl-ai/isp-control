import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TenantConnectionService } from '../database/tenant-connection.service';
import { Tenant } from '../tenants/entities/tenant.entity';
import {
  EMPTY_WHATSAPP_CONFIG,
  isWhatsAppConfigured,
  normalizeEnabledModules,
  type WhatsAppModuleConfig,
} from './module-catalog';
import { WhatsAppBaileysClient } from './whatsapp-baileys.client';

export type WhatsAppInvoiceDeliveryResult =
  | { status: 'skipped'; reason: string }
  | { status: 'sent'; provider: 'cloud_api' | 'baileys'; messageId?: string }
  | { status: 'failed'; provider: 'cloud_api' | 'baileys'; error: string };

@Injectable()
export class TenantWhatsAppService {
  private readonly logger = new Logger(TenantWhatsAppService.name);

  constructor(
    @InjectRepository(Tenant)
    private readonly tenants: Repository<Tenant>,
    private readonly tenantConnections: TenantConnectionService,
    private readonly baileys: WhatsAppBaileysClient,
    private readonly config: ConfigService,
  ) {}

  /**
   * Best-effort invoice delivery. A WhatsApp failure must never prevent email.
   */
  async sendInvoiceDocument(input: {
    schemaName: string;
    phone: string;
    invoiceNumber: string;
    clientName: string;
    companyName: string;
    pdf: Buffer;
  }): Promise<WhatsAppInvoiceDeliveryResult> {
    const tenant = await this.tenants.findOne({
      where: { schemaName: input.schemaName },
    });
    if (!tenant) return { status: 'skipped', reason: 'tenant_not_found' };
    if (!normalizeEnabledModules(tenant.enabledModules).includes('whatsapp')) {
      return { status: 'skipped', reason: 'module_disabled' };
    }

    const repo = await this.tenantConnections.getModuleConfigRepository(
      input.schemaName,
    );
    const row = await repo.findOne({ where: { moduleId: 'whatsapp' } });
    const cfg: WhatsAppModuleConfig = {
      ...EMPTY_WHATSAPP_CONFIG,
      ...((row?.config ?? {}) as Partial<WhatsAppModuleConfig>),
    };
    if (!isWhatsAppConfigured(cfg)) {
      return { status: 'skipped', reason: 'module_not_configured' };
    }

    const phone = this.normalizePhone(input.phone);
    if (!phone) {
      return { status: 'skipped', reason: 'client_without_valid_phone' };
    }

    const fileName = `factura-${this.safeFilePart(input.invoiceNumber)}.pdf`;
    const caption =
      `Hola ${input.clientName}, adjuntamos la factura ` +
      `${input.invoiceNumber} de ${input.companyName}.`;

    try {
      if (cfg.provider === 'baileys') {
        const result = await this.baileys.sendDocument(tenant.id, {
          phone,
          fileName,
          mimeType: 'application/pdf',
          caption,
          contentBase64: input.pdf.toString('base64'),
        });
        return {
          status: 'sent',
          provider: 'baileys',
          messageId: result.messageId,
        };
      }

      const messageId = await this.sendCloudApiDocument({
        cfg,
        phone,
        fileName,
        caption,
        pdf: input.pdf,
      });
      return { status: 'sent', provider: 'cloud_api', messageId };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `WhatsApp factura ${input.invoiceNumber} (${tenant.slug}): ${error}`,
      );
      return { status: 'failed', provider: cfg.provider, error };
    }
  }

  private async sendCloudApiDocument(input: {
    cfg: WhatsAppModuleConfig;
    phone: string;
    fileName: string;
    caption: string;
    pdf: Buffer;
  }): Promise<string | undefined> {
    const version =
      this.config.get<string>('WHATSAPP_GRAPH_API_VERSION') || 'v23.0';
    const base = `https://graph.facebook.com/${version}`;
    const auth = { Authorization: `Bearer ${input.cfg.accessToken}` };

    const form = new FormData();
    form.append('messaging_product', 'whatsapp');
    form.append(
      'file',
      new Blob([new Uint8Array(input.pdf)], { type: 'application/pdf' }),
      input.fileName,
    );
    const upload = await fetch(
      `${base}/${encodeURIComponent(input.cfg.phoneNumberId)}/media`,
      {
        method: 'POST',
        headers: auth,
        body: form,
      },
    );
    const uploadBody = (await upload.json()) as {
      id?: string;
      error?: { message?: string };
    };
    if (!upload.ok || !uploadBody.id) {
      throw new Error(
        uploadBody.error?.message ||
          `Cloud API media upload HTTP ${upload.status}`,
      );
    }

    const send = await fetch(
      `${base}/${encodeURIComponent(input.cfg.phoneNumberId)}/messages`,
      {
        method: 'POST',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: input.phone,
          type: 'template',
          template: {
            name: input.cfg.templateName,
            language: { code: input.cfg.templateLanguage },
            components: [
              {
                type: 'header',
                parameters: [
                  {
                    type: 'document',
                    document: {
                      id: uploadBody.id,
                      filename: input.fileName,
                    },
                  },
                ],
              },
            ],
          },
        }),
      },
    );
    const sendBody = (await send.json()) as {
      messages?: Array<{ id?: string }>;
      error?: { message?: string };
    };
    if (!send.ok) {
      throw new Error(
        sendBody.error?.message || `Cloud API send HTTP ${send.status}`,
      );
    }
    return sendBody.messages?.[0]?.id;
  }

  private normalizePhone(value: string): string | null {
    const digits = (value || '').replace(/\D/g, '');
    return digits.length >= 8 && digits.length <= 15 ? digits : null;
  }

  private safeFilePart(value: string): string {
    return value.replace(/[^a-zA-Z0-9_-]/g, '_');
  }
}
