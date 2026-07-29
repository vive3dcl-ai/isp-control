import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { Repository } from 'typeorm';
import { Tenant } from '../tenants/entities/tenant.entity';
import { QUEUE_BILLING } from '../queues/queue.constants';
import { TenantConnectionService } from '../database/tenant-connection.service';
import { BillingService } from './billing.service';
import { alreadyRanThisMinute, cronMatches } from './cron.util';
import type {
  BillingJobName,
  BillingJobPayload,
} from '../queues/queue.constants';

const TICK_MS = 60_000;

/**
 * Every minute: for each active tenant, evaluate that tenant's cron schedules
 * in isolation and enqueue one BullMQ job per (tenant, action).
 */
@Injectable()
export class BillingSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BillingSchedulerService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticking = false;

  constructor(
    @InjectRepository(Tenant)
    private readonly tenants: Repository<Tenant>,
    private readonly tenantConnections: TenantConnectionService,
    private readonly billing: BillingService,
    @InjectQueue(QUEUE_BILLING) private readonly billingQueue: Queue,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    setTimeout(() => void this.tick(), 8_000);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async tick() {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const active = await this.tenants.find({ where: { status: 'active' } });
      const now = new Date();
      await Promise.allSettled(
        active.map((tenant) => this.tickTenant(tenant, now)),
      );
    } catch (err) {
      this.logger.warn(
        `Billing scheduler tick failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    } finally {
      this.ticking = false;
    }
  }

  private async tickTenant(tenant: Tenant, now: Date) {
    try {
      await this.tenantConnections.ensureTenantSchema(tenant.schemaName);
      const settings = await this.billing.ensureSettings(tenant.schemaName);
      const repo = await this.tenantConnections.getBillingSettingsRepository(
        tenant.schemaName,
      );

      const jobs: Array<{
        name: BillingJobName;
        enabled: boolean;
        cron: string;
        last: Date | null;
        mark: (at: Date) => void;
      }> = [
        {
          name: 'billing.periods',
          enabled: settings.periodsEnabled,
          cron: settings.periodsCron,
          last: settings.periodsLastRunAt,
          mark: (at) => {
            settings.periodsLastRunAt = at;
          },
        },
        {
          name: 'billing.generate',
          enabled: settings.generateEnabled,
          cron: settings.generateCron,
          last: settings.generateLastRunAt,
          mark: (at) => {
            settings.generateLastRunAt = at;
          },
        },
        {
          name: 'billing.send',
          enabled: settings.sendEnabled,
          cron: settings.sendCron,
          last: settings.sendLastRunAt,
          mark: (at) => {
            settings.sendLastRunAt = at;
          },
        },
      ];

      let dirty = false;
      for (const job of jobs) {
        if (!job.enabled) continue;
        if (alreadyRanThisMinute(job.last, now)) continue;
        if (!cronMatches(job.cron, now, settings.timezone)) continue;

        const payload: BillingJobPayload = {
          tenantId: tenant.id,
          schemaName: tenant.schemaName,
          job: job.name,
        };
        await this.billingQueue.add(job.name, payload, {
          jobId: `${tenant.schemaName}:${job.name}:${now
            .toISOString()
            .slice(0, 16)}`,
          removeOnComplete: 100,
          removeOnFail: 200,
          attempts: 2,
        });
        job.mark(now);
        dirty = true;
      }
      if (dirty) await repo.save(settings);
    } catch (err) {
      this.logger.warn(
        `Billing tick failed for ${tenant.schemaName}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /** Manual run from settings UI — still scoped to one tenant schema. */
  async enqueueManual(
    tenantId: string,
    schemaName: string,
    job: 'periods' | 'generate' | 'send',
  ) {
    const name = `billing.${job}` as BillingJobName;
    const payload: BillingJobPayload = {
      tenantId,
      schemaName,
      job: name,
      manual: true,
    };
    return this.billingQueue.add(name, payload, {
      removeOnComplete: 50,
      removeOnFail: 50,
    });
  }
}
