export type { JwtRole, PlatformRole, TenantUserRole } from './roles';
export { PLATFORM_ROLES, TENANT_ROLES, isPlatformRole } from './roles';

import type { JwtRole } from './roles';

export interface JwtPayload {
  sub: string;
  email: string;
  role: JwtRole;
  name: string;
  tenantId?: string;
  tenantSlug?: string;
  schemaName?: string;
  tenantRole?: string;
  /** CRM client id when role is client_portal */
  clientId?: string;
  /** Platform admin id when impersonating a tenant owner */
  impersonatedBy?: string;
  impersonatorEmail?: string;
  /** Hash-derived marker used to revoke tokens after password changes. */
  authVersion?: string;
  impersonatorAuthVersion?: string;
}

export type AuthUser = JwtPayload;

export interface LoginResponse {
  accessToken: string;
  redirectTo: string;
  user: {
    id: string;
    email: string;
    name: string;
    role: JwtRole;
    tenantId?: string;
    tenantSlug?: string;
    tenantRole?: string;
    clientId?: string;
    impersonatedBy?: string;
    impersonatorEmail?: string;
  };
}
