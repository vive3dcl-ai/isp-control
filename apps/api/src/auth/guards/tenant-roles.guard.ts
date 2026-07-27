import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthUser } from '../auth.types';
import type { TenantUserRole } from '../roles';

export const TENANT_ROLES_KEY = 'tenant_roles';

@Injectable()
export class TenantRolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const allowed = this.reflector.getAllAndOverride<TenantUserRole[]>(
      TENANT_ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!allowed || allowed.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{ user?: AuthUser }>();
    const role = request.user?.tenantRole as TenantUserRole | undefined;

    if (!role || !allowed.includes(role)) {
      throw new ForbiddenException('Insufficient tenant role');
    }

    return true;
  }
}
