import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuthUser, JwtPayload } from '../auth.types';
import { PlatformAdmin } from '../entities/platform-admin.entity';
import { Tenant } from '../../tenants/entities/tenant.entity';
import { TenantConnectionService } from '../../database/tenant-connection.service';
import { isPlatformRole } from '../roles';
import { credentialVersion } from '../secure-compare';
import { ClientPortalUser } from '../../client-portal/entities/client-portal-user.entity';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    @InjectRepository(PlatformAdmin)
    private readonly platformAdmins: Repository<PlatformAdmin>,
    @InjectRepository(Tenant)
    private readonly tenants: Repository<Tenant>,
    @InjectRepository(ClientPortalUser)
    private readonly portalUsers: Repository<ClientPortalUser>,
    private readonly tenantConnections: TenantConnectionService,
  ) {
    const secret = config.get<string>('JWT_SECRET')?.trim();
    if (
      (!secret ||
        secret === 'change-me-in-production-use-a-long-random-string') &&
      config.get('NODE_ENV') === 'production'
    ) {
      throw new Error(
        'JWT_SECRET debe estar definido con un valor seguro en producción',
      );
    }
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret || 'change-me-in-production-use-a-long-random-string',
    });
  }

  async validate(payload: JwtPayload): Promise<AuthUser> {
    if (isPlatformRole(payload.role)) {
      const admin = await this.platformAdmins.findOne({
        where: { id: payload.sub },
      });
      if (
        !admin ||
        !isPlatformRole(admin.role) ||
        payload.authVersion !== credentialVersion(admin.passwordHash)
      ) {
        throw new UnauthorizedException();
      }
      return {
        ...payload,
        email: admin.email,
        name: admin.name,
        role: admin.role,
      };
    }

    if (payload.role === 'client_portal') {
      const portalUser = await this.portalUsers.findOne({
        where: { id: payload.sub },
        relations: { tenant: true },
      });
      if (
        !portalUser ||
        !portalUser.isActive ||
        portalUser.status !== 'active' ||
        portalUser.tenant?.status !== 'active' ||
        payload.tenantId !== portalUser.tenantId ||
        payload.clientId !== portalUser.clientId ||
        payload.authVersion !== credentialVersion(portalUser.passwordHash)
      ) {
        throw new UnauthorizedException();
      }
      return {
        ...payload,
        email: portalUser.email,
        name: portalUser.name,
        tenantId: portalUser.tenantId,
        tenantSlug: portalUser.tenant.slug,
        clientId: portalUser.clientId,
      };
    }

    if (
      payload.role !== 'tenant_user' ||
      !payload.tenantId ||
      !payload.schemaName
    ) {
      throw new UnauthorizedException();
    }
    const tenant = await this.tenants.findOne({
      where: { id: payload.tenantId },
    });
    if (
      !tenant ||
      tenant.status !== 'active' ||
      tenant.schemaName !== payload.schemaName
    ) {
      throw new UnauthorizedException();
    }

    if (payload.impersonatedBy) {
      const impersonator = await this.platformAdmins.findOne({
        where: { id: payload.impersonatedBy },
      });
      if (
        !impersonator ||
        !['superadmin', 'admin'].includes(impersonator.role)
      ) {
        throw new UnauthorizedException();
      }
      if (
        payload.impersonatorAuthVersion !==
        credentialVersion(impersonator.passwordHash)
      ) {
        throw new UnauthorizedException();
      }
    }

    const users = await this.tenantConnections.getUserRepository(
      tenant.schemaName,
    );
    const tenantUser = await users.findOne({ where: { id: payload.sub } });
    if (
      !tenantUser ||
      (!tenantUser.isActive && !payload.impersonatedBy) ||
      payload.authVersion !== credentialVersion(tenantUser.passwordHash)
    ) {
      throw new UnauthorizedException();
    }

    return {
      ...payload,
      email: tenantUser.email,
      name: tenantUser.name,
      tenantSlug: tenant.slug,
      schemaName: tenant.schemaName,
      tenantRole: payload.impersonatedBy ? 'owner' : tenantUser.role,
    };
  }
}
