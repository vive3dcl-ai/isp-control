import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types';
import { TenantConnectionService } from '../database/tenant-connection.service';
import { InventoryItem } from './entities/inventory-item.entity';
import {
  AdjustInventoryItemDto,
  CreateInventoryItemDto,
  UpdateInventoryItemDto,
  type InventoryItemTypeDto,
} from './dto/inventory.dto';

@Injectable()
export class InventoryService {
  constructor(private readonly tenantConnections: TenantConnectionService) {}

  private requireSchema(user: AuthUser): string {
    if (!user.schemaName) {
      throw new BadRequestException('Tenant schema missing from session');
    }
    return user.schemaName;
  }

  private serialize(row: InventoryItem) {
    return {
      id: row.id,
      type: row.type,
      brand: row.brand,
      model: row.model,
      quantity: row.quantity,
      notes: row.notes,
      isActive: row.isActive,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async list(
    user: AuthUser,
    opts?: { type?: InventoryItemTypeDto; inStock?: boolean },
  ) {
    const schema = this.requireSchema(user);
    const repo =
      await this.tenantConnections.getInventoryItemRepository(schema);
    const rows = await repo.find({
      order: { type: 'ASC', brand: 'ASC', model: 'ASC' },
    });
    return {
      items: rows
        .filter((r) => (opts?.type ? r.type === opts.type : true))
        .filter((r) => (opts?.inStock ? r.quantity > 0 && r.isActive : true))
        .map((r) => this.serialize(r)),
    };
  }

  async create(user: AuthUser, dto: CreateInventoryItemDto) {
    const schema = this.requireSchema(user);
    const repo =
      await this.tenantConnections.getInventoryItemRepository(schema);
    const brand = dto.brand.trim();
    const model = dto.model.trim();
    if (!brand || !model) {
      throw new BadRequestException('Marca y modelo son obligatorios');
    }
    const clash = await repo
      .createQueryBuilder('i')
      .where('i.type = :type', { type: dto.type })
      .andWhere('LOWER(i.brand) = LOWER(:brand)', { brand })
      .andWhere('LOWER(i.model) = LOWER(:model)', { model })
      .getOne();
    if (clash) {
      throw new BadRequestException(
        `Ya existe ${dto.type.toUpperCase()} ${brand} ${model} en inventario`,
      );
    }
    const row = await repo.save(
      repo.create({
        type: dto.type,
        brand,
        model,
        quantity: dto.quantity ?? 0,
        notes: dto.notes?.trim() ?? '',
        isActive: dto.isActive ?? true,
      }),
    );
    return this.serialize(row);
  }

  async update(user: AuthUser, id: string, dto: UpdateInventoryItemDto) {
    const schema = this.requireSchema(user);
    const repo =
      await this.tenantConnections.getInventoryItemRepository(schema);
    const row = await repo.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Ítem de inventario no encontrado');

    if (dto.brand !== undefined) row.brand = dto.brand.trim();
    if (dto.model !== undefined) row.model = dto.model.trim();
    if (dto.quantity !== undefined) {
      if (dto.quantity < 0) {
        throw new BadRequestException('La cantidad no puede ser negativa');
      }
      row.quantity = dto.quantity;
    }
    if (dto.notes !== undefined) row.notes = dto.notes.trim();
    if (dto.isActive !== undefined) row.isActive = dto.isActive;

    if (!row.brand || !row.model) {
      throw new BadRequestException('Marca y modelo son obligatorios');
    }

    const clash = await repo
      .createQueryBuilder('i')
      .where('i.type = :type', { type: row.type })
      .andWhere('LOWER(i.brand) = LOWER(:brand)', { brand: row.brand })
      .andWhere('LOWER(i.model) = LOWER(:model)', { model: row.model })
      .andWhere('i.id != :id', { id: row.id })
      .getOne();
    if (clash) {
      throw new BadRequestException(
        `Ya existe ${row.type.toUpperCase()} ${row.brand} ${row.model}`,
      );
    }

    return this.serialize(await repo.save(row));
  }

  async adjust(user: AuthUser, id: string, dto: AdjustInventoryItemDto) {
    if (!dto.delta || dto.delta === 0) {
      throw new BadRequestException('Delta debe ser distinto de 0');
    }
    const schema = this.requireSchema(user);
    const ds = await this.tenantConnections.getDataSource(schema);
    return ds.transaction(async (manager) => {
      const repo = manager.getRepository(InventoryItem);
      const row = await repo.findOne({ where: { id } });
      if (!row) throw new NotFoundException('Ítem de inventario no encontrado');
      const next = row.quantity + dto.delta;
      if (next < 0) {
        throw new BadRequestException(
          `Stock insuficiente (${row.brand} ${row.model}: ${row.quantity})`,
        );
      }
      row.quantity = next;
      if (dto.note?.trim()) {
        const stamp = new Date().toISOString().slice(0, 10);
        row.notes = [row.notes, `[${stamp}] ${dto.note.trim()}`]
          .filter(Boolean)
          .join('\n')
          .slice(0, 2000);
      }
      return this.serialize(await repo.save(row));
    });
  }

  async remove(user: AuthUser, id: string) {
    const schema = this.requireSchema(user);
    const repo =
      await this.tenantConnections.getInventoryItemRepository(schema);
    const row = await repo.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Ítem de inventario no encontrado');
    await repo.delete({ id });
    return { ok: true };
  }

  /**
   * Atomically decrement stock. Used when creating a client service.
   * Throws if missing or insufficient quantity.
   */
  async consume(
    schema: string,
    itemId: string,
    amount: number,
    expectedType?: InventoryItemTypeDto,
  ): Promise<void> {
    if (amount <= 0) return;
    await this.tenantConnections.ensureTenantSchema(schema);
    const ds = await this.tenantConnections.getDataSource(schema);
    const rows: Array<{ id: string }> = await ds.query(
      `UPDATE "${schema}"."inventory_items"
       SET quantity = quantity - $1, updated_at = now()
       WHERE id = $2
         AND is_active = true
         AND quantity >= $1
         AND ($3::text IS NULL OR type = $3)
       RETURNING id`,
      [amount, itemId, expectedType ?? null],
    );
    if (!rows?.length) {
      throw new BadRequestException(
        'Stock insuficiente o ítem de inventario no válido',
      );
    }
  }
}
