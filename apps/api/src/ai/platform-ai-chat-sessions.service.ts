import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { PlatformAiChatSession } from '../platform/entities/platform-ai-chat-session.entity';

export type ChatMessageRow = {
  role: string;
  content: string;
  id?: string;
  activities?: Array<Record<string, unknown>>;
};

@Injectable()
export class PlatformAiChatSessionsService {
  private ensured = false;

  constructor(
    @InjectRepository(PlatformAiChatSession)
    private readonly repo: Repository<PlatformAiChatSession>,
    private readonly dataSource: DataSource,
  ) {}

  private async ensureTable() {
    if (this.ensured) return;
    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS public.platform_ai_chat_sessions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL,
        user_id uuid NULL,
        session_id varchar(64) NOT NULL,
        title varchar(200) NOT NULL DEFAULT '',
        messages jsonb NOT NULL DEFAULT '[]'::jsonb,
        context_summary text NOT NULL DEFAULT '',
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (tenant_id, session_id)
      );
      ALTER TABLE public.platform_ai_chat_sessions
        ADD COLUMN IF NOT EXISTS context_summary text NOT NULL DEFAULT '';
      CREATE INDEX IF NOT EXISTS idx_ai_chat_sessions_tenant_user_updated
        ON public.platform_ai_chat_sessions (tenant_id, user_id, updated_at DESC);
    `);
    this.ensured = true;
  }

  private serializeList(row: PlatformAiChatSession) {
    return {
      sessionId: row.sessionId,
      title: row.title || 'Conversación',
      updatedAt: row.updatedAt,
      createdAt: row.createdAt,
      messageCount: Array.isArray(row.messages) ? row.messages.length : 0,
    };
  }

  private serializeDetail(row: PlatformAiChatSession) {
    return {
      ...this.serializeList(row),
      messages: Array.isArray(row.messages) ? row.messages : [],
      contextSummary: row.contextSummary || '',
    };
  }

  async listForUser(
    tenantId: string,
    userId: string | null | undefined,
    opts?: { limit?: number },
  ) {
    await this.ensureTable();
    const qb = this.repo
      .createQueryBuilder('s')
      .where('s.tenant_id = :tenantId', { tenantId })
      .orderBy('s.updated_at', 'DESC')
      .take(Math.min(opts?.limit ?? 40, 100));
    if (userId) {
      qb.andWhere('(s.user_id = :userId OR s.user_id IS NULL)', { userId });
    }
    const rows = await qb.getMany();
    return rows.map((r) => this.serializeList(r));
  }

  async get(
    tenantId: string,
    sessionId: string,
    userId?: string | null,
  ) {
    await this.ensureTable();
    const row = await this.repo.findOne({
      where: { tenantId, sessionId },
    });
    if (!row) throw new NotFoundException('Conversación no encontrada');
    if (userId && row.userId && row.userId !== userId) {
      throw new NotFoundException('Conversación no encontrada');
    }
    return this.serializeDetail(row);
  }

  async upsert(input: {
    tenantId: string;
    userId?: string | null;
    sessionId: string;
    messages: ChatMessageRow[];
    title?: string;
    contextSummary?: string;
  }) {
    await this.ensureTable();
    const sessionId = input.sessionId?.trim();
    if (!sessionId) throw new BadRequestException('sessionId requerido');
    const messages = (input.messages ?? [])
      .filter((m) => m?.role && typeof m.content === 'string')
      .slice(-80)
      .map((m) => ({
        role: m.role,
        content: m.content,
        ...(m.id ? { id: m.id } : {}),
        ...(Array.isArray(m.activities) && m.activities.length
          ? { activities: m.activities }
          : {}),
      }));

    let row = await this.repo.findOne({
      where: { tenantId: input.tenantId, sessionId },
    });
    const firstUser = messages.find((m) => m.role === 'user')?.content?.trim();
    const autoTitle = firstUser
      ? firstUser.slice(0, 80) + (firstUser.length > 80 ? '…' : '')
      : 'Conversación';

    if (!row) {
      row = this.repo.create({
        tenantId: input.tenantId,
        userId: input.userId ?? null,
        sessionId,
        title: input.title?.trim() || autoTitle,
        messages,
        contextSummary: (input.contextSummary ?? '').trim(),
      });
    } else {
      row.messages = messages;
      if (input.userId && !row.userId) row.userId = input.userId;
      if (!row.title?.trim()) row.title = input.title?.trim() || autoTitle;
      else if (input.title?.trim()) row.title = input.title.trim();
      if (typeof input.contextSummary === 'string') {
        row.contextSummary = input.contextSummary.trim();
      }
    }
    await this.repo.save(row);
    return this.serializeDetail(row);
  }

  async remove(
    tenantId: string,
    sessionId: string,
    userId?: string | null,
  ) {
    await this.ensureTable();
    const row = await this.repo.findOne({
      where: { tenantId, sessionId },
    });
    if (!row) throw new NotFoundException('Conversación no encontrada');
    if (userId && row.userId && row.userId !== userId) {
      throw new NotFoundException('Conversación no encontrada');
    }
    await this.repo.remove(row);
    return { ok: true as const };
  }
}
