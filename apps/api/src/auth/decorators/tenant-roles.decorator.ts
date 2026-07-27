import { SetMetadata } from '@nestjs/common';
import type { TenantUserRole } from '../roles';
import { TENANT_ROLES_KEY } from '../guards/tenant-roles.guard';

export const TenantRoles = (...roles: TenantUserRole[]) =>
  SetMetadata(TENANT_ROLES_KEY, roles);

/** Roles that can mutate CRM data */
export const CRM_WRITE_ROLES: TenantUserRole[] = [
  'owner',
  'admin',
  'administrativo',
];

/**
 * Roles for field install (mobile /movil): create client, authorize ONU, VLANs.
 * Includes técnicos without opening full CRM/settings write.
 */
export const FIELD_INSTALL_ROLES: TenantUserRole[] = [
  'owner',
  'admin',
  'administrativo',
  'tecnico',
];

/** Roles that can manage tenant company users */
export const USER_MANAGE_ROLES: TenantUserRole[] = ['owner', 'admin'];
