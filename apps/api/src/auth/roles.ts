/** Platform staff roles (panel /admin) */
export const PLATFORM_ROLES = ['superadmin', 'admin', 'user'] as const;
export type PlatformRole = (typeof PLATFORM_ROLES)[number];

/** Roles inside a tenant company (panel /app) */
export const TENANT_ROLES = [
  'owner',
  'admin',
  'user',
  'tecnico',
  'administrativo',
] as const;
export type TenantUserRole = (typeof TENANT_ROLES)[number];

/** JWT `role`: platform staff, tenant session, or end-customer portal */
export type JwtRole = PlatformRole | 'tenant_user' | 'client_portal';

export function isPlatformRole(role: string): role is PlatformRole {
  return (PLATFORM_ROLES as readonly string[]).includes(role);
}

export function isClientPortalRole(role: string): boolean {
  return role === 'client_portal';
}
