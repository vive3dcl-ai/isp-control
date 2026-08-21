import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import {
  PlatformAiCapability,
  type PlatformAiCapabilityKind,
} from '../platform/entities/platform-ai-capability.entity';
import {
  CreatePlatformAiCapabilityDto,
  UpdatePlatformAiCapabilityDto,
} from '../platform/dto/platform-ai-capability.dto';
import { BUILTIN_AI_TOOLS, BUILTIN_AI_SKILLS } from './ai-tools.catalog';

@Injectable()
export class PlatformAiCapabilitiesService {
  private readonly logger = new Logger(PlatformAiCapabilitiesService.name);
  private ensured = false;
  private builtinsEnsured = false;

  constructor(
    @InjectRepository(PlatformAiCapability)
    private readonly repo: Repository<PlatformAiCapability>,
    private readonly dataSource: DataSource,
  ) {}

  private async ensureTable() {
    if (this.ensured) return;
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
        ON public.platform_ai_capabilities (kind, enabled);
    `);
    this.ensured = true;
  }

  private serialize(row: PlatformAiCapability) {
    return {
      id: row.id,
      kind: row.kind,
      slug: row.slug,
      name: row.name,
      description: row.description,
      parametersSchema: row.parametersSchema,
      code: row.code,
      enabled: row.enabled,
      sortOrder: row.sortOrder,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  /** Lista admin (incluye deshabilitados y código completo). */
  async listAdmin(kind?: PlatformAiCapabilityKind) {
    await this.ensureTable();
    await this.ensureBuiltinTools();
    const where = kind ? { kind } : {};
    const rows = await this.repo.find({
      where,
      order: { sortOrder: 'ASC', name: 'ASC' },
    });
    return rows.map((r) => this.serialize(r));
  }

  async getAdmin(id: string) {
    await this.ensureTable();
    const row = await this.repo.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Capability no encontrada');
    return this.serialize(row);
  }

  async create(dto: CreatePlatformAiCapabilityDto) {
    await this.ensureTable();
    const slug = dto.slug.trim().toLowerCase();
    const existing = await this.repo.findOne({ where: { slug } });
    if (existing) {
      throw new BadRequestException(`Ya existe un item con slug "${slug}"`);
    }
    if (dto.kind === 'tool' && dto.parametersSchema == null) {
      // schema vacío permitido; se guarda como object
    }
    const row = this.repo.create({
      kind: dto.kind,
      slug,
      name: dto.name.trim(),
      description: (dto.description ?? '').trim(),
      parametersSchema:
        dto.kind === 'tool'
          ? (dto.parametersSchema ?? { type: 'object', properties: {} })
          : null,
      code: dto.code ?? '',
      enabled: dto.enabled ?? true,
      sortOrder: dto.sortOrder ?? 0,
    });
    await this.repo.save(row);
    this.logger.log(`AI capability created kind=${row.kind} slug=${row.slug}`);
    return this.serialize(row);
  }

  async update(id: string, dto: UpdatePlatformAiCapabilityDto) {
    await this.ensureTable();
    const row = await this.repo.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Capability no encontrada');
    if (dto.name != null) row.name = dto.name.trim();
    if (dto.description != null) row.description = dto.description.trim();
    if (dto.code != null) row.code = dto.code;
    if (dto.enabled != null) row.enabled = dto.enabled;
    if (dto.sortOrder != null) row.sortOrder = dto.sortOrder;
    if (dto.parametersSchema !== undefined) {
      if (row.kind === 'skill') {
        row.parametersSchema = null;
      } else {
        row.parametersSchema = dto.parametersSchema;
      }
    }
    await this.repo.save(row);
    this.logger.log(`AI capability updated slug=${row.slug} enabled=${row.enabled}`);
    return this.serialize(row);
  }

  async remove(id: string) {
    await this.ensureTable();
    const row = await this.repo.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Capability no encontrada');
    await this.repo.remove(row);
    this.logger.log(`AI capability deleted slug=${row.slug}`);
    return { ok: true as const };
  }

  /**
   * Lista para agentes de tenant: solo enabled.
   * Asegura tools built-in (ONU verify) en el catálogo.
   */
  async listActiveForAgent() {
    await this.ensureTable();
    await this.ensureBuiltinTools();
    const rows = await this.repo.find({
      where: { enabled: true },
      order: { kind: 'ASC', sortOrder: 'ASC', name: 'ASC' },
    });
    const tools = rows
      .filter((r) => r.kind === 'tool')
      .map((r) => ({
        id: r.id,
        slug: r.slug,
        name: r.name,
        description: r.description,
        parametersSchema: r.parametersSchema,
        code: r.code,
      }));
    const skills = rows
      .filter((r) => r.kind === 'skill')
      .map((r) => ({
        id: r.id,
        slug: r.slug,
        name: r.name,
        description: r.description,
        code: r.code,
      }));
    return { tools, skills };
  }

  /**
   * Idempotente: crea/actualiza metadata de tools built-in + skills guía.
   * El `code` de tools apunta al handler tipado (no se evalúa).
   * @param force si true, reescribe metadata aunque ya se haya corrido en este proceso.
   */
  async ensureBuiltinTools(
    builtins?: Array<{
      slug: string;
      name: string;
      description: string;
      parametersSchema: Record<string, unknown>;
      sortOrder: number;
    }>,
    force = false,
  ) {
    await this.ensureTable();
    if (force) this.builtinsEnsured = false;
    if (!builtins) {
      if (this.builtinsEnsured) {
        const missingTools = await Promise.all(
          BUILTIN_AI_TOOLS.map(async (t) => {
            const row = await this.repo.findOne({ where: { slug: t.slug } });
            return row ? null : t.slug;
          }),
        );
        const missingSkills = await Promise.all(
          BUILTIN_AI_SKILLS.map(async (s) => {
            const row = await this.repo.findOne({ where: { slug: s.slug } });
            return row ? null : s.slug;
          }),
        );
        if (!missingTools.some(Boolean) && !missingSkills.some(Boolean)) {
          return;
        }
        this.builtinsEnsured = false;
      }
    }

    const tools = builtins ?? BUILTIN_AI_TOOLS;

    for (const t of tools) {
      let row = await this.repo.findOne({ where: { slug: t.slug } });
      if (!row) {
        row = this.repo.create({
          kind: 'tool',
          slug: t.slug,
          name: t.name,
          description: t.description,
          parametersSchema: t.parametersSchema,
          code: `builtin:${t.slug}`,
          enabled: true,
          sortOrder: t.sortOrder,
        });
      } else if (row.code.startsWith('builtin:') || !row.code) {
        row.name = t.name;
        row.description = t.description;
        row.parametersSchema = t.parametersSchema;
        row.code = `builtin:${t.slug}`;
        row.sortOrder = t.sortOrder;
      }
      await this.repo.save(row);
    }

    for (const skillDef of BUILTIN_AI_SKILLS) {
      let skill = await this.repo.findOne({ where: { slug: skillDef.slug } });
      if (!skill) {
        skill = this.repo.create({
          kind: 'skill',
          slug: skillDef.slug,
          name: skillDef.name,
          description: skillDef.description,
          parametersSchema: null,
          code: skillDef.code,
          enabled: true,
          sortOrder: skillDef.sortOrder,
        });
        await this.repo.save(skill);
      } else if (
        !skill.code ||
        BUILTIN_AI_SKILLS.some((s) => s.slug === skill!.slug)
      ) {
        skill.name = skillDef.name;
        skill.description = skillDef.description;
        skill.code = skillDef.code;
        skill.sortOrder = skillDef.sortOrder;
        await this.repo.save(skill);
      }
    }

    if (!builtins) this.builtinsEnsured = true;
  }
}
