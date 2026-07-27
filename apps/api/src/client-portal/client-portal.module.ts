import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { ModulesModule } from '../modules/modules.module';
import { PlatformModule } from '../platform/platform.module';
import { BillingModule } from '../billing/billing.module';
import { TenantRolesGuard } from '../auth/guards/tenant-roles.guard';
import { Tenant } from '../tenants/entities/tenant.entity';
import { ClientPortalUser } from './entities/client-portal-user.entity';
import { ClientPortalInvite } from './entities/client-portal-invite.entity';
import { ClientPortalService } from './client-portal.service';
import {
  ClientPortalAuthController,
  ClientPortalPublicController,
} from './client-portal.controller';
import { ClientPortalAdminController } from './client-portal-admin.controller';
import { ClientPortalAppController } from './client-portal-app.controller';

@Module({
  imports: [
    DatabaseModule,
    AuthModule,
    ModulesModule,
    PlatformModule,
    forwardRef(() => BillingModule),
    TypeOrmModule.forFeature([ClientPortalUser, ClientPortalInvite, Tenant]),
  ],
  controllers: [
    ClientPortalPublicController,
    ClientPortalAuthController,
    ClientPortalAdminController,
    ClientPortalAppController,
  ],
  providers: [ClientPortalService, TenantRolesGuard],
  exports: [ClientPortalService],
})
export class ClientPortalModule {}

