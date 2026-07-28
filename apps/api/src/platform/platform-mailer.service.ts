import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as nodemailer from 'nodemailer';
import { Repository } from 'typeorm';
import { PlatformAdmin } from '../auth/entities/platform-admin.entity';
import { PlatformSmtpService } from './platform-smtp.service';

@Injectable()
export class PlatformMailerService {
  private readonly logger = new Logger(PlatformMailerService.name);

  constructor(
    private readonly smtp: PlatformSmtpService,
    @InjectRepository(PlatformAdmin)
    private readonly admins: Repository<PlatformAdmin>,
  ) {}

  async sendToPlatformAdmins(subject: string, text: string, html?: string) {
    const list = await this.admins.find({ select: ['email', 'name'] });
    if (!list.length) {
      this.logger.warn('No platform admins to notify');
      return { sent: 0 };
    }
    const to = list.map((a) => a.email);
    await this.sendMail(to, subject, text, html);
    return { sent: to.length };
  }

  /**
   * Envía correo con SMTP de plataforma.
   * Si SMTP no está configurado, solo registra warning (no lanza).
   * @returns true si se intentó enviar.
   */
  async sendMail(
    to: string | string[],
    subject: string,
    text: string,
    html?: string,
  ): Promise<boolean> {
    const row = await this.smtp.getOrCreate();
    if (!row.host?.trim() || !row.fromEmail?.trim()) {
      this.logger.warn(
        `SMTP plataforma no configurado; no se envió: ${subject}`,
      );
      return false;
    }
    await this.dispatch(row, to, subject, text, html);
    return true;
  }

  /** Prueba SMTP: exige config y propaga errores de transporte. */
  async sendTest(toRaw: string, productName = 'ISP Control') {
    const to = toRaw.trim().toLowerCase();
    if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      throw new BadRequestException('Correo de destino inválido');
    }
    const row = await this.smtp.getOrCreate();
    if (!row.host?.trim() || !row.fromEmail?.trim()) {
      throw new BadRequestException(
        'SMTP de plataforma no configurado. Guarda host y remitente primero.',
      );
    }
    const subject = `Prueba SMTP — ${productName}`;
    const text =
      `Este es un correo de prueba de ${productName}.\n` +
      `Si lo recibiste, la configuración SMTP de la plataforma funciona correctamente.`;
    try {
      await this.dispatch(row, to, subject, text);
    } catch (err) {
      this.logger.error(
        `Error prueba SMTP plataforma: ${(err as Error).message}`,
      );
      throw new BadRequestException(
        `No se pudo enviar el correo: ${(err as Error).message}`,
      );
    }
    return { ok: true as const };
  }

  private async dispatch(
    row: {
      host: string;
      port: number;
      secure: boolean;
      username: string;
      password: string;
      fromEmail: string;
      fromName: string;
    },
    to: string | string[],
    subject: string,
    text: string,
    html?: string,
  ) {
    const transporter = nodemailer.createTransport({
      host: row.host,
      port: row.port,
      secure: row.secure,
      auth: row.username
        ? { user: row.username, pass: row.password }
        : undefined,
    });
    const from = row.fromName
      ? `"${row.fromName}" <${row.fromEmail}>`
      : row.fromEmail;
    await transporter.sendMail({
      from,
      to: Array.isArray(to) ? to.join(', ') : to,
      subject,
      text,
      html: html ?? text.replace(/\n/g, '<br/>'),
    });
  }
}
