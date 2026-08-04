import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Tenant } from '../tenants/entities/tenant.entity';
import { PlatformAdmin } from '../auth/entities/platform-admin.entity';
import { PlatformModulePricing } from '../modules/entities/platform-module-pricing.entity';
import { PlatformSmtpSettings } from './entities/platform-smtp-settings.entity';
import { PlatformPublicUrls } from './entities/platform-public-urls.entity';
import { PlatformSystemPlan } from './entities/platform-system-plan.entity';
import { PlatformBillingSettings } from './entities/platform-billing-settings.entity';
import { PlatformModuleContract } from './entities/platform-module-contract.entity';
import { PlatformCharge } from './entities/platform-charge.entity';
import { PlatformBranding } from './entities/platform-branding.entity';
import { PlatformSmtpService } from './platform-smtp.service';
import { PlatformPublicUrlsService } from './platform-public-urls.service';
import { PlatformMailerService } from './platform-mailer.service';
import { PlatformPlansService } from './platform-plans.service';
import { PlatformSubscriptionService } from './platform-subscription.service';
import { PlatformBrandingService } from './platform-branding.service';
import { ModuleExpiryScheduler } from './module-expiry.scheduler';
import { PlatformSettingsAdminController } from './platform-settings.admin.controller';
import { PlatformSubscriptionAppController } from './platform-subscription.app.controller';
import { PlatformBrandingPublicController } from './platform-branding.public.controller';
import { BackupAdminController } from './backup.admin.controller';
import { BackupService } from './backup.service';
import { DatabaseModule } from '../database/database.module';

@Module({
  imports: [
    DatabaseModule,
    TypeOrmModule.forFeature([
      Tenant,
      PlatformAdmin,
      PlatformModulePricing,
      PlatformSmtpSettings,
      PlatformPublicUrls,
      PlatformSystemPlan,
      PlatformBillingSettings,
      PlatformModuleContract,
      PlatformCharge,
      PlatformBranding,
    ]),
  ],
  controllers: [
    PlatformSettingsAdminController,
    PlatformSubscriptionAppController,
    PlatformBrandingPublicController,
    BackupAdminController,
  ],
  providers: [
    PlatformSmtpService,
    PlatformPublicUrlsService,
    PlatformMailerService,
    PlatformPlansService,
    PlatformSubscriptionService,
    PlatformBrandingService,
    ModuleExpiryScheduler,
    BackupService,
  ],
  exports: [
    PlatformSmtpService,
    PlatformPublicUrlsService,
    PlatformMailerService,
    PlatformPlansService,
    PlatformSubscriptionService,
    PlatformBrandingService,
  ],
})
export class PlatformModule {}
