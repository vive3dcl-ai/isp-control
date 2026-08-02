import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { IsBoolean, IsInt, IsOptional, IsUUID, Min } from 'class-validator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import {
  CRM_WRITE_ROLES,
  TenantRoles,
} from '../auth/decorators/tenant-roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { TenantRolesGuard } from '../auth/guards/tenant-roles.guard';
import type { AuthUser } from '../auth/auth.types';
import { OnuMigrationService } from './onu-migration.service';

class MigrationOltDto {
  @IsUUID()
  oltId!: string;

  /** Si true, sincroniza inventario vivo desde la OLT (más lento). */
  @IsOptional()
  @IsBoolean()
  fromOlt?: boolean;
}

class MigrationCompleteDto {
  @IsUUID()
  onuId!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  sourceVlan?: number | null;
}

@Controller('app/onus/migration')
@UseGuards(JwtAuthGuard, RolesGuard, TenantRolesGuard)
@Roles('tenant_user')
export class OnuMigrationController {
  constructor(private readonly migration: OnuMigrationService) {}

  @Post('scan')
  @TenantRoles(...CRM_WRITE_ROLES)
  scan(@CurrentUser() user: AuthUser, @Body() dto: MigrationOltDto) {
    return this.migration.scan(user, dto.oltId, {
      fromOlt: dto.fromOlt === true,
    });
  }

  @Get('source-vlans')
  @TenantRoles(...CRM_WRITE_ROLES)
  sourceVlans(@CurrentUser() user: AuthUser, @Query('oltId') oltId: string) {
    return this.migration.sourceVlans(user, oltId);
  }

  @Post('complete')
  @TenantRoles(...CRM_WRITE_ROLES)
  complete(@CurrentUser() user: AuthUser, @Body() dto: MigrationCompleteDto) {
    return this.migration.markComplete(user, dto.onuId, dto.sourceVlan ?? null);
  }
}
