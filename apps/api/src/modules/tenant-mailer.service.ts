import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { TenantConnectionService } from '../database/tenant-connection.service';
import {
  EMPTY_SMTP_CONFIG,
  isSmtpConfigured,
  type SmtpModuleConfig,
} from './module-catalog';

@Injectable()
export class TenantMailerService {
  private readonly logger = new Logger(TenantMailerService.name);

  constructor(private readonly tenantConnections: TenantConnectionService) {}

  async getSmtpConfig(schemaName: string): Promise<SmtpModuleConfig> {
    const repo =
      await this.tenantConnections.getModuleConfigRepository(schemaName);
    const row = await repo.findOne({ where: { moduleId: 'smtp' } });
    return {
      ...EMPTY_SMTP_CONFIG,
      ...((row?.config ?? {}) as Partial<SmtpModuleConfig>),
    };
  }

  async sendMail(
    schemaName: string,
    opts: {
      to: string;
      subject: string;
      html: string;
      text?: string;
      attachments?: Array<{
        filename: string;
        content: Buffer;
        contentType?: string;
      }>;
    },
  ) {
    const to = opts.to.trim().toLowerCase();
    if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      throw new BadRequestException('Correo de destino inválido');
    }
    const cfg = await this.getSmtpConfig(schemaName);
    if (!isSmtpConfigured(cfg)) {
      throw new BadRequestException(
        'SMTP no configurado. Configúralo en Ajustes → Integraciones.',
      );
    }
    const transporter = nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.secure,
      auth: cfg.username
        ? { user: cfg.username, pass: cfg.password }
        : undefined,
    });
    const from = cfg.fromName
      ? `"${cfg.fromName}" <${cfg.fromEmail}>`
      : cfg.fromEmail;
    try {
      await transporter.sendMail({
        from,
        to,
        subject: opts.subject,
        text: opts.text ?? stripHtml(opts.html),
        html: opts.html,
        attachments: opts.attachments,
      });
    } catch (err) {
      this.logger.error(
        `Error enviando correo en ${schemaName}: ${(err as Error).message}`,
      );
      throw new BadRequestException(
        `No se pudo enviar el correo: ${(err as Error).message}`,
      );
    }
  }

  async sendTest(
    schemaName: string,
    toRaw: string,
    productName = 'ISP Control',
  ) {
    const to = toRaw.trim().toLowerCase();
    await this.sendMail(schemaName, {
      to,
      subject: `Prueba SMTP — ${productName}`,
      html:
        `<p>Este es un correo de prueba de <strong>${escapeHtml(productName)}</strong>.</p>` +
        `<p>Si lo recibiste, la configuración SMTP de la empresa funciona correctamente.</p>`,
      text:
        `Este es un correo de prueba de ${productName}.\n` +
        `Si lo recibiste, la configuración SMTP de la empresa funciona correctamente.`,
    });
    return { ok: true as const };
  }
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
