import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { Tenant } from '../tenants/entities/tenant.entity';
import { TenantRolesGuard } from '../auth/guards/tenant-roles.guard';
import { TopologyController } from './topology.controller';
import { TopologyService } from './topology.service';
import { MikrotikClient } from './mikrotik.client';
import { SwosClient } from './swos.client';
import { ZteOltClient } from './zte-olt.client';
import { ZteOltSnmpClient } from './zte-olt-snmp.client';
import { HuaweiOltClient } from './huawei-olt.client';
import { HuaweiOltSnmpClient } from './huawei-olt-snmp.client';
import { MikrotikPollService } from './mikrotik-poll.service';
import { OnuMetricsPollService } from './onu-metrics-poll.service';
import { OnuPostProvisionVerifyService } from './onu-post-provision-verify.service';
import { OnuPostProvisionVerifyPollService } from './onu-post-provision-verify-poll.service';
import { OltInventoryPollService } from './olt-inventory-poll.service';
import { VpnService } from './vpn.service';
import { VpnController, VpnPublicController } from './vpn.controller';
import { VpnAdminController } from './vpn.admin.controller';
import { VpnInternalController } from './vpn.internal.controller';
import { Tr069Service } from './tr069.service';
import { Tr069Controller } from './tr069.controller';
import { OnuSettingsService } from './onu-settings.service';
import { OnuSettingsController } from './onu-settings.controller';
import { OnuCatalogAdminService } from './onu-catalog-admin.service';
import { OnuCatalogAdminController } from './onu-catalog-admin.controller';
import { OnuCatalogItem } from './entities/onu-catalog.entity';
import { OnuConnectedService } from './onu-connected.service';
import { OnuConnectedController } from './onu-connected.controller';
import { OnuMigrationService } from './onu-migration.service';
import { OnuMigrationController } from './onu-migration.controller';
import { OnuTypeOltSyncService } from './onu-type-olt-sync.service';
import { IpPoolService } from './ip-pool.service';
import { IpPoolController } from './ip-pool.controller';
import { OnuTr069ConfigService } from './onu-tr069-config.service';
import { ServiceVlanService } from './service-vlan.service';
import { ServiceVlanController } from './service-vlan.controller';
import { NetworkNodeService } from './network-node.service';
import { NetworkNodeController } from './network-node.controller';
import { SuspensionPortalService } from './suspension-portal.service';
import {
  SuspensionPortalController,
  SuspensionPortalLegacyController,
} from './suspension-portal.controller';
import { PlatformModule } from '../platform/platform.module';
import { SupportModule } from '../support/support.module';

@Module({
  imports: [
    DatabaseModule,
    AuthModule,
    PlatformModule,
    SupportModule,
    TypeOrmModule.forFeature([Tenant, OnuCatalogItem]),
  ],
  controllers: [
    TopologyController,
    VpnController,
    VpnPublicController,
    VpnAdminController,
    VpnInternalController,
    Tr069Controller,
    OnuSettingsController,
    OnuCatalogAdminController,
    OnuConnectedController,
    OnuMigrationController,
    IpPoolController,
    ServiceVlanController,
    NetworkNodeController,
    SuspensionPortalController,
    SuspensionPortalLegacyController,
  ],
  providers: [
    TopologyService,
    MikrotikClient,
    SwosClient,
    ZteOltClient,
    ZteOltSnmpClient,
    HuaweiOltClient,
    HuaweiOltSnmpClient,
    MikrotikPollService,
    OnuMetricsPollService,
    OnuPostProvisionVerifyService,
    OnuPostProvisionVerifyPollService,
    OltInventoryPollService,
    VpnService,
    Tr069Service,
    OnuCatalogAdminService,
    OnuSettingsService,
    OnuConnectedService,
    OnuMigrationService,
    OnuTypeOltSyncService,
    IpPoolService,
    OnuTr069ConfigService,
    ServiceVlanService,
    NetworkNodeService,
    SuspensionPortalService,
    TenantRolesGuard,
  ],
  exports: [
    TopologyService,
    VpnService,
    Tr069Service,
    OnuSettingsService,
    OnuCatalogAdminService,
    OnuConnectedService,
    OnuTypeOltSyncService,
    IpPoolService,
    OnuTr069ConfigService,
    ServiceVlanService,
    NetworkNodeService,
    SuspensionPortalService,
  ],
})
export class TopologyModule {}
