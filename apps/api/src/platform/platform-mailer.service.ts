import { Injectable, Logger } from '@nestjs/common';
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

  async sendMail(
    to: string | string[],
    subject: string,
    text: string,
    html?: string,
  ) {
    const row = await this.smtp.getOrCreate();
    if (!row.host?.trim() || !row.fromEmail?.trim()) {
      this.logger.warn(`SMTP plataforma no configurado; no se envió: ${subject}`);
      return;
    }
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
