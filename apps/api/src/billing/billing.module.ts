import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { QueuesModule } from '../queues/queues.module';
import { ModulesModule } from '../modules/modules.module';
import { TenantRolesGuard } from '../auth/guards/tenant-roles.guard';
import { Tenant } from '../tenants/entities/tenant.entity';
import { QUEUE_BILLING } from '../queues/queue.constants';
import { BillingService } from './billing.service';
import { BillingSchedulerService } from './billing-scheduler.service';
import { BillingSettingsController } from './billing.controller';
import { BillingProcessor } from './processors/billing.processor';
import { InvoicePdfService } from './invoice-pdf.service';

@Module({
  imports: [
    DatabaseModule,
    AuthModule,
    QueuesModule,
    ModulesModule,
    TypeOrmModule.forFeature([Tenant]),
    BullModule.registerQueue({ name: QUEUE_BILLING }),
  ],
  controllers: [BillingSettingsController],
  providers: [
    BillingService,
    BillingSchedulerService,
    BillingProcessor,
    InvoicePdfService,
    TenantRolesGuard,
  ],
  exports: [BillingService, InvoicePdfService],
})
export class BillingModule {}
