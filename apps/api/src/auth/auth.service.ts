import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'crypto';
import { IsNull, MoreThan, Repository } from 'typeorm';
import { PlatformAdmin } from './entities/platform-admin.entity';
import { PasswordResetToken } from './entities/password-reset-token.entity';
import { UserDirectory } from '../tenants/entities/user-directory.entity';
import { Tenant } from '../tenants/entities/tenant.entity';
import { TenantConnectionService } from '../database/tenant-connection.service';
import { PlatformMailerService } from '../platform/platform-mailer.service';
import { PlatformPublicUrlsService } from '../platform/platform-public-urls.service';
import { PlatformBrandingService } from '../platform/platform-branding.service';
import { emailCtaButton, escapeHtml } from '../platform/platform-email-layout';
import { credentialVersion } from './secure-compare';
import { LoginDto } from './dto/login.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { AuthUser, JwtPayload, LoginResponse } from './auth.types';
import {
  isPlatformRole,
  type PlatformRole,
  type TenantUserRole,
} from './roles';

const RESET_TTL_MS = 60 * 60 * 1000;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectRepository(PlatformAdmin)
    private readonly platformAdmins: Repository<PlatformAdmin>,
    @InjectRepository(UserDirectory)
    private readonly userDirectory: Repository<UserDirectory>,
    @InjectRepository(Tenant)
    private readonly tenants: Repository<Tenant>,
    @InjectRepository(PasswordResetToken)
    private readonly resetTokens: Repository<PasswordResetToken>,
    private readonly tenantConnections: TenantConnectionService,
    private readonly jwt: JwtService,
    private readonly platformMailer: PlatformMailerService,
    private readonly publicUrls: PlatformPublicUrlsService,
    private readonly branding: PlatformBrandingService,
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
        authVersion: credentialVersion(admin.passwordHash),
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
      authVersion: credentialVersion(tenantUser.passwordHash),
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

    const name = dto.name !== undefined ? dto.name.trim() : undefined;
    const email =
      dto.email !== undefined ? dto.email.toLowerCase().trim() : undefined;

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
        authVersion: credentialVersion(admin.passwordHash),
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
      authVersion: credentialVersion(tenantUser.passwordHash),
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

  async forgotPassword(dto: ForgotPasswordDto) {
    const email = dto.email.toLowerCase().trim();
    const mobile = dto.channel === 'mobile';

    try {
      const target = await this.resolveResetTarget(email, mobile);
      if (!target) {
        return { ok: true as const };
      }

      await this.resetTokens.update(
        { email, usedAt: IsNull() },
        { usedAt: new Date() },
      );

      const rawToken = randomBytes(32).toString('hex');
      const tokenHash = hashResetToken(rawToken);
      const expiresAt = new Date(Date.now() + RESET_TTL_MS);

      await this.resetTokens.save(
        this.resetTokens.create({
          email,
          tokenHash,
          kind: target.kind,
          tenantId: target.tenantId,
          userId: target.userId,
          expiresAt,
          usedAt: null,
        }),
      );

      const webBase = (await this.publicUrls.resolvePublicWebUrl()).replace(
        /\/$/,
        '',
      );
      const path = mobile
        ? `/movil/reset-password?token=${encodeURIComponent(rawToken)}`
        : `/reset-password?token=${encodeURIComponent(rawToken)}`;
      const resetUrl = `${webBase}${path}`;

      const branding = await this.branding.getPublic();
      const productName = branding.productName || 'ISP Control';
      const subject = `Recuperar contraseña — ${productName}`;
      const text =
        `Hola${target.name ? ` ${target.name}` : ''},\n\n` +
        `Recibimos una solicitud para restablecer tu contraseña en ${productName}.\n\n` +
        `Abre este enlace (válido 1 hora):\n${resetUrl}\n\n` +
        `Si no solicitaste este cambio, ignora este correo.`;
      const html =
        `<p style="margin:0 0 14px">Hola${target.name ? ` ${escapeHtml(target.name)}` : ''},</p>` +
        `<p style="margin:0 0 14px">Recibimos una solicitud para restablecer tu contraseña en <strong>${escapeHtml(productName)}</strong>.</p>` +
        emailCtaButton(resetUrl, 'Restablecer contraseña') +
        `<p style="margin:0;color:#64748b;font-size:13px">El enlace caduca en 1 hora. Si no solicitaste este cambio, ignora este correo.</p>`;

      await this.platformMailer.sendMail(email, subject, text, html, {
        title: 'Recuperar contraseña',
      });
    } catch (err) {
      this.logger.error(
        `forgotPassword error for ${email}: ${(err as Error).message}`,
      );
    }

    return { ok: true as const };
  }

  async resetPassword(dto: ResetPasswordDto) {
    if (dto.newPassword.length < 8) {
      throw new BadRequestException(
        'La nueva contraseña debe tener al menos 8 caracteres',
      );
    }
    const tokenHash = hashResetToken(dto.token.trim());
    const row = await this.resetTokens.findOne({
      where: {
        tokenHash,
        usedAt: IsNull(),
        expiresAt: MoreThan(new Date()),
      },
    });
    if (!row) {
      throw new BadRequestException(
        'El enlace no es válido o ha caducado. Solicita uno nuevo.',
      );
    }

    const passwordHash = await bcrypt.hash(dto.newPassword, 10);

    if (row.kind === 'platform_admin') {
      const admin = await this.platformAdmins.findOne({
        where: { id: row.userId },
      });
      if (!admin) {
        throw new BadRequestException(
          'El enlace no es válido o ha caducado. Solicita uno nuevo.',
        );
      }
      admin.passwordHash = passwordHash;
      await this.platformAdmins.save(admin);
    } else {
      if (!row.tenantId) {
        throw new BadRequestException(
          'El enlace no es válido o ha caducado. Solicita uno nuevo.',
        );
      }
      const tenant = await this.tenants.findOne({
        where: { id: row.tenantId },
      });
      if (!tenant || tenant.status !== 'active') {
        throw new BadRequestException(
          'El enlace no es válido o ha caducado. Solicita uno nuevo.',
        );
      }
      const users = await this.tenantConnections.getUserRepository(
        tenant.schemaName,
      );
      const tenantUser = await users.findOne({ where: { id: row.userId } });
      if (!tenantUser || !tenantUser.isActive) {
        throw new BadRequestException(
          'El enlace no es válido o ha caducado. Solicita uno nuevo.',
        );
      }
      tenantUser.passwordHash = passwordHash;
      await users.save(tenantUser);
    }

    row.usedAt = new Date();
    await this.resetTokens.save(row);
    await this.resetTokens.update(
      { email: row.email, usedAt: IsNull() },
      { usedAt: new Date() },
    );

    return { ok: true as const };
  }

  private async resolveResetTarget(
    email: string,
    mobileOnly: boolean,
  ): Promise<{
    kind: 'platform_admin' | 'tenant_user';
    userId: string;
    tenantId: string | null;
    name: string;
  } | null> {
    if (!mobileOnly) {
      const admin = await this.platformAdmins.findOne({ where: { email } });
      if (admin) {
        return {
          kind: 'platform_admin',
          userId: admin.id,
          tenantId: null,
          name: admin.name,
        };
      }
    }

    const directory = await this.userDirectory.findOne({
      where: { email },
      relations: { tenant: true },
    });
    if (!directory?.tenant || directory.tenant.status !== 'active') {
      return null;
    }
    const users = await this.tenantConnections.getUserRepository(
      directory.tenant.schemaName,
    );
    const tenantUser = await users.findOne({ where: { email } });
    if (!tenantUser || !tenantUser.isActive) {
      return null;
    }
    return {
      kind: 'tenant_user',
      userId: tenantUser.id,
      tenantId: directory.tenant.id,
      name: tenantUser.name,
    };
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
      authVersion: credentialVersion(tenantUser.passwordHash),
      impersonatorAuthVersion: credentialVersion(
        (
          await this.platformAdmins.findOne({
            where: { id: admin.sub },
          })
        )?.passwordHash,
      ),
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
    // Unknown/legacy values must never grant elevated privileges.
    return 'user';
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

function hashResetToken(raw: string) {
  return createHash('sha256').update(raw).digest('hex');
}
