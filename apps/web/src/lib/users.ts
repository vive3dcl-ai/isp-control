import type { TenantUserRole } from './api'

export type TenantAppUser = {
  id: string
  email: string
  name: string
  role: TenantUserRole
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export const USER_MANAGE_ROLES = ['owner', 'admin'] as const

export function canManageUsers(tenantRole?: string | null) {
  return (
    !!tenantRole &&
    (USER_MANAGE_ROLES as readonly string[]).includes(tenantRole)
  )
}

export const TENANT_ROLE_LABEL: Record<TenantUserRole, string> = {
  owner: 'Dueño',
  admin: 'Admin',
  user: 'Usuario',
  tecnico: 'Técnico',
  administrativo: 'Administrativo',
}

/** Roles selectable in the form (owner only if current user is owner). */
export function assignableRoles(
  actorRole?: string | null,
): TenantUserRole[] {
  const base: TenantUserRole[] = [
    'admin',
    'user',
    'tecnico',
    'administrativo',
  ]
  if (actorRole === 'owner') return ['owner', ...base]
  return base
}
