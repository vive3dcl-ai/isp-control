import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Tenant } from '../../tenants/entities/tenant.entity';
import { OnuConnectedService } from './onu-connected.service';

/** ONU signal + traffic refresh — SNMP RO primary (fleet ~1 min). */
const ONU_POLL_INTERVAL_MS = 60_000;

/** Retain metric samples this long (fleet 1/min + denser live while modal open). */
export const ONU_METRIC_RETENTION_MS = 24 * 60 * 60 * 1000;

/**
 * Background poller for ONU optical signal + online state.
 * Inventory add/remove stays on Sync; this keeps Conectadas fresh.
 */
@Injectable()
export class OnuMetricsPollService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OnuMetricsPollService.name);
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    @InjectRepository(Tenant)
    private readonly tenants: Repository<Tenant>,
    private readonly onus: OnuConnectedService,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.tick(), ONU_POLL_INTERVAL_MS);
    setTimeout(() => void this.tick(), 12_000);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async tick() {
    // Per-OLT locks live in OnuConnectedService; do not skip the whole
    // minute if a previous inventory refresh is still running — otherwise
    // traffic samples drift past the ~1/min target.
    try {
      const active = await this.tenants.find({ where: { status: 'active' } });
      await Promise.allSettled(
        active.map(async (tenant) => {
          try {
            await this.onus.pollMetricsForSchema(tenant.schemaName);
          } catch (err) {
            this.logger.warn(
              `ONU poll failed for ${tenant.schemaName}: ${
                err instanceof Error ? err.message : String(err)
              }`,
            );
          }
        }),
      );
    } catch (err) {
      this.logger.warn(
        `ONU poll tick failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
