import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from './auth/auth.module';
import { TenantsModule } from './tenants/tenants.module';
import { DatabaseModule } from './database/database.module';
import { QueuesModule } from './queues/queues.module';
import { CrmModule } from './crm/crm.module';
import { TopologyModule } from './topology/topology.module';
import { BillingModule } from './billing/billing.module';
import { ModulesModule } from './modules/modules.module';
import { ClientPortalModule } from './client-portal/client-portal.module';
import { CalendarModule } from './calendar/calendar.module';
import { Tenant } from './tenants/entities/tenant.entity';
import { UserDirectory } from './tenants/entities/user-directory.entity';
import { PlatformAdmin } from './auth/entities/platform-admin.entity';
import { OnuCatalogItem } from './topology/entities/onu-catalog.entity';
import { PlatformPaymentMethod } from './modules/entities/platform-payment-method.entity';
import { PlatformModulePricing } from './modules/entities/platform-module-pricing.entity';
import { PlatformFxRate } from './modules/entities/platform-fx-rate.entity';
import { PlatformSmtpSettings } from './platform/entities/platform-smtp-settings.entity';
import { PlatformPublicUrls } from './platform/entities/platform-public-urls.entity';
import { PlatformSystemPlan } from './platform/entities/platform-system-plan.entity';
import { PlatformModuleContract } from './platform/entities/platform-module-contract.entity';
import { PlatformCharge } from './platform/entities/platform-charge.entity';
import { PlatformBranding } from './platform/entities/platform-branding.entity';
import { PlatformModule } from './platform/platform.module';
import { SupportModule } from './support/support.module';
import { SupportTicket } from './support/entities/support-ticket.entity';
import { SupportTicketMessage } from './support/entities/support-ticket-message.entity';
import { AppNotification } from './support/entities/app-notification.entity';
import { ClientPortalUser } from './client-portal/entities/client-portal-user.entity';
import { ClientPortalInvite } from './client-portal/entities/client-portal-invite.entity';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../../.env'],
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres' as const,
        host: config.get<string>('DATABASE_HOST', 'localhost'),
        port: Number(config.get<string>('DATABASE_PORT', '5432')),
        username: config.get<string>('DATABASE_USER', 'isp'),
        password: config.get<string>('DATABASE_PASSWORD', 'isp'),
        database: config.get<string>('DATABASE_NAME', 'isp_control'),
        schema: 'public',
        entities: [
          Tenant,
          UserDirectory,
          PlatformAdmin,
          OnuCatalogItem,
          PlatformPaymentMethod,
          PlatformModulePricing,
          PlatformFxRate,
          PlatformSmtpSettings,
          PlatformPublicUrls,
          PlatformSystemPlan,
          PlatformModuleContract,
          PlatformCharge,
          PlatformBranding,
          SupportTicket,
          SupportTicketMessage,
          AppNotification,
          ClientPortalUser,
          ClientPortalInvite,
        ],
        synchronize: true,
      }),
    }),
    DatabaseModule,
    QueuesModule,
    AuthModule,
    TenantsModule,
    CrmModule,
    TopologyModule,
    BillingModule,
    ModulesModule,
    PlatformModule,
    SupportModule,
    ClientPortalModule,
    CalendarModule,
  ],
})
export class AppModule {}
