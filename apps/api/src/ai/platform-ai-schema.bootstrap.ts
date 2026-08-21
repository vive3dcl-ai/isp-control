import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { PlatformAiCapabilitiesService } from './platform-ai-capabilities.service';

/**
 * DDL idempotente al arrancar la API (prod usa synchronize=false).
 * Cubre tablas/columnas del Asistente IA + seed de tools/skills built-in.
 */
@Injectable()
export class PlatformAiSchemaBootstrap implements OnModuleInit {
  private readonly logger = new Logger(PlatformAiSchemaBootstrap.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly capabilities: PlatformAiCapabilitiesService,
  ) {}

  async onModuleInit() {
    try {
      await this.ensureAll();
      await this.capabilities.ensureBuiltinTools(undefined, true);
      this.logger.log(
        'Schema Asistente IA listo (tablas + columna tenants + builtins)',
      );
    } catch (err) {
      this.logger.error(
        `No se pudo asegurar schema Asistente IA: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  async ensureAll() {
    await this.dataSource.query(
      `CREATE EXTENSION IF NOT EXISTS pgcrypto`,
    );

    await this.dataSource.query(`
      ALTER TABLE public.tenants
        ADD COLUMN IF NOT EXISTS ai_internal_enabled boolean NOT NULL DEFAULT true
    `);

    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS public.platform_ai_settings (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        enabled boolean NOT NULL DEFAULT false,
        provider varchar(40) NOT NULL DEFAULT 'openai',
        model varchar(120) NOT NULL DEFAULT 'gpt-4.1-mini',
        api_key text NOT NULL DEFAULT '',
        daily_request_limit int NOT NULL DEFAULT 100,
        daily_token_limit int NOT NULL DEFAULT 200000,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS public.platform_ai_usage_daily (
        tenant_id uuid NOT NULL,
        usage_date date NOT NULL,
        request_count int NOT NULL DEFAULT 0,
        token_count int NOT NULL DEFAULT 0,
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (tenant_id, usage_date)
      )
    `);

    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS public.platform_ai_capabilities (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        kind varchar(16) NOT NULL,
        slug varchar(80) NOT NULL UNIQUE,
        name varchar(120) NOT NULL,
        description text NOT NULL DEFAULT '',
        parameters_schema jsonb NULL,
        code text NOT NULL DEFAULT '',
        enabled boolean NOT NULL DEFAULT true,
        sort_order int NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_platform_ai_capabilities_kind_enabled
        ON public.platform_ai_capabilities (kind, enabled)
    `);

    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS public.platform_ai_restore_points (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL,
        session_id varchar(64) NOT NULL,
        tool_slug varchar(80) NOT NULL DEFAULT '',
        title varchar(200) NOT NULL,
        summary text NOT NULL DEFAULT '',
        before_state jsonb NULL,
        after_state jsonb NULL,
        undo_payload jsonb NULL,
        status varchar(20) NOT NULL DEFAULT 'active',
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_ai_restore_tenant_created
        ON public.platform_ai_restore_points (tenant_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_ai_restore_tenant_session
        ON public.platform_ai_restore_points (tenant_id, session_id)
    `);

    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS public.platform_ai_chat_sessions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL,
        user_id uuid NULL,
        session_id varchar(64) NOT NULL,
        title varchar(200) NOT NULL DEFAULT '',
        messages jsonb NOT NULL DEFAULT '[]'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (tenant_id, session_id)
      );
      CREATE INDEX IF NOT EXISTS idx_ai_chat_sessions_tenant_user_updated
        ON public.platform_ai_chat_sessions (tenant_id, user_id, updated_at DESC)
    `);
    await this.dataSource.query(`
      ALTER TABLE public.platform_ai_chat_sessions
        ADD COLUMN IF NOT EXISTS context_summary text NOT NULL DEFAULT ''
    `);
  }
}
