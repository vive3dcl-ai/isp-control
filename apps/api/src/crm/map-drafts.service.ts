import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { AuthUser } from '../auth/auth.types';
import { TenantMapDraft } from './entities/tenant-map-draft.entity';

@Injectable()
export class MapDraftsService {
  constructor(
    @InjectRepository(TenantMapDraft)
    private readonly drafts: Repository<TenantMapDraft>,
  ) {}

  private requireTenantId(user: AuthUser): string {
    if (!user.tenantId) throw new ForbiddenException('Tenant requerido');
    return user.tenantId;
  }

  async get(user: AuthUser) {
    const tenantId = this.requireTenantId(user);
    const row = await this.drafts.findOne({ where: { tenantId } });
    return {
      elements: Array.isArray(row?.elements) ? row.elements : [],
      updatedAt: row?.updatedAt?.toISOString() ?? null,
    };
  }

  async replace(user: AuthUser, elements: unknown[]) {
    const tenantId = this.requireTenantId(user);
    let row = await this.drafts.findOne({ where: { tenantId } });
    if (!row) {
      row = this.drafts.create({ tenantId, elements: [] });
    }
    row.elements = Array.isArray(elements) ? elements : [];
    const saved = await this.drafts.save(row);
    return {
      elements: saved.elements,
      updatedAt: saved.updatedAt.toISOString(),
    };
  }

  async upsertElement(user: AuthUser, element: Record<string, unknown>) {
    const tenantId = this.requireTenantId(user);
    const id =
      typeof element.id === 'string' || typeof element.id === 'number'
        ? String(element.id)
        : '';
    if (!id) {
      return this.get(user);
    }
    let row = await this.drafts.findOne({ where: { tenantId } });
    if (!row) {
      row = this.drafts.create({ tenantId, elements: [] });
    }
    const list = Array.isArray(row.elements)
      ? [...(row.elements as Record<string, unknown>[])]
      : [];
    const idx = list.findIndex((e) => e && String(e.id) === id);
    if (idx >= 0) list[idx] = { ...list[idx], ...element };
    else list.push(element);
    row.elements = list;
    const saved = await this.drafts.save(row);
    return {
      elements: saved.elements,
      updatedAt: saved.updatedAt.toISOString(),
    };
  }
}
