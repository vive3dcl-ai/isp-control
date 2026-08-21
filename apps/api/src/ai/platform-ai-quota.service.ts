import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { PlatformAiUsageDaily } from '../platform/entities/platform-ai-usage-daily.entity';
import { PlatformAiSettingsService } from './platform-ai-settings.service';
import { quotaBlockReason, utcUsageDate } from './platform-ai-quota.util';

export type AiQuotaSnapshot = {
  requestsUsed: number;
  requestsLimit: number;
  tokensUsed: number;
  tokensLimit: number;
  usageDate: string;
};

@Injectable()
export class PlatformAiQuotaService {
  private readonly logger = new Logger(PlatformAiQuotaService.name);
  private ensured = false;

  constructor(
    @InjectRepository(PlatformAiUsageDaily)
    private readonly usage: Repository<PlatformAiUsageDaily>,
    private readonly settings: PlatformAiSettingsService,
    private readonly dataSource: DataSource,
  ) {}

  private async ensureTable() {
    if (this.ensured) return;
    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS public.platform_ai_usage_daily (
        tenant_id uuid NOT NULL,
        usage_date date NOT NULL,
        request_count int NOT NULL DEFAULT 0,
        token_count int NOT NULL DEFAULT 0,
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (tenant_id, usage_date)
      );
    `);
    this.ensured = true;
  }

  utcToday(): string {
    return utcUsageDate();
  }

  async getSnapshot(tenantId: string): Promise<AiQuotaSnapshot> {
    await this.ensureTable();
    const row = await this.settings.getOrCreate();
    const usageDate = this.utcToday();
    const used = await this.usage.findOne({
      where: { tenantId, usageDate },
    });
    return {
      requestsUsed: used?.requestCount ?? 0,
      requestsLimit: row.dailyRequestLimit,
      tokensUsed: used?.tokenCount ?? 0,
      tokensLimit: row.dailyTokenLimit,
      usageDate,
    };
  }

  async assertCanConsume(
    tenantId: string,
    estimatedTokens = 0,
  ): Promise<AiQuotaSnapshot> {
    const snap = await this.getSnapshot(tenantId);
    const reason = quotaBlockReason(snap, estimatedTokens);
    if (reason) {
      throw new HttpException(
        `${reason}. Reintenta mañana (UTC) o usa tu propia API.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return snap;
  }

  async recordUsage(
    tenantId: string,
    opts: { requests?: number; tokens?: number },
  ): Promise<AiQuotaSnapshot> {
    await this.ensureTable();
    const usageDate = this.utcToday();
    const requests = Math.max(0, opts.requests ?? 1);
    const tokens = Math.max(0, opts.tokens ?? 0);

    await this.dataSource.query(
      `
      INSERT INTO public.platform_ai_usage_daily
        (tenant_id, usage_date, request_count, token_count, updated_at)
      VALUES ($1::uuid, $2::date, $3, $4, now())
      ON CONFLICT (tenant_id, usage_date) DO UPDATE SET
        request_count = public.platform_ai_usage_daily.request_count + EXCLUDED.request_count,
        token_count = public.platform_ai_usage_daily.token_count + EXCLUDED.token_count,
        updated_at = now()
      `,
      [tenantId, usageDate, requests, tokens],
    );

    this.logger.debug(
      `AI usage tenant=${tenantId} date=${usageDate} +req=${requests} +tok=${tokens}`,
    );
    return this.getSnapshot(tenantId);
  }
}
