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
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import {
  TenantRoles,
  USER_MANAGE_ROLES,
} from '../auth/decorators/tenant-roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { TenantRolesGuard } from '../auth/guards/tenant-roles.guard';
import type { AuthUser } from '../auth/auth.types';
import { TenantUsersService } from './tenant-users.service';
import {
  CreateTenantUserDto,
  UpdateTenantUserDto,
} from './dto/tenant-user.dto';

@Controller('app/users')
@UseGuards(JwtAuthGuard, RolesGuard, TenantRolesGuard)
@Roles('tenant_user')
export class TenantUsersController {
  constructor(private readonly users: TenantUsersService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.users.list(user);
  }

  @Post()
  @TenantRoles(...USER_MANAGE_ROLES)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateTenantUserDto) {
    return this.users.create(user, dto);
  }

  @Patch(':id')
  @TenantRoles(...USER_MANAGE_ROLES)
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTenantUserDto,
  ) {
    return this.users.update(user, id, dto);
  }

  @Delete(':id')
  @TenantRoles(...USER_MANAGE_ROLES)
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.users.remove(user, id);
  }
}
