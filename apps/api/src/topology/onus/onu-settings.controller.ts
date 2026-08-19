import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import {
  CRM_WRITE_ROLES,
  TenantRoles,
} from '../../auth/decorators/tenant-roles.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { TenantRolesGuard } from '../../auth/guards/tenant-roles.guard';
import type { AuthUser } from '../../auth/auth.types';
import { OnuSettingsService } from './onu-settings.service';
import {
  CreateOnuTypeDto,
  UpdateOnuProfileDto,
  UpdateOnuTypeDto,
} from '../shared/dto/onu-settings.dto';

@Controller('app/settings/onus')
@UseGuards(JwtAuthGuard, RolesGuard, TenantRolesGuard)
@Roles('tenant_user')
export class OnuSettingsController {
  constructor(private readonly onuSettings: OnuSettingsService) {}

  @Get('profiles')
  listProfiles(@CurrentUser() user: AuthUser) {
    return this.onuSettings.listProfiles(user);
  }

  @Patch('profiles/:id')
  @TenantRoles(...CRM_WRITE_ROLES)
  updateProfile(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateOnuProfileDto,
  ) {
    return this.onuSettings.updateProfile(user, id, dto);
  }

  @Get('types')
  listTypes(@CurrentUser() user: AuthUser) {
    return this.onuSettings.listTypes(user);
  }

  @Post('types/reconcile-acs')
  @TenantRoles(...CRM_WRITE_ROLES)
  reconcileTypesFromAcs(@CurrentUser() user: AuthUser) {
    return this.onuSettings.reconcileTypesFromAcs(user);
  }

  @Get('types/:id')
  getType(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.onuSettings.getType(user, id);
  }

  @Post('types')
  @TenantRoles(...CRM_WRITE_ROLES)
  createType(@CurrentUser() user: AuthUser, @Body() dto: CreateOnuTypeDto) {
    return this.onuSettings.createType(user, dto);
  }

  @Patch('types/:id')
  @TenantRoles(...CRM_WRITE_ROLES)
  updateType(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateOnuTypeDto,
  ) {
    return this.onuSettings.updateType(user, id, dto);
  }

  @Delete('types/:id')
  @TenantRoles(...CRM_WRITE_ROLES)
  removeType(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.onuSettings.removeType(user, id);
  }
}
