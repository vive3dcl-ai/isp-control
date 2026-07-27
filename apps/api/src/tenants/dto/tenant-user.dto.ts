import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { TENANT_ROLES } from '../../auth/roles';

/** Roles that can be assigned when creating/editing users (owner is special). */
export const ASSIGNABLE_TENANT_ROLES = TENANT_ROLES.filter(
  (r) => r !== 'owner',
);

export class CreateTenantUserDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password!: string;

  @IsIn([...ASSIGNABLE_TENANT_ROLES, 'owner'])
  role!: (typeof TENANT_ROLES)[number];
}

export class UpdateTenantUserDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsIn([...ASSIGNABLE_TENANT_ROLES, 'owner'])
  role?: (typeof TENANT_ROLES)[number];

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password?: string;
}
