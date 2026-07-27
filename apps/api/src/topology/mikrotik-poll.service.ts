import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Tenant } from '../tenants/entities/tenant.entity';
import { TopologyService } from './topology.service';

/**
 * How often to schedule a poll pass.
 * Per-device in-flight locks skip devices still probing (OLT CLI is slow).
 */
const POLL_INTERVAL_MS = 15_000;

/**
 * Background poller: MikroTik + ZTE OLT metrics/ports.
 * Does not wait for slow OLT probes before scheduling the next MikroTik pass.
 */
@Injectable()
export class MikrotikPollService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MikrotikPollService.name);
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    @InjectRepository(Tenant)
    private readonly tenants: Repository<Tenant>,
    private readonly topology: TopologyService,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.tick(), POLL_INTERVAL_MS);
    setTimeout(() => void this.tick(), 3_000);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async tick() {
    try {
      const active = await this.tenants.find({ where: { status: 'active' } });
      // Fire per tenant without a global lock — TopologyService skips
      // devices already mid-probe so OLTs don't starve MikroTik polls.
      await Promise.allSettled(
        active.map(async (tenant) => {
          try {
            await this.topology.pollMikrotikDevicesInSchema(tenant.schemaName);
          } catch (err) {
            this.logger.warn(
              `Device poll failed for ${tenant.schemaName}: ${
                err instanceof Error ? err.message : String(err)
              }`,
            );
          }
        }),
      );
    } catch (err) {
      this.logger.warn(
        `Poll tick failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
