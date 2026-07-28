import { Body, Controller, Get, Patch, Post, UseGuards } from '@nestjs/common';
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
import { ModulesService } from './modules.service';
import {
  UpdateMercadoPagoConfigDto,
  UpdateSmtpConfigDto,
  UpdateWhatsAppConfigDto,
  SmtpTestDto,
} from './dto/modules.dto';

@Controller('app/settings/modules')
@UseGuards(JwtAuthGuard, RolesGuard, TenantRolesGuard)
@Roles('tenant_user')
export class ModulesAppController {
  constructor(private readonly modules: ModulesService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.modules.listForTenantApp(user);
  }

  @Get('smtp')
  getSmtp(@CurrentUser() user: AuthUser) {
    return this.modules.getSmtpConfig(user);
  }

  @Patch('smtp')
  @TenantRoles(...CRM_WRITE_ROLES)
  updateSmtp(@CurrentUser() user: AuthUser, @Body() dto: UpdateSmtpConfigDto) {
    return this.modules.updateSmtpConfig(user, dto);
  }

  @Post('smtp/test')
  @TenantRoles(...CRM_WRITE_ROLES)
  testSmtp(@CurrentUser() user: AuthUser, @Body() dto: SmtpTestDto) {
    return this.modules.testSmtpConfig(user, dto.to);
  }

  @Get('mercadopago')
  getMercadoPago(@CurrentUser() user: AuthUser) {
    return this.modules.getMercadoPagoConfig(user);
  }

  @Patch('mercadopago')
  @TenantRoles(...CRM_WRITE_ROLES)
  updateMercadoPago(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateMercadoPagoConfigDto,
  ) {
    return this.modules.updateMercadoPagoConfig(user, dto);
  }

  @Get('whatsapp')
  getWhatsApp(@CurrentUser() user: AuthUser) {
    return this.modules.getWhatsAppConfig(user);
  }

  @Patch('whatsapp')
  @TenantRoles(...CRM_WRITE_ROLES)
  updateWhatsApp(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateWhatsAppConfigDto,
  ) {
    return this.modules.updateWhatsAppConfig(user, dto);
  }

  @Post('whatsapp/baileys/start')
  @TenantRoles(...CRM_WRITE_ROLES)
  startBaileys(@CurrentUser() user: AuthUser) {
    return this.modules.startBaileysSession(user);
  }

  @Get('whatsapp/baileys/status')
  baileysStatus(@CurrentUser() user: AuthUser) {
    return this.modules.getBaileysSessionStatus(user);
  }

  @Post('whatsapp/baileys/logout')
  @TenantRoles(...CRM_WRITE_ROLES)
  logoutBaileys(@CurrentUser() user: AuthUser) {
    return this.modules.logoutBaileysSession(user);
  }
}
