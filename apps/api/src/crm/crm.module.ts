import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { TenantRolesGuard } from '../auth/guards/tenant-roles.guard';
import { TopologyModule } from '../topology/topology.module';
import { BillingModule } from '../billing/billing.module';
import { ClientPortalModule } from '../client-portal/client-portal.module';
import { Tenant } from '../tenants/entities/tenant.entity';
import { CrmController } from './crm.controller';
import { CrmService } from './crm.service';

@Module({
  imports: [
    DatabaseModule,
    AuthModule,
    TopologyModule,
    BillingModule,
    forwardRef(() => ClientPortalModule),
    TypeOrmModule.forFeature([Tenant]),
  ],
  controllers: [CrmController],
  providers: [CrmService, TenantRolesGuard],
  exports: [CrmService],
})
export class CrmModule {}
