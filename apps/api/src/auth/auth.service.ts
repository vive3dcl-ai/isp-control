import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { Repository } from 'typeorm';
import { PlatformAdmin } from './entities/platform-admin.entity';
import { UserDirectory } from '../tenants/entities/user-directory.entity';
import { Tenant } from '../tenants/entities/tenant.entity';
import { TenantConnectionService } from '../database/tenant-connection.service';
import { LoginDto } from './dto/login.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { AuthUser, JwtPayload, LoginResponse } from './auth.types';
import { isPlatformRole, type PlatformRole, type TenantUserRole } from './roles';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(PlatformAdmin)
    private readonly platformAdmins: Repository<PlatformAdmin>,
    @InjectRepository(UserDirectory)
    private readonly userDirectory: Repository<UserDirectory>,
    @InjectRepository(Tenant)
    private readonly tenants: Repository<Tenant>,
    private readonly tenantConnections: TenantConnectionService,
    private readonly jwt: JwtService,
  ) {}

  async login(dto: LoginDto): Promise<LoginResponse> {
    const email = dto.email.toLowerCase().trim();
    const remember = !!dto.remember;
    const mobileOnly = dto.channel === 'mobile';
    const signOpts = remember ? { expiresIn: '30d' as const } : undefined;

    const admin = await this.platformAdmins.findOne({ where: { email } });
    if (admin) {
      if (mobileOnly) {
        throw new ForbiddenException(
          'El acceso móvil es solo para usuarios de empresa. Usa el panel web.',
        );
      }
      const valid = await bcrypt.compare(dto.password, admin.passwordHash);
      if (!valid) {
        throw new UnauthorizedException('Invalid credentials');
      }

      const role = this.resolvePlatformRole(admin.role);
      const payload: JwtPayload = {
        sub: admin.id,
        email: admin.email,
        name: admin.name,
        role,
      };

      return {
        accessToken: await this.jwt.signAsync(payload, signOpts),
        redirectTo: '/admin',
        user: {
          id: admin.id,
          email: admin.email,
          name: admin.name,
          role,
        },
      };
    }

    const directory = await this.userDirectory.findOne({
      where: { email },
      relations: { tenant: true },
    });

    if (!directory || !directory.tenant) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const tenant = directory.tenant;
    if (tenant.status !== 'active') {
      throw new UnauthorizedException('Tenant is not active');
    }

    const users = await this.tenantConnections.getUserRepository(
      tenant.schemaName,
    );
    const tenantUser = await users.findOne({ where: { email } });

    if (!tenantUser || !tenantUser.isActive) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const valid = await bcrypt.compare(dto.password, tenantUser.passwordHash);
    if (!valid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const payload: JwtPayload = {
      sub: tenantUser.id,
      email: tenantUser.email,
      name: tenantUser.name,
      role: 'tenant_user',
      tenantId: tenant.id,
      tenantSlug: tenant.slug,
      schemaName: tenant.schemaName,
      tenantRole: tenantUser.role,
    };

    return {
      accessToken: await this.jwt.signAsync(payload, signOpts),
      redirectTo: mobileOnly ? '/movil' : '/app',
      user: {
        id: tenantUser.id,
        email: tenantUser.email,
        name: tenantUser.name,
        role: 'tenant_user',
        tenantId: tenant.id,
        tenantSlug: tenant.slug,
        tenantRole: tenantUser.role,
      },
    };
  }

  async me(user: AuthUser) {
    if (isPlatformRole(user.role)) {
      const admin = await this.platformAdmins.findOne({
        where: { id: user.sub },
      });
      if (!admin) {
        throw new UnauthorizedException();
      }
      const role = this.resolvePlatformRole(admin.role);
      return {
        id: admin.id,
        email: admin.email,
        name: admin.name,
        role,
        redirectTo: '/admin' as const,
      };
    }

    if (!user.schemaName || !user.tenantId) {
      throw new UnauthorizedException();
    }

    const users = await this.tenantConnections.getUserRepository(
      user.schemaName,
    );
    const tenantUser = await users.findOne({ where: { id: user.sub } });
    if (!tenantUser) {
      throw new UnauthorizedException();
    }
    if (!tenantUser.isActive && !user.impersonatedBy) {
      throw new UnauthorizedException();
    }

    const tenant = await this.tenants.findOne({
      where: { id: user.tenantId },
    });

    return {
      id: tenantUser.id,
      email: tenantUser.email,
      name: tenantUser.name,
      role: 'tenant_user' as const,
      tenantId: user.tenantId,
      tenantSlug: tenant?.slug,
      tenantRole: user.impersonatedBy ? 'owner' : tenantUser.role,
      impersonatedBy: user.impersonatedBy,
      impersonatorEmail: user.impersonatorEmail,
      redirectTo: '/app' as const,
    };
  }

  async updateProfile(
    user: AuthUser,
    dto: UpdateProfileDto,
  ): Promise<LoginResponse> {
    this.assertNotImpersonating(user);

    const name =
      dto.name !== undefined ? dto.name.trim() : undefined;
    const email =
      dto.email !== undefined
        ? dto.email.toLowerCase().trim()
        : undefined;

    if (name === undefined && email === undefined) {
      throw new BadRequestException('No hay cambios para guardar');
    }
    if (name !== undefined && name.length < 2) {
      throw new BadRequestException('El nombre es demasiado corto');
    }

    if (isPlatformRole(user.role)) {
      const admin = await this.platformAdmins.findOne({
        where: { id: user.sub },
      });
      if (!admin) throw new UnauthorizedException();

      if (email !== undefined && email !== admin.email) {
        await this.assertEmailAvailable(email, admin.email);
        admin.email = email;
      }
      if (name !== undefined) {
        admin.name = name;
      }
      await this.platformAdmins.save(admin);

      const role = this.resolvePlatformRole(admin.role);
      const payload: JwtPayload = {
        sub: admin.id,
        email: admin.email,
        name: admin.name,
        role,
      };
      return {
        accessToken: await this.jwt.signAsync(payload),
        redirectTo: '/admin',
        user: {
          id: admin.id,
          email: admin.email,
          name: admin.name,
          role,
        },
      };
    }

    if (!user.schemaName || !user.tenantId) {
      throw new UnauthorizedException();
    }

    const users = await this.tenantConnections.getUserRepository(
      user.schemaName,
    );
    const tenantUser = await users.findOne({ where: { id: user.sub } });
    if (!tenantUser || !tenantUser.isActive) {
      throw new UnauthorizedException();
    }

    const previousEmail = tenantUser.email;
    if (email !== undefined && email !== tenantUser.email) {
      await this.assertEmailAvailable(email, previousEmail);
      const clash = await users.findOne({ where: { email } });
      if (clash && clash.id !== tenantUser.id) {
        throw new ConflictException('El email ya existe en la empresa');
      }
      tenantUser.email = email;
    }
    if (name !== undefined) {
      tenantUser.name = name;
    }
    await users.save(tenantUser);

    const dir = await this.userDirectory.findOne({
      where: { email: previousEmail, tenantId: user.tenantId },
    });
    if (dir) {
      dir.email = tenantUser.email;
      await this.userDirectory.save(dir);
    }

    const tenant = await this.tenants.findOne({
      where: { id: user.tenantId },
    });
    const tenantRole = (tenantUser.role ||
      user.tenantRole ||
      'user') as TenantUserRole;

    const payload: JwtPayload = {
      sub: tenantUser.id,
      email: tenantUser.email,
      name: tenantUser.name,
      role: 'tenant_user',
      tenantId: user.tenantId,
      tenantSlug: tenant?.slug,
      schemaName: user.schemaName,
      tenantRole,
    };

    return {
      accessToken: await this.jwt.signAsync(payload),
      redirectTo: '/app',
      user: {
        id: tenantUser.id,
        email: tenantUser.email,
        name: tenantUser.name,
        role: 'tenant_user',
        tenantId: user.tenantId,
        tenantSlug: tenant?.slug,
        tenantRole,
      },
    };
  }

  async changePassword(user: AuthUser, dto: ChangePasswordDto) {
    this.assertNotImpersonating(user);

    if (dto.newPassword.length < 8) {
      throw new BadRequestException(
        'La nueva contraseña debe tener al menos 8 caracteres',
      );
    }
    if (dto.currentPassword === dto.newPassword) {
      throw new BadRequestException(
        'La nueva contraseña debe ser distinta a la actual',
      );
    }

    if (isPlatformRole(user.role)) {
      const admin = await this.platformAdmins.findOne({
        where: { id: user.sub },
      });
      if (!admin) throw new UnauthorizedException();
      const valid = await bcrypt.compare(
        dto.currentPassword,
        admin.passwordHash,
      );
      if (!valid) {
        throw new BadRequestException('La contraseña actual no es correcta');
      }
      admin.passwordHash = await bcrypt.hash(dto.newPassword, 10);
      await this.platformAdmins.save(admin);
      return { ok: true as const };
    }

    if (!user.schemaName) {
      throw new UnauthorizedException();
    }
    const users = await this.tenantConnections.getUserRepository(
      user.schemaName,
    );
    const tenantUser = await users.findOne({ where: { id: user.sub } });
    if (!tenantUser || !tenantUser.isActive) {
      throw new UnauthorizedException();
    }
    const valid = await bcrypt.compare(
      dto.currentPassword,
      tenantUser.passwordHash,
    );
    if (!valid) {
      throw new BadRequestException('La contraseña actual no es correcta');
    }
    tenantUser.passwordHash = await bcrypt.hash(dto.newPassword, 10);
    await users.save(tenantUser);
    return { ok: true as const };
  }

  /**
   * Platform staff enters a tenant as owner (full privileges).
   * The returned JWT includes impersonation metadata for "return to admin".
   */
  async impersonateTenant(
    admin: AuthUser,
    tenantId: string,
  ): Promise<LoginResponse> {
    if (!isPlatformRole(admin.role)) {
      throw new ForbiddenException('Only platform staff can impersonate');
    }

    const tenant = await this.tenants.findOne({ where: { id: tenantId } });
    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }

    let ownerEntry = await this.userDirectory.findOne({
      where: { tenantId, role: 'owner' },
    });
    if (!ownerEntry) {
      ownerEntry = await this.userDirectory.findOne({
        where: { tenantId },
        order: { createdAt: 'ASC' },
      });
    }
    if (!ownerEntry) {
      throw new NotFoundException('Tenant has no users to impersonate');
    }

    const users = await this.tenantConnections.getUserRepository(
      tenant.schemaName,
    );
    const tenantUser = await users.findOne({
      where: { email: ownerEntry.email },
    });
    if (!tenantUser) {
      throw new NotFoundException('Owner user not found in tenant schema');
    }

    const payload: JwtPayload = {
      sub: tenantUser.id,
      email: tenantUser.email,
      name: tenantUser.name,
      role: 'tenant_user',
      tenantId: tenant.id,
      tenantSlug: tenant.slug,
      schemaName: tenant.schemaName,
      tenantRole: 'owner',
      impersonatedBy: admin.sub,
      impersonatorEmail: admin.email,
    };

    return {
      accessToken: await this.jwt.signAsync(payload),
      redirectTo: '/app',
      user: {
        id: tenantUser.id,
        email: tenantUser.email,
        name: tenantUser.name,
        role: 'tenant_user',
        tenantId: tenant.id,
        tenantSlug: tenant.slug,
        tenantRole: 'owner',
        impersonatedBy: admin.sub,
        impersonatorEmail: admin.email,
      },
    };
  }

  private resolvePlatformRole(role: string | undefined): PlatformRole {
    if (role && isPlatformRole(role)) {
      return role;
    }
    // Legacy rows / missing column → treat as superadmin
    return 'superadmin';
  }

  private assertNotImpersonating(user: AuthUser) {
    if (user.impersonatedBy) {
      throw new ForbiddenException(
        'No puedes editar la cuenta mientras impersonas un tenant',
      );
    }
  }

  private async assertEmailAvailable(
    email: string,
    excludeDirectoryOrAdminEmail?: string,
  ) {
    const asAdmin = await this.platformAdmins.findOne({ where: { email } });
    if (
      asAdmin &&
      (!excludeDirectoryOrAdminEmail ||
        asAdmin.email !== excludeDirectoryOrAdminEmail)
    ) {
      throw new ConflictException('El email ya está registrado');
    }
    const inDirectory = await this.userDirectory.findOne({ where: { email } });
    if (
      inDirectory &&
      (!excludeDirectoryOrAdminEmail ||
        inDirectory.email !== excludeDirectoryOrAdminEmail)
    ) {
      throw new ConflictException('El email ya está registrado');
    }
  }
}
