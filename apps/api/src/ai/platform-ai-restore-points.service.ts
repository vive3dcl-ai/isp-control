import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { PlatformAiRestorePoint } from '../platform/entities/platform-ai-restore-point.entity';

export type RecordRestorePointInput = {
  tenantId: string;
  sessionId: string;
  toolSlug?: string;
  title: string;
  summary?: string;
  beforeState?: Record<string, unknown> | null;
  afterState?: Record<string, unknown> | null;
  undoPayload?: Record<string, unknown> | null;
};

@Injectable()
export class PlatformAiRestorePointsService {
  private readonly logger = new Logger(PlatformAiRestorePointsService.name);
  private ensured = false;

  constructor(
    @InjectRepository(PlatformAiRestorePoint)
    private readonly repo: Repository<PlatformAiRestorePoint>,
    private readonly dataSource: DataSource,
  ) {}

  private async ensureTable() {
    if (this.ensured) return;
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
        ON public.platform_ai_restore_points (tenant_id, session_id);
    `);
    this.ensured = true;
  }

  private serialize(row: PlatformAiRestorePoint) {
    return {
      id: row.id,
      sessionId: row.sessionId,
      toolSlug: row.toolSlug,
      title: row.title,
      summary: row.summary,
      status: row.status,
      hasUndo: !!row.undoPayload,
      createdAt: row.createdAt,
    };
  }

  async listForTenant(
    tenantId: string,
    opts?: { sessionId?: string; limit?: number },
  ) {
    await this.ensureTable();
    const qb = this.repo
      .createQueryBuilder('p')
      .where('p.tenant_id = :tenantId', { tenantId })
      .orderBy('p.created_at', 'DESC')
      .take(Math.min(opts?.limit ?? 50, 100));
    if (opts?.sessionId) {
      qb.andWhere('p.session_id = :sessionId', {
        sessionId: opts.sessionId,
      });
    }
    const rows = await qb.getMany();
    return rows.map((r) => this.serialize(r));
  }

  /**
   * Registra un cambio exacto del agente (llamar desde tools de escritura).
   */
  async record(input: RecordRestorePointInput) {
    await this.ensureTable();
    const title = input.title.trim();
    if (!title) throw new BadRequestException('title requerido');
    if (!input.sessionId?.trim()) {
      throw new BadRequestException('sessionId requerido');
    }
    const row = this.repo.create({
      tenantId: input.tenantId,
      sessionId: input.sessionId.trim(),
      toolSlug: (input.toolSlug ?? '').trim(),
      title: title.slice(0, 200),
      summary: (input.summary ?? '').trim(),
      beforeState: input.beforeState ?? null,
      afterState: input.afterState ?? null,
      undoPayload: input.undoPayload ?? null,
      status: 'active',
    });
    await this.repo.save(row);
    this.logger.log(
      `Restore point tenant=${input.tenantId} title=${row.title} id=${row.id}`,
    );
    return this.serialize(row);
  }

  /**
   * Marca el punto como restaurado. La aplicación del undo_payload
   * (ejecución real) se enchufa cuando existan tools de escritura.
   */
  async restore(tenantId: string, id: string) {
    await this.ensureTable();
    const row = await this.repo.findOne({ where: { id, tenantId } });
    if (!row) throw new NotFoundException('Punto de restauración no encontrado');
    if (row.status !== 'active') {
      throw new BadRequestException(
        `Este punto ya está en estado «${row.status}»`,
      );
    }
    if (!row.undoPayload) {
      throw new BadRequestException(
        'Este punto no tiene datos suficientes para deshacer el cambio',
      );
    }
    // Runtime de undo: pendiente de tool-calling. Por ahora solo se registra
    // la intención y se marca restored; el payload queda para auditoría.
    row.status = 'restored';
    await this.repo.save(row);
    this.logger.warn(
      `Restore requested tenant=${tenantId} id=${id} (undo runtime pendiente)`,
    );
    return {
      ok: true as const,
      id: row.id,
      title: row.title,
      undoPayload: row.undoPayload,
      message:
        'Punto marcado como restaurado. La reversión automática se completará cuando las tools de escritura estén activas.',
    };
  }
}
