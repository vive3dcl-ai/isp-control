import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { AuthModule } from '../auth/auth.module';
import { TenantRolesGuard } from '../auth/guards/tenant-roles.guard';
import { CalendarService } from './calendar.service';
import { CalendarController } from './calendar.controller';

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [CalendarController],
  providers: [CalendarService, TenantRolesGuard],
  exports: [CalendarService],
})
export class CalendarModule {}
