import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { Repository } from 'typeorm';
import type { AuthUser } from '../auth/auth.types';
import type { TenantUserRole } from '../auth/roles';
import { TENANT_ROLES } from '../auth/roles';
import { PlatformAdmin } from '../auth/entities/platform-admin.entity';
import { TenantConnectionService } from '../database/tenant-connection.service';
import { TenantUser } from '../tenant/entities/tenant-user.entity';
import { UserDirectory } from './entities/user-directory.entity';
import type {
  CreateTenantUserDto,
  UpdateTenantUserDto,
} from './dto/tenant-user.dto';

@Injectable()
export class TenantUsersService {
  constructor(
    private readonly tenantConnections: TenantConnectionService,
    @InjectRepository(UserDirectory)
    private readonly directory: Repository<UserDirectory>,
    @InjectRepository(PlatformAdmin)
    private readonly platformAdmins: Repository<PlatformAdmin>,
  ) {}

  private requireSchema(user: AuthUser): string {
    if (!user.schemaName) {
      throw new BadRequestException('Tenant schema missing from session');
    }
    return user.schemaName;
  }

  private requireTenantId(user: AuthUser): string {
    if (!user.tenantId) {
      throw new BadRequestException('Tenant missing from session');
    }
    return user.tenantId;
  }

  private serialize(u: TenantUser) {
    return {
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role as TenantUserRole,
      isActive: u.isActive,
      createdAt: u.createdAt,
      updatedAt: u.updatedAt,
    };
  }

  private normalizeEmail(email: string) {
    return email.toLowerCase().trim();
  }

  private assertValidRole(role: string): asserts role is TenantUserRole {
    if (!(TENANT_ROLES as readonly string[]).includes(role)) {
      throw new BadRequestException('Rol inválido');
    }
  }

  private async assertEmailAvailable(
    email: string,
    excludeDirectoryEmail?: string,
  ) {
    const asAdmin = await this.platformAdmins.findOne({ where: { email } });
    if (asAdmin) {
      throw new ConflictException('El email ya está registrado');
    }
    const inDirectory = await this.directory.findOne({ where: { email } });
    if (
      inDirectory &&
      (!excludeDirectoryEmail || inDirectory.email !== excludeDirectoryEmail)
    ) {
      throw new ConflictException('El email ya está registrado');
    }
  }

  private async countOwners(
    repo: Repository<TenantUser>,
    excludeId?: string,
  ) {
    const qb = repo
      .createQueryBuilder('u')
      .where('u.role = :role', { role: 'owner' })
      .andWhere('u.isActive = true');
    if (excludeId) {
      qb.andWhere('u.id != :excludeId', { excludeId });
    }
    return qb.getCount();
  }

  async list(user: AuthUser) {
    const repo = await this.tenantConnections.getUserRepository(
      this.requireSchema(user),
    );
    const rows = await repo.find({
      order: { createdAt: 'ASC' },
    });
    return rows.map((u) => this.serialize(u));
  }

  async create(user: AuthUser, dto: CreateTenantUserDto) {
    const schema = this.requireSchema(user);
    const tenantId = this.requireTenantId(user);
    this.assertValidRole(dto.role);

    if (dto.role === 'owner' && user.tenantRole !== 'owner') {
      throw new ForbiddenException('Solo el dueño puede crear otro dueño');
    }

    const email = this.normalizeEmail(dto.email);
    await this.assertEmailAvailable(email);

    const repo = await this.tenantConnections.getUserRepository(schema);
    const existing = await repo.findOne({ where: { email } });
    if (existing) {
      throw new ConflictException('El email ya existe en la empresa');
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);
    const created = await repo.save(
      repo.create({
        email,
        name: dto.name.trim(),
        role: dto.role,
        passwordHash,
        isActive: true,
      }),
    );

    await this.directory.save(
      this.directory.create({
        email,
        tenantId,
        role: dto.role,
      }),
    );

    return this.serialize(created);
  }

  async update(user: AuthUser, id: string, dto: UpdateTenantUserDto) {
    const schema = this.requireSchema(user);
    const tenantId = this.requireTenantId(user);
    const repo = await this.tenantConnections.getUserRepository(schema);
    const row = await repo.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Usuario no encontrado');

    const previousEmail = row.email;

    if (dto.role !== undefined) {
      this.assertValidRole(dto.role);
      if (dto.role === 'owner' && user.tenantRole !== 'owner') {
        throw new ForbiddenException('Solo el dueño puede asignar rol dueño');
      }
      if (
        row.role === 'owner' &&
        dto.role !== 'owner' &&
        (await this.countOwners(repo, row.id)) < 1
      ) {
        throw new BadRequestException(
          'Debe quedar al menos un dueño activo en la empresa',
        );
      }
      row.role = dto.role;
    }

    if (dto.name !== undefined) {
      row.name = dto.name.trim();
    }

    if (dto.email !== undefined) {
      const email = this.normalizeEmail(dto.email);
      if (email !== row.email) {
        await this.assertEmailAvailable(email, previousEmail);
        const clash = await repo.findOne({ where: { email } });
        if (clash && clash.id !== row.id) {
          throw new ConflictException('El email ya existe en la empresa');
        }
        row.email = email;
      }
    }

    if (dto.isActive !== undefined) {
      if (
        !dto.isActive &&
        row.role === 'owner' &&
        (await this.countOwners(repo, row.id)) < 1
      ) {
        throw new BadRequestException(
          'No se puede desactivar al único dueño activo',
        );
      }
      if (!dto.isActive && row.id === user.sub) {
        throw new BadRequestException('No puedes desactivarte a ti mismo');
      }
      row.isActive = dto.isActive;
    }

    if (dto.password) {
      row.passwordHash = await bcrypt.hash(dto.password, 10);
    }

    const saved = await repo.save(row);

    const dir = await this.directory.findOne({
      where: { email: previousEmail, tenantId },
    });
    if (dir) {
      dir.email = saved.email;
      dir.role = saved.role as TenantUserRole;
      await this.directory.save(dir);
      if (!saved.isActive) {
        await this.directory.delete({ id: dir.id });
      }
    } else if (saved.isActive) {
      await this.directory.save(
        this.directory.create({
          email: saved.email,
          tenantId,
          role: saved.role as TenantUserRole,
        }),
      );
    }

    return this.serialize(saved);
  }

  async remove(user: AuthUser, id: string) {
    const schema = this.requireSchema(user);
    const tenantId = this.requireTenantId(user);
    const repo = await this.tenantConnections.getUserRepository(schema);
    const row = await repo.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Usuario no encontrado');

    if (row.id === user.sub) {
      throw new BadRequestException('No puedes eliminar tu propio usuario');
    }
    if (
      row.role === 'owner' &&
      (await this.countOwners(repo, row.id)) < 1
    ) {
      throw new BadRequestException(
        'No se puede eliminar al único dueño activo',
      );
    }

    await this.directory.delete({ email: row.email, tenantId });
    await repo.remove(row);
    return { ok: true };
  }
}
