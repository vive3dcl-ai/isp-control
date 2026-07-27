import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
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
import { IpPoolService } from './ip-pool.service';
import {
  CreateIpPoolDto,
  UpdateIpPoolDto,
} from './dto/ip-pool.dto';

@Controller('app/settings/ip-pools')
@UseGuards(JwtAuthGuard, RolesGuard, TenantRolesGuard)
@Roles('tenant_user')
export class IpPoolController {
  constructor(private readonly ipPools: IpPoolService) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query('purpose') purpose?: string,
    @Query('oltId') oltId?: string,
  ) {
    return this.ipPools.list(user, { purpose, oltId });
  }

  @Get(':id')
  get(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.ipPools.get(user, id);
  }

  @Get(':id/addresses')
  listAddresses(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.ipPools.listAddresses(user, id);
  }

  @Post()
  @TenantRoles(...CRM_WRITE_ROLES)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateIpPoolDto) {
    return this.ipPools.create(user, dto);
  }

  @Patch(':id')
  @TenantRoles(...CRM_WRITE_ROLES)
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateIpPoolDto,
  ) {
    return this.ipPools.update(user, id, dto);
  }

  @Delete(':id')
  @TenantRoles(...CRM_WRITE_ROLES)
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.ipPools.remove(user, id);
  }
}
