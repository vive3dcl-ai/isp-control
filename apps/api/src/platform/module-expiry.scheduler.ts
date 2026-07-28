import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Tenant } from '../tenants/entities/tenant.entity';
import { getModuleDefinition } from '../modules/module-catalog';
import { PlatformSubscriptionService } from './platform-subscription.service';
import { PlatformMailerService } from './platform-mailer.service';

const TICK_MS = 60 * 60 * 1000; // 1h

/**
 * - Renovaciones pending 15 días antes del vencimiento.
 * - Avisos al admin del tenant 5 y 2 días antes (cobro pending).
 * - Vencimiento de módulos de pago único (+ avisos a platform admins).
 */
@Injectable()
export class ModuleExpiryScheduler
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(ModuleExpiryScheduler.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    private readonly subscriptions: PlatformSubscriptionService,
    private readonly mailer: PlatformMailerService,
    @InjectRepository(Tenant)
    private readonly tenants: Repository<Tenant>,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    setTimeout(() => void this.tick(), 15_000);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async tick() {
    if (this.running) return;
    this.running = true;
    try {
      const renewals = await this.subscriptions.generateUpcomingRenewals();
      if (renewals > 0) {
        this.logger.log(`Created ${renewals} pending renewal charge(s)`);
      }
      await this.notifyRenewals(5);
      await this.notifyRenewals(2);
      await this.notifyModuleContracts(5);
      await this.notifyModuleContracts(2);
      const n = await this.subscriptions.expireDueContracts();
      if (n > 0) this.logger.log(`Expired ${n} one-time module contract(s)`);
    } catch (err) {
      this.logger.warn(
        `Platform billing tick failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    } finally {
      this.running = false;
    }
  }

  private async notifyRenewals(days: 5 | 2) {
    const list =
      await this.subscriptions.findPendingRenewalsNeedingNotice(days);
    for (const c of list) {
      const tenant = await this.tenants.findOne({ where: { id: c.tenantId } });
      if (!tenant?.email?.trim()) {
        this.logger.warn(
          `Renewal ${c.id}: tenant sin email, no se avisó`,
        );
        await this.subscriptions.markChargeNotified(c.id, days);
        continue;
      }
      const due = c.dueAt ? c.dueAt.toISOString().slice(0, 10) : '—';
      const amount = Number(c.amountUsd);
      const subject = `[ISP Control] Renovación pendiente · vence en ${days} días`;
      const text = [
        `Hola ${tenant.name},`,
        ``,
        `Tu suscripción de plataforma vence el ${due}.`,
        `Hay un cobro pendiente de ${formatUsdLike(amount)} USD.`,
        ``,
        `Entra a Ajustes → Empresa → Suscripción y pulsa Pagar para renovar.`,
        ``,
        `Si no se paga a tiempo, el acceso puede quedar en mora.`,
      ].join('\n');
      try {
        await this.mailer.sendMail(tenant.email.trim(), subject, text, undefined, {
          title: `Renovación en ${days} días`,
        });
        await this.subscriptions.markChargeNotified(c.id, days);
      } catch (err) {
        this.logger.warn(
          `Failed renewal notice ${c.id}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
  }

  private async notifyModuleContracts(days: 5 | 2) {
    const list = await this.subscriptions.findContractsNeedingNotice(days);
    for (const c of list) {
      const tenant = await this.tenants.findOne({ where: { id: c.tenantId } });
      const modName = getModuleDefinition(c.moduleId)?.name ?? c.moduleId;
      const expires = c.expiresAt
        ? c.expiresAt.toISOString().slice(0, 10)
        : '—';
      const subject = `[ISP Control] Módulo ${modName} vence en ${days} días`;
      const text = [
        `Aviso de vencimiento (${days} días).`,
        ``,
        `Empresa: ${tenant?.name ?? c.tenantId}`,
        `Módulo: ${modName}`,
        `Modo: pago único`,
        `Vence: ${expires}`,
        ``,
        `El módulo se desactivará automáticamente al vencer.`,
      ].join('\n');
      try {
        // Aviso al admin del tenant si hay email; si no, a platform admins.
        if (tenant?.email?.trim()) {
          await this.mailer.sendMail(
            tenant.email.trim(),
            subject,
            text,
            undefined,
            { title: `Módulo ${modName}` },
          );
        } else {
          await this.mailer.sendToPlatformAdmins(subject, text);
        }
        await this.subscriptions.markNotified(c.id, days);
      } catch (err) {
        this.logger.warn(
          `Failed to notify contract ${c.id}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
  }
}

function formatUsdLike(n: number): string {
  return n.toFixed(2);
}
