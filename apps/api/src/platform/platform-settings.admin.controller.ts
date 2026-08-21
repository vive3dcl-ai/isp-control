import { Body, Controller, Get, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import {
  PlatformAccess,
  PlatformWriteAccess,
} from '../auth/decorators/roles.decorator';
import { PlatformSmtpService } from './platform-smtp.service';
import { PlatformAiSettingsService } from '../ai/platform-ai-settings.service';
import { PlatformPublicUrlsService } from './platform-public-urls.service';
import { PlatformPlansService } from './platform-plans.service';
import { PlatformBrandingService } from './platform-branding.service';
import { PlatformMailerService } from './platform-mailer.service';
import { UpdatePlatformSmtpDto } from './dto/platform-smtp.dto';
import { UpdatePlatformPublicUrlsDto } from './dto/platform-public-urls.dto';
import { UpdateSystemPlansDto } from './dto/platform-subscription.dto';
import { UpdatePlatformBrandingDto } from './dto/platform-branding.dto';
import { SmtpTestDto } from './dto/smtp-test.dto';
import { UpdatePlatformAiSettingsDto, ListPlatformAiModelsDto } from './dto/platform-ai-settings.dto';

@Controller('admin/settings')
@UseGuards(JwtAuthGuard, RolesGuard)
@PlatformAccess()
export class PlatformSettingsAdminController {
  constructor(
    private readonly smtp: PlatformSmtpService,
    private readonly ai: PlatformAiSettingsService,
    private readonly publicUrls: PlatformPublicUrlsService,
    private readonly plans: PlatformPlansService,
    private readonly branding: PlatformBrandingService,
    private readonly mailer: PlatformMailerService,
  ) {}

  @Get('smtp')
  getSmtp() {
    return this.smtp.getPublic();
  }

  @Patch('smtp')
  @PlatformWriteAccess()
  updateSmtp(@Body() dto: UpdatePlatformSmtpDto) {
    return this.smtp.update(dto);
  }

  @Post('smtp/test')
  @PlatformWriteAccess()
  async testSmtp(@Body() dto: SmtpTestDto) {
    const branding = await this.branding.getPublic();
    return this.mailer.sendTest(dto.to, branding.productName || 'ISP Control');
  }

  @Get('ai')
  getAi() {
    return this.ai.getPublic();
  }

  @Patch('ai')
  @PlatformWriteAccess()
  updateAi(@Body() dto: UpdatePlatformAiSettingsDto) {
    return this.ai.update(dto);
  }

  @Post('ai/models')
  @PlatformWriteAccess()
  listAiModels(@Body() dto: ListPlatformAiModelsDto) {
    return this.ai.listModels(dto);
  }

  @Get('public-urls')
  getPublicUrls() {
    return this.publicUrls.getPublic();
  }

  @Patch('public-urls')
  @PlatformWriteAccess()
  updatePublicUrls(@Body() dto: UpdatePlatformPublicUrlsDto) {
    return this.publicUrls.update(dto);
  }

  @Get('system-plans')
  listPlans() {
    return this.plans.listAdmin();
  }

  @Patch('system-plans')
  @PlatformWriteAccess()
  updatePlans(@Body() dto: UpdateSystemPlansDto) {
    return this.plans.updateAll(dto);
  }

  @Get('branding')
  getBranding() {
    return this.branding.getAdmin();
  }

  @Patch('branding')
  @PlatformWriteAccess()
  updateBranding(@Body() dto: UpdatePlatformBrandingDto) {
    return this.branding.update(dto);
  }
}
