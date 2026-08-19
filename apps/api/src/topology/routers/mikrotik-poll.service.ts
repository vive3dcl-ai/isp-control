import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Tenant } from '../../tenants/entities/tenant.entity';
import { TopologyService } from '../topology.service';

/**
 * Background poller: MikroTik via API; ZTE OLT liveness via SNMP RO.
 * Does not open Telnet/SSH to OLTs on the ticker.
 */
const POLL_INTERVAL_MS = 15_000;

/**
 * Background poller: MikroTik + ZTE OLT health.
 * OLTs use SNMP RO only here — CLI stays for provisioning / "Probar".
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
