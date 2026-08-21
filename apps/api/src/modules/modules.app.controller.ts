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
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
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
  UpdateAsistenteIaConfigDto,
  ListAsistenteIaModelsDto,
  AsistenteChatDto,
  UpdateMercadoPagoConfigDto,
  UpdateSmtpConfigDto,
  UpdateWhatsAppConfigDto,
} from './dto/modules.dto';
import { SmtpTestDto } from '../platform/dto/smtp-test.dto';

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

  @Get('asistente-ia')
  getAsistenteIa(@CurrentUser() user: AuthUser) {
    return this.modules.getAsistenteIaConfig(user);
  }

  @Patch('asistente-ia')
  @TenantRoles(...CRM_WRITE_ROLES)
  updateAsistenteIa(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateAsistenteIaConfigDto,
  ) {
    return this.modules.updateAsistenteIaConfig(user, dto);
  }

  @Post('asistente-ia/test')
  @TenantRoles(...CRM_WRITE_ROLES)
  testAsistenteIa(@CurrentUser() user: AuthUser) {
    return this.modules.testAsistenteIa(user);
  }

  @Post('asistente-ia/models')
  @TenantRoles(...CRM_WRITE_ROLES)
  listAsistenteIaModels(
    @CurrentUser() user: AuthUser,
    @Body() dto: ListAsistenteIaModelsDto,
  ) {
    return this.modules.listAsistenteIaModels(user, dto);
  }

  @Post('asistente-ia/chat')
  chatAsistenteIa(
    @CurrentUser() user: AuthUser,
    @Body() dto: AsistenteChatDto,
  ) {
    return this.modules.chatAsistenteIa(user, dto);
  }

  /**
   * Misma lógica que /chat pero con SSE: emite activity mientras corre tools/skills.
   */
  @Post('asistente-ia/chat/stream')
  async chatAsistenteIaStream(
    @CurrentUser() user: AuthUser,
    @Body() dto: AsistenteChatDto,
    @Res() res: Response,
  ) {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const write = (payload: unknown) => {
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    try {
      await this.modules.chatAsistenteIa(user, dto, (event) => write(event));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      write({ type: 'error', message });
      write({ type: 'done' });
    } finally {
      res.end();
    }
  }

  @Get('asistente-ia/capabilities')
  listAsistenteIaCapabilities(@CurrentUser() user: AuthUser) {
    return this.modules.listAsistenteIaCapabilities(user);
  }

  @Get('asistente-ia/restore-points')
  listAsistenteIaRestorePoints(
    @CurrentUser() user: AuthUser,
    @Query('sessionId') sessionId?: string,
  ) {
    return this.modules.listAsistenteIaRestorePoints(user, { sessionId });
  }

  @Post('asistente-ia/restore-points/:id/restore')
  @TenantRoles(...CRM_WRITE_ROLES)
  restoreAsistenteIaPoint(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.modules.restoreAsistenteIaPoint(user, id);
  }

  @Get('asistente-ia/sessions')
  listAsistenteIaSessions(@CurrentUser() user: AuthUser) {
    return this.modules.listAsistenteIaSessions(user);
  }

  @Get('asistente-ia/sessions/:sessionId')
  getAsistenteIaSession(
    @CurrentUser() user: AuthUser,
    @Param('sessionId') sessionId: string,
  ) {
    return this.modules.getAsistenteIaSession(user, sessionId);
  }

  @Delete('asistente-ia/sessions/:sessionId')
  deleteAsistenteIaSession(
    @CurrentUser() user: AuthUser,
    @Param('sessionId') sessionId: string,
  ) {
    return this.modules.deleteAsistenteIaSession(user, sessionId);
  }
}
