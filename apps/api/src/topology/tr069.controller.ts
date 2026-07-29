import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
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
import { Tr069Service } from './tr069.service';
import {
  CreateTr069ProfileDto,
  SetTr069ProfileOltsDto,
  UpdateTr069ProfileDto,
} from './dto/tr069.dto';

@Controller('app/settings/tr069')
@UseGuards(JwtAuthGuard, RolesGuard, TenantRolesGuard)
@Roles('tenant_user')
export class Tr069Controller {
  constructor(private readonly tr069: Tr069Service) {}

  @Get('status')
  status(@CurrentUser() user: AuthUser) {
    return this.tr069.getStatus(user);
  }

  @Get('profiles')
  list(@CurrentUser() user: AuthUser) {
    return this.tr069.list(user);
  }

  @Get('profiles/:id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.tr069.get(user, id);
  }

  @Post('profiles')
  @TenantRoles(...CRM_WRITE_ROLES)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateTr069ProfileDto) {
    return this.tr069.create(user, dto);
  }

  @Patch('profiles/:id')
  @TenantRoles(...CRM_WRITE_ROLES)
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTr069ProfileDto,
  ) {
    return this.tr069.update(user, id, dto);
  }

  @Delete('profiles/:id')
  @TenantRoles(...CRM_WRITE_ROLES)
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.tr069.remove(user, id);
  }

  @Put('profiles/:id/olts')
  @TenantRoles(...CRM_WRITE_ROLES)
  setOlts(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetTr069ProfileOltsDto,
  ) {
    return this.tr069.setOlts(user, id, dto);
  }
}
