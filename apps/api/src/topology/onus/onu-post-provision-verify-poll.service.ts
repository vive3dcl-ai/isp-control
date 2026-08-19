import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Tenant } from '../../tenants/entities/tenant.entity';
import { OnuPostProvisionVerifyService } from './onu-post-provision-verify.service';
import {
  mapWithConcurrency,
  VERIFY_MAX_CONCURRENCY_PER_TENANT,
  VERIFY_MAX_GLOBAL_CONCURRENCY,
} from './onu-post-provision-verify.util';

/** Mira ONUs en `test` una vez por minuto; el propio servicio respeta los 3 min. */
const VERIFY_POLL_INTERVAL_MS = 60_000;
/** Tope duro: si un tick se cuelga (heal Huawei lento / connreq), no bloquea el poller para siempre. */
const VERIFY_POLL_TICK_TIMEOUT_MS = 3 * 60_000;

/**
 * Poller del chequeo silencioso post-aprovisionamiento.
 * Independiente de la UI: sigue aunque se cierre el modal de la ONU.
 *
 * Cada tenant tiene su propia cola y como máximo cinco ONUs en ejecución. A la
 * vez se conserva un techo global de 40 para que una instalación con muchos
 * tenants tampoco pueda saturar el ACS. Un tick no se solapa con el siguiente.
 */
@Injectable()
export class OnuPostProvisionVerifyPollService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(OnuPostProvisionVerifyPollService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    @InjectRepository(Tenant)
    private readonly tenants: Repository<Tenant>,
    private readonly verify: OnuPostProvisionVerifyService,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.tick(), VERIFY_POLL_INTERVAL_MS);
    setTimeout(() => void this.tick(), 25_000);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async tick() {
    if (this.running) {
      this.logger.debug('verify poll: tick anterior aún en curso, se salta');
      return;
    }
    this.running = true;
    try {
      await Promise.race([
        this.runTick(),
        new Promise<never>((_, reject) =>
          setTimeout(
            () =>
              reject(
                new Error(
                  `verify poll tick > ${VERIFY_POLL_TICK_TIMEOUT_MS / 1000}s`,
                ),
              ),
            VERIFY_POLL_TICK_TIMEOUT_MS,
          ),
        ),
      ]);
    } catch (err) {
      this.logger.warn(
        `verify poll tick failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    } finally {
      this.running = false;
    }
  }

  private async runTick() {
    const active = await this.tenants.find({ where: { status: 'active' } });
    if (!active.length) return;

    // Cada worker de tenant puede usar hasta cinco plazas. Limitar a ocho
    // tenants paralelos conserva el techo global de cuarenta.
    const tenantConcurrency = Math.max(
      1,
      Math.floor(
        VERIFY_MAX_GLOBAL_CONCURRENCY / VERIFY_MAX_CONCURRENCY_PER_TENANT,
      ),
    );
    const results = await mapWithConcurrency(
      active,
      tenantConcurrency,
      async (tenant) => {
        await this.verify.tickSchema(
          tenant.schemaName,
          VERIFY_MAX_CONCURRENCY_PER_TENANT,
        );
        return tenant.schemaName;
      },
    );

    const failed = results.filter((r) => r.status === 'rejected').length;
    if (failed) {
      this.logger.warn(
        `verify poll: ${failed}/${active.length} tenant(s) fallaron en este tick`,
      );
    }
  }
}
