import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Tenant } from './entities/tenant.entity';
import { UserDirectory } from './entities/user-directory.entity';
import { PlatformAdmin } from '../auth/entities/platform-admin.entity';
import { AdminController } from './admin.controller';
import { TenantAppController } from './tenant-app.controller';
import { CompanySettingsController } from './company-settings.controller';
import { TenantUsersController } from './tenant-users.controller';
import { DatabaseModule } from '../database/database.module';
import { TenantsService } from './tenants.service';
import { TenantProvisioningService } from './tenant-provisioning.service';
import { TenantUsersService } from './tenant-users.service';
import { AuthModule } from '../auth/auth.module';
import { CrmModule } from '../crm/crm.module';
import { TopologyModule } from '../topology/topology.module';
import { PlatformModule } from '../platform/platform.module';

@Module({
  imports: [
    DatabaseModule,
    forwardRef(() => AuthModule),
    forwardRef(() => CrmModule),
    TopologyModule,
    PlatformModule,
    TypeOrmModule.forFeature([Tenant, UserDirectory, PlatformAdmin]),
  ],
  controllers: [
    AdminController,
    TenantAppController,
    CompanySettingsController,
    TenantUsersController,
  ],
  providers: [TenantsService, TenantProvisioningService, TenantUsersService],
  exports: [TypeOrmModule, TenantsService, TenantProvisioningService],
})
export class TenantsModule {}
