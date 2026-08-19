import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { Tenant } from '../tenants/entities/tenant.entity';
import { TenantRolesGuard } from '../auth/guards/tenant-roles.guard';
import { TopologyController } from './topology.controller';
import { TopologyService } from './topology.service';
import { MikrotikClient } from './routers/mikrotik.client';
import { SwosClient } from './routers/swos.client';
import { ZteC3xxOltClient } from '../drivers/olt/zte/c3xx/cli';
import { ZteC3xxOltSnmpClient } from '../drivers/olt/zte/c3xx/snmp';
import { ZteTitanOltClient } from '../drivers/olt/zte/titan/cli';
import { ZteTitanOltSnmpClient } from '../drivers/olt/zte/titan/snmp';
import { HuaweiOltClient } from '../drivers/olt/huawei/huawei-olt.client';
import { HuaweiOltSnmpClient } from '../drivers/olt/huawei/huawei-olt-snmp.client';
import { MikrotikPollService } from './routers/mikrotik-poll.service';
import { OnuMetricsPollService } from './onus/onu-metrics-poll.service';
import { OnuPostProvisionVerifyService } from './onus/onu-post-provision-verify.service';
import { OnuPostProvisionVerifyPollService } from './onus/onu-post-provision-verify-poll.service';
import { OltInventoryPollService } from './olts/olt-inventory-poll.service';
import { VpnService } from './vpn.service';
import { VpnController, VpnPublicController } from './vpn.controller';
import { VpnAdminController } from './vpn.admin.controller';
import { VpnInternalController } from './vpn.internal.controller';
import { Tr069Service } from './onus/tr069.service';
import { Tr069Controller } from './onus/tr069.controller';
import { OnuSettingsService } from './onus/onu-settings.service';
import { OnuSettingsController } from './onus/onu-settings.controller';
import { OnuCatalogAdminService } from './onus/onu-catalog-admin.service';
import { OnuCatalogAdminController } from './onus/onu-catalog-admin.controller';
import { OnuCatalogItem } from './shared/entities/onu-catalog.entity';
import { OnuConnectedService } from './onus/onu-connected.service';
import { OnuConnectedController } from './onus/onu-connected.controller';
import { OnuMigrationService } from './onus/onu-migration.service';
import { OnuMigrationController } from './onus/onu-migration.controller';
import { OnuTypeOltSyncService } from './onus/onu-type-olt-sync.service';
import { IpPoolService } from './routers/ip-pool.service';
import { IpPoolController } from './routers/ip-pool.controller';
import { OnuTr069ConfigService } from './onus/onu-tr069-config.service';
import { OnuAcsDriverCatalogService } from './onus/onu-acs-driver-catalog.service';
import { NetworkAuditService } from './onus/network-audit.service';
import { NetworkAlarmService } from './onus/network-alarm.service';
import { ServiceVlanService } from './olts/service-vlan.service';
import { ServiceVlanController } from './olts/service-vlan.controller';
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
    ZteC3xxOltClient,
    ZteC3xxOltSnmpClient,
    ZteTitanOltClient,
    ZteTitanOltSnmpClient,
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
    OnuAcsDriverCatalogService,
    NetworkAuditService,
    NetworkAlarmService,
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
    OnuAcsDriverCatalogService,
    NetworkAuditService,
    NetworkAlarmService,
    ServiceVlanService,
    NetworkNodeService,
    SuspensionPortalService,
  ],
})
export class TopologyModule {}
