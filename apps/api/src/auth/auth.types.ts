export type {
  JwtRole,
  PlatformRole,
  TenantUserRole,
} from './roles';
export { PLATFORM_ROLES, TENANT_ROLES, isPlatformRole } from './roles';

import type { JwtRole, TenantUserRole } from './roles';

export interface JwtPayload {
  sub: string;
  email: string;
  role: JwtRole;
  name: string;
  tenantId?: string;
  tenantSlug?: string;
  schemaName?: string;
  tenantRole?: TenantUserRole | string;
  /** CRM client id when role is client_portal */
  clientId?: string;
  /** Platform admin id when impersonating a tenant owner */
  impersonatedBy?: string;
  impersonatorEmail?: string;
}

export interface AuthUser extends JwtPayload {}

export interface LoginResponse {
  accessToken: string;
  redirectTo: '/admin' | '/app' | string;
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
