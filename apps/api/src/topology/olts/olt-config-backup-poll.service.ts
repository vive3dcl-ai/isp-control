import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Tenant } from '../../tenants/entities/tenant.entity';
import { OltConfigBackupService } from './olt-config-backup.service';

const OLT_BACKUP_INTERVAL_MS = Number(
  process.env.OLT_BACKUP_INTERVAL_MS ?? 24 * 60 * 60 * 1000,
);
/** Don't collide with the 30 min inventory poller at boot. */
const OLT_BACKUP_FIRST_DELAY_MS = 3 * 60 * 1000;

@Injectable()
export class OltConfigBackupPollService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(OltConfigBackupPollService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    @InjectRepository(Tenant)
    private readonly tenants: Repository<Tenant>,
    private readonly backups: OltConfigBackupService,
  ) {}

  onModuleInit() {
    this.timer = setInterval(
      () => void this.tick(),
      Number.isFinite(OLT_BACKUP_INTERVAL_MS) && OLT_BACKUP_INTERVAL_MS > 0
        ? OLT_BACKUP_INTERVAL_MS
        : 24 * 60 * 60 * 1000,
    );
    setTimeout(() => void this.tick(), OLT_BACKUP_FIRST_DELAY_MS);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async tick() {
    if (this.running) return;
    this.running = true;
    try {
      const list = await this.tenants.find({
        where: { status: 'active' },
        select: ['id', 'schemaName'],
      });
      for (const t of list) {
        if (!t.schemaName) continue;
        try {
          await this.backups.snapshotSchema(t.schemaName);
        } catch (err) {
          this.logger.warn(
            `backup OLT ${t.schemaName}: ${
              err instanceof Error ? err.message : err
            }`,
          );
        }
      }
    } catch (err) {
      this.logger.warn(
        `backup OLT poll: ${err instanceof Error ? err.message : err}`,
      );
    } finally {
      this.running = false;
    }
  }
}
