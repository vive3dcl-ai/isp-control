import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
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
import { PasswordResetToken } from './auth/entities/password-reset-token.entity';
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
import { PushSubscriptionEntity } from './support/entities/push-subscription.entity';
import { ClientPortalUser } from './client-portal/entities/client-portal-user.entity';
import { ClientPortalInvite } from './client-portal/entities/client-portal-invite.entity';
import { TenantMapDraft } from './crm/entities/tenant-map-draft.entity';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../../.env'],
    }),
    ThrottlerModule.forRoot([
      {
        ttl: 60_000,
        limit: 120,
      },
    ]),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const isProduction = config.get<string>('NODE_ENV') === 'production';
        const required = (name: string, fallback: string): string => {
          const value = config.get<string>(name)?.trim();
          if (isProduction && !value) {
            throw new Error(`${name} debe estar definido en producción`);
          }
          return value || fallback;
        };
        const synchronize =
          config.get<string>(
            'DATABASE_SYNCHRONIZE',
            isProduction ? 'false' : 'true',
          ) === 'true';

        return {
          type: 'postgres' as const,
          host: required('DATABASE_HOST', 'localhost'),
          port: Number(config.get<string>('DATABASE_PORT', '5432')),
          username: required('DATABASE_USER', 'isp'),
          password: required('DATABASE_PASSWORD', 'isp'),
          database: required('DATABASE_NAME', 'isp_control'),
          schema: 'public',
          entities: [
            Tenant,
            UserDirectory,
            PlatformAdmin,
            PasswordResetToken,
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
            PushSubscriptionEntity,
            ClientPortalUser,
            ClientPortalInvite,
            TenantMapDraft,
          ],
          synchronize,
        };
      },
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
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
