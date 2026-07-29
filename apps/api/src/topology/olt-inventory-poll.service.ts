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

/** CLI config / VLAN inventory refresh cadence. */
const OLT_INVENTORY_INTERVAL_MS = 30 * 60_000;

/**
 * Keeps OLT uplink/PON/VLAN cache warm.
 * Status is also refreshed on demand via SNMP when opening the panels.
 */
@Injectable()
export class OltInventoryPollService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OltInventoryPollService.name);
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    @InjectRepository(Tenant)
    private readonly tenants: Repository<Tenant>,
    private readonly topology: TopologyService,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.tick(), OLT_INVENTORY_INTERVAL_MS);
    // First pass a few minutes after boot (avoid pile-up with ONU poller).
    setTimeout(() => void this.tick(), 90_000);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async tick() {
    let list: Tenant[];
    try {
      list = await this.tenants.find({
        where: { status: 'active' },
        select: ['id', 'schemaName'],
      });
    } catch (err) {
      this.logger.warn(
        `OLT inventory poll: tenants ${
          err instanceof Error ? err.message : err
        }`,
      );
      return;
    }

    for (const t of list) {
      if (!t.schemaName) continue;
      try {
        await this.topology.refreshOltInventoryForSchema(t.schemaName);
      } catch (err) {
        this.logger.warn(
          `OLT inventory ${t.schemaName}: ${
            err instanceof Error ? err.message : err
          }`,
        );
      }
    }
  }
}
