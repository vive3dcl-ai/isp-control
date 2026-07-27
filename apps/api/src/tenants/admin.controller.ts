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
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { PlatformAccess, Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import { AuthService } from '../auth/auth.service';
import { TenantsService } from './tenants.service';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { UpdateTenantDto } from './dto/update-tenant.dto';
import { UpdateTenantStatusDto } from './dto/update-tenant-status.dto';
import { DeleteTenantDto } from './dto/delete-tenant.dto';

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@PlatformAccess()
export class AdminController {
  constructor(
    private readonly tenantsService: TenantsService,
    private readonly authService: AuthService,
  ) {}

  @Get('dashboard')
  async dashboard(@CurrentUser() user: AuthUser) {
    const tenantCount = await this.tenantsService.count();
    return {
      message: `Welcome ${user.name}`,
      tenantCount,
    };
  }

  @Get('tenants')
  listTenants() {
    return this.tenantsService.list();
  }

  @Get('tenants/:id')
  getTenant(@Param('id', ParseUUIDPipe) id: string) {
    return this.tenantsService.findOne(id);
  }

  @Post('tenants')
  createTenant(@Body() dto: CreateTenantDto) {
    return this.tenantsService.create(dto);
  }

  @Patch('tenants/:id')
  updateTenant(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTenantDto,
  ) {
    return this.tenantsService.update(id, dto);
  }

  @Patch('tenants/:id/status')
  updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTenantStatusDto,
  ) {
    return this.tenantsService.updateStatus(id, dto.status);
  }

  @Post('tenants/:id/impersonate')
  impersonate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.authService.impersonateTenant(user, id);
  }

  @Delete('tenants/:id')
  @Roles('superadmin')
  deleteTenant(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DeleteTenantDto,
  ) {
    return this.tenantsService.remove(id, dto.confirmationSlug);
  }
}
