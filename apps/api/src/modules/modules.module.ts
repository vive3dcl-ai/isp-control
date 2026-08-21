import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Tenant } from '../tenants/entities/tenant.entity';
import { DatabaseModule } from '../database/database.module';
import { ModulesService } from './modules.service';
import { PlatformPaymentsService } from './platform-payments.service';
import { TenantMailerService } from './tenant-mailer.service';
import { ModulesAdminController } from './modules.admin.controller';
import { ModulesAppController } from './modules.app.controller';
import { PlatformPaymentsAdminController } from './platform-payments.admin.controller';
import { PlatformPaymentMethod } from './entities/platform-payment-method.entity';
import { PlatformModulePricing } from './entities/platform-module-pricing.entity';
import { PlatformFxRate } from './entities/platform-fx-rate.entity';
import { FxService } from './fx.service';
import { PlatformModule } from '../platform/platform.module';
import { AiModule } from '../ai/ai.module';
import { WhatsAppBaileysClient } from './whatsapp-baileys.client';
import { WhatsAppBaileysInternalController } from './whatsapp-baileys.internal.controller';
import { TenantWhatsAppService } from './tenant-whatsapp.service';

@Module({
  imports: [
    DatabaseModule,
    forwardRef(() => PlatformModule),
    AiModule,
    TypeOrmModule.forFeature([
      Tenant,
      PlatformPaymentMethod,
      PlatformModulePricing,
      PlatformFxRate,
    ]),
  ],
  controllers: [
    ModulesAdminController,
    ModulesAppController,
    PlatformPaymentsAdminController,
    WhatsAppBaileysInternalController,
  ],
  providers: [
    ModulesService,
    PlatformPaymentsService,
    FxService,
    TenantMailerService,
    WhatsAppBaileysClient,
    TenantWhatsAppService,
  ],
  exports: [
    ModulesService,
    PlatformPaymentsService,
    FxService,
    TenantMailerService,
    WhatsAppBaileysClient,
    TenantWhatsAppService,
  ],
})
export class ModulesModule {}
