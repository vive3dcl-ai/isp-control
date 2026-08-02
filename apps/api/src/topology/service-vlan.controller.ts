import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
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
import { ServiceVlanService } from './service-vlan.service';
import {
  CreateServiceVlanDto,
  SERVICE_VLAN_PURPOSES,
  UpdateServiceVlanDto,
  SyncServiceVlanDeviceDto,
  type ServiceVlanPurpose,
} from './dto/service-vlan.dto';

@Controller('app/settings/vlans')
@UseGuards(JwtAuthGuard, RolesGuard, TenantRolesGuard)
@Roles('tenant_user')
export class ServiceVlanController {
  constructor(private readonly serviceVlans: ServiceVlanService) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query('purpose') purpose?: string,
  ) {
    const normalized =
      purpose &&
      (SERVICE_VLAN_PURPOSES as readonly string[]).includes(purpose)
        ? (purpose as ServiceVlanPurpose)
        : undefined;
    return this.serviceVlans.list(user, { purpose: normalized });
  }

  @Post()
  @TenantRoles(...CRM_WRITE_ROLES)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateServiceVlanDto) {
    return this.serviceVlans.create(user, dto);
  }

  @Patch(':id')
  @TenantRoles(...CRM_WRITE_ROLES)
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateServiceVlanDto,
  ) {
    return this.serviceVlans.update(user, id, dto);
  }

  /** Upsert by VLAN ID (for discovered rows without catalog id). */
  @Put('by-vlan/:vlanId')
  @TenantRoles(...CRM_WRITE_ROLES)
  upsertByVlanId(
    @CurrentUser() user: AuthUser,
    @Param('vlanId', ParseIntPipe) vlanId: number,
    @Body() dto: UpdateServiceVlanDto,
  ) {
    return this.serviceVlans.upsertByVlanId(user, vlanId, dto);
  }

  @Post(':id/sync-device')
  @TenantRoles(...CRM_WRITE_ROLES)
  syncDevice(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SyncServiceVlanDeviceDto,
  ) {
    return this.serviceVlans.syncDevice(user, id, dto);
  }

  @Post(':id/remove-device')
  @TenantRoles(...CRM_WRITE_ROLES)
  removeFromDevice(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SyncServiceVlanDeviceDto,
  ) {
    return this.serviceVlans.removeFromDevice(user, id, dto);
  }

  @Post(':id/verify')
  @TenantRoles(...CRM_WRITE_ROLES)
  verify(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.serviceVlans.verify(user, id);
  }

  @Delete(':id')
  @TenantRoles(...CRM_WRITE_ROLES)
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.serviceVlans.remove(user, id);
  }
}
