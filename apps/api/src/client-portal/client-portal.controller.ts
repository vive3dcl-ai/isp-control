import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import { ClientPortalService } from './client-portal.service';
import {
  PortalActivateDto,
  PortalChangePasswordDto,
  PortalLoginDto,
  PortalUpdateProfileDto,
} from './dto/client-portal.dto';

@Controller('public/client-portal')
export class ClientPortalPublicController {
  constructor(private readonly portal: ClientPortalService) {}

  @Get(':slug/branding')
  branding(@Param('slug') slug: string) {
    return this.portal.getBranding(slug);
  }

  @Post(':slug/login')
  login(@Param('slug') slug: string, @Body() dto: PortalLoginDto) {
    return this.portal.login(slug, dto.email, dto.password);
  }

  @Get('invite/:token')
  getInvite(@Param('token') token: string) {
    return this.portal.getInvite(token);
  }

  @Post('invite/:token/activate')
  activate(@Param('token') token: string, @Body() dto: PortalActivateDto) {
    return this.portal.activateInvite(token, dto.password);
  }

  @Post('webhooks/mercadopago/:slug')
  webhookMp(
    @Param('slug') slug: string,
    @Query() query: Record<string, string>,
    @Body() body: Record<string, unknown>,
  ) {
    const flat: Record<string, string> = { ...query };
    if (body && typeof body === 'object') {
      const data = body.data as { id?: string | number } | undefined;
      if (data?.id != null) flat['data.id'] = String(data.id);
      if (typeof body.type === 'string') flat.type = body.type;
      if (typeof body.action === 'string') flat.topic = body.action;
    }
    return this.portal.handleMercadoPagoWebhook(slug, flat);
  }
}

@Controller('portal')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('client_portal')
export class ClientPortalAuthController {
  constructor(private readonly portal: ClientPortalService) {}

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.portal.me(user);
  }

  @Patch('me')
  updateMe(
    @CurrentUser() user: AuthUser,
    @Body() dto: PortalUpdateProfileDto,
  ) {
    return this.portal.updateProfile(user, dto);
  }

  @Post('change-password')
  changePassword(
    @CurrentUser() user: AuthUser,
    @Body() dto: PortalChangePasswordDto,
  ) {
    return this.portal.changePassword(
      user,
      dto.currentPassword,
      dto.newPassword,
    );
  }

  @Get('services')
  services(@CurrentUser() user: AuthUser) {
    return this.portal.listServices(user);
  }

  @Get('services/:id/metrics')
  metrics(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query('hours') hours?: string,
  ) {
    const n = hours ? Number(hours) : 24;
    return this.portal.serviceMetrics(user, id, Number.isFinite(n) ? n : 24);
  }

  @Get('invoices')
  invoices(@CurrentUser() user: AuthUser) {
    return this.portal.listInvoices(user);
  }

  @Get('invoices/:id')
  invoice(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.portal.getInvoice(user, id);
  }

  @Get('invoices/:id/pdf')
  async invoicePdf(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const { filename, buffer } = await this.portal.getInvoicePdf(user, id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${filename}"`,
    );
    res.send(buffer);
  }

  @Post('invoices/:id/pay')
  pay(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.portal.createPaymentPreference(user, id);
  }
}
