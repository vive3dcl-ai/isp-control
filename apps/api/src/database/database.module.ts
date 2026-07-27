import { Module } from '@nestjs/common';
import { TenantConnectionService } from './tenant-connection.service';

@Module({
  providers: [TenantConnectionService],
  exports: [TenantConnectionService],
})
export class DatabaseModule {}
