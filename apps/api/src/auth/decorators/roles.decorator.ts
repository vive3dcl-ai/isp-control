import { SetMetadata } from '@nestjs/common';
import { JwtRole, PLATFORM_ROLES } from '../roles';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: JwtRole[]) => SetMetadata(ROLES_KEY, roles);

/** Any platform staff (superadmin, admin, user) */
export const PlatformAccess = () => Roles(...PLATFORM_ROLES);

/** Platform staff allowed to change shared/tenant configuration. */
export const PlatformWriteAccess = () => Roles('superadmin', 'admin');
