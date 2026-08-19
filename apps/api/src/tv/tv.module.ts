import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { TenantRolesGuard } from '../auth/guards/tenant-roles.guard';
import { TvMetaController } from './tv-meta.controller';
import { TvServersController } from './tv-servers.controller';
import { TvServersService } from './tv-servers.service';

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [TvMetaController, TvServersController],
  providers: [TvServersService, TenantRolesGuard],
  exports: [TvServersService],
})
export class TvModule {}
