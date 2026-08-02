import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Tenant } from '../tenants/entities/tenant.entity';
import { OnuPostProvisionVerifyService } from './onu-post-provision-verify.service';

/** Mira ONUs en `test` una vez por minuto; el propio servicio respeta los 3 min. */
const VERIFY_POLL_INTERVAL_MS = 60_000;

/**
 * Poller del chequeo silencioso post-aprovisionamiento.
 * Independiente de la UI: sigue aunque se cierre el modal de la ONU.
 */
@Injectable()
export class OnuPostProvisionVerifyPollService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(OnuPostProvisionVerifyPollService.name);
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    @InjectRepository(Tenant)
    private readonly tenants: Repository<Tenant>,
    private readonly verify: OnuPostProvisionVerifyService,
  ) {}

  onModuleInit() {
    this.timer = setInterval(
      () => void this.tick(),
      VERIFY_POLL_INTERVAL_MS,
    );
    setTimeout(() => void this.tick(), 25_000);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async tick() {
    try {
      const active = await this.tenants.find({ where: { status: 'active' } });
      await Promise.allSettled(
        active.map(async (tenant) => {
          try {
            await this.verify.tickSchema(tenant.schemaName);
          } catch (err) {
            this.logger.warn(
              `verify poll failed for ${tenant.schemaName}: ${
                err instanceof Error ? err.message : String(err)
              }`,
            );
          }
        }),
      );
    } catch (err) {
      this.logger.warn(
        `verify poll tick failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}
