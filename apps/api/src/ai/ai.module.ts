import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Tenant } from '../tenants/entities/tenant.entity';
import { DatabaseModule } from '../database/database.module';
import { PlatformAiSettings } from '../platform/entities/platform-ai-settings.entity';
import { PlatformAiUsageDaily } from '../platform/entities/platform-ai-usage-daily.entity';
import { PlatformAiCapability } from '../platform/entities/platform-ai-capability.entity';
import { PlatformAiRestorePoint } from '../platform/entities/platform-ai-restore-point.entity';
import { PlatformAiChatSession } from '../platform/entities/platform-ai-chat-session.entity';
import { AiProviderRouter } from './ai-provider.router';
import { PlatformAiQuotaService } from './platform-ai-quota.service';
import { PlatformAiSettingsService } from './platform-ai-settings.service';
import { PlatformAiCapabilitiesService } from './platform-ai-capabilities.service';
import { PlatformAiRestorePointsService } from './platform-ai-restore-points.service';
import { PlatformAiChatSessionsService } from './platform-ai-chat-sessions.service';
import { AiToolsService } from './ai-tools.service';
import { PlatformAiSchemaBootstrap } from './platform-ai-schema.bootstrap';

/**
 * Núcleo del Asistente IA.
 * No importa Topology/CRM: AiToolsService resuelve esos providers con ModuleRef
 * (strict:false) para evitar ciclos Platform→Ai→Topology→Crm→Billing→Modules→…
 */
@Module({
  imports: [
    DatabaseModule,
    TypeOrmModule.forFeature([
      Tenant,
      PlatformAiSettings,
      PlatformAiUsageDaily,
      PlatformAiCapability,
      PlatformAiRestorePoint,
      PlatformAiChatSession,
    ]),
  ],
  providers: [
    PlatformAiSchemaBootstrap,
    PlatformAiSettingsService,
    PlatformAiQuotaService,
    PlatformAiCapabilitiesService,
    PlatformAiRestorePointsService,
    PlatformAiChatSessionsService,
    AiToolsService,
    AiProviderRouter,
  ],
  exports: [
    PlatformAiSettingsService,
    PlatformAiQuotaService,
    PlatformAiCapabilitiesService,
    PlatformAiRestorePointsService,
    PlatformAiChatSessionsService,
    AiToolsService,
    AiProviderRouter,
  ],
})
export class AiModule {}
