import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
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
import { BillingService } from './billing.service';
import { BillingSchedulerService } from './billing-scheduler.service';
import {
  CreateBillingProductDto,
  CreateInvoiceDto,
  CreateInvoiceTemplateDto,
  RunBillingJobDto,
  SendInvoiceDto,
  UpdateBillingProductDto,
  UpdateBillingSettingsDto,
  UpdateInvoiceTemplateDto,
} from './dto/billing.dto';

@Controller('app/settings/billing')
@UseGuards(JwtAuthGuard, RolesGuard, TenantRolesGuard)
@Roles('tenant_user')
export class BillingSettingsController {
  constructor(
    private readonly billing: BillingService,
    private readonly scheduler: BillingSchedulerService,
  ) {}

  @Get()
  getSettings(@CurrentUser() user: AuthUser) {
    return this.billing.getSettings(user);
  }

  @Patch()
  @TenantRoles(...CRM_WRITE_ROLES)
  updateSettings(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateBillingSettingsDto,
  ) {
    return this.billing.updateSettings(user, dto);
  }

  @Get('templates')
  listTemplates(@CurrentUser() user: AuthUser) {
    return this.billing.listTemplates(user);
  }

  @Post('templates')
  @TenantRoles(...CRM_WRITE_ROLES)
  createTemplate(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateInvoiceTemplateDto,
  ) {
    return this.billing.createTemplate(user, dto);
  }

  @Post('templates/reset-defaults')
  @TenantRoles(...CRM_WRITE_ROLES)
  resetDefaultTemplates(@CurrentUser() user: AuthUser) {
    return this.billing.resetDefaultTemplates(user);
  }

  @Patch('templates/:id')
  @TenantRoles(...CRM_WRITE_ROLES)
  updateTemplate(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateInvoiceTemplateDto,
  ) {
    return this.billing.updateTemplate(user, id, dto);
  }

  @Delete('templates/:id')
  @TenantRoles(...CRM_WRITE_ROLES)
  deleteTemplate(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.billing.deleteTemplate(user, id);
  }

  @Get('products')
  listProducts(@CurrentUser() user: AuthUser) {
    return this.billing.listProducts(user);
  }

  @Post('products')
  @TenantRoles(...CRM_WRITE_ROLES)
  createProduct(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateBillingProductDto,
  ) {
    return this.billing.createProduct(user, dto);
  }

  @Patch('products/:id')
  @TenantRoles(...CRM_WRITE_ROLES)
  updateProduct(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateBillingProductDto,
  ) {
    return this.billing.updateProduct(user, id, dto);
  }

  @Delete('products/:id')
  @TenantRoles(...CRM_WRITE_ROLES)
  deleteProduct(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.billing.deleteProduct(user, id);
  }

  @Get('invoices')
  listInvoices(@CurrentUser() user: AuthUser) {
    return this.billing.listInvoices(user);
  }

  @Post('invoices')
  @TenantRoles(...CRM_WRITE_ROLES)
  createInvoice(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateInvoiceDto,
  ) {
    return this.billing.createManualInvoice(user, dto);
  }

  @Get('invoices/:id')
  getInvoice(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    return this.billing.getInvoice(user, id);
  }

  @Post('invoices/:id/send')
  @TenantRoles(...CRM_WRITE_ROLES)
  sendInvoice(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: SendInvoiceDto,
  ) {
    return this.billing.sendInvoice(user, id, dto.email);
  }

  @Post('run')
  @TenantRoles(...CRM_WRITE_ROLES)
  async runJob(@CurrentUser() user: AuthUser, @Body() dto: RunBillingJobDto) {
    if (!user.tenantId || !user.schemaName) {
      throw new NotFoundException('Sin empresa asociada');
    }
    const job = await this.scheduler.enqueueManual(
      user.tenantId,
      user.schemaName,
      dto.job,
    );
    return { ok: true, jobId: job.id, job: dto.job };
  }
}
