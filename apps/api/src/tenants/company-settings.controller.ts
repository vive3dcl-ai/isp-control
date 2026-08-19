import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { TenantRolesGuard } from '../auth/guards/tenant-roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import {
  CRM_WRITE_ROLES,
  TenantRoles,
} from '../auth/decorators/tenant-roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import { TenantsService } from './tenants.service';
import { UpdateCompanyDto } from './dto/update-company.dto';
import { ConfigureSuspensionMikrotikDto } from './dto/configure-suspension-mikrotik.dto';
import { SuspensionPortalService } from '../topology/suspension-portal.service';

@Controller('app/settings/company')
@UseGuards(JwtAuthGuard, RolesGuard, TenantRolesGuard)
@Roles('tenant_user')
export class CompanySettingsController {
  constructor(
    private readonly tenants: TenantsService,
    private readonly suspensionPortal: SuspensionPortalService,
  ) {}

  @Get('currencies')
  listCurrencies() {
    return this.tenants.listCurrencies();
  }

  @Get('suspension-portal/templates')
  listSuspensionPortalTemplates() {
    return this.suspensionPortal.listTemplates();
  }

  @Get('suspension-portal/preview')
  async previewSuspensionPortal(
    @CurrentUser() user: AuthUser,
    @Query('templateId') templateId: string | undefined,
  ) {
    const html = await this.suspensionPortal.previewTemplate(user, templateId);
    return { html };
  }

  @Get()
  getCompany(@CurrentUser() user: AuthUser) {
    if (!user.tenantId) {
      throw new NotFoundException('Sin empresa asociada');
    }
    return this.tenants.getCompany(user.tenantId);
  }

  @Patch()
  @TenantRoles(...CRM_WRITE_ROLES)
  async updateCompany(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateCompanyDto,
  ) {
    if (!user.tenantId) {
      throw new NotFoundException('Sin empresa asociada');
    }
    const previous = await this.tenants.getCompany(user.tenantId);
    const saved = await this.tenants.updateCompany(user.tenantId, dto);
    if (!previous.suspensionPortalEnabled && saved.suspensionPortalEnabled) {
      const portalMigrate =
        await this.suspensionPortal.migrateOltDisabledToPortal(user);
      return { ...saved, portalMigrate };
    }
    return saved;
  }

  @Post('suspension-portal/configure-mikrotik')
  @TenantRoles(...CRM_WRITE_ROLES)
  configureSuspensionMikrotik(
    @CurrentUser() user: AuthUser,
    @Body() dto: ConfigureSuspensionMikrotikDto,
  ) {
    return this.suspensionPortal.configureMikrotik(user, dto.routerIds);
  }
}
