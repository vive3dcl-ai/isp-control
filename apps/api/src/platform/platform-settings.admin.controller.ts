import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { PlatformAccess } from '../auth/decorators/roles.decorator';
import { PlatformSmtpService } from './platform-smtp.service';
import { PlatformPublicUrlsService } from './platform-public-urls.service';
import { PlatformPlansService } from './platform-plans.service';
import { PlatformBrandingService } from './platform-branding.service';
import { UpdatePlatformSmtpDto } from './dto/platform-smtp.dto';
import { UpdatePlatformPublicUrlsDto } from './dto/platform-public-urls.dto';
import { UpdateSystemPlansDto } from './dto/platform-subscription.dto';
import { UpdatePlatformBrandingDto } from './dto/platform-branding.dto';

@Controller('admin/settings')
@UseGuards(JwtAuthGuard, RolesGuard)
@PlatformAccess()
export class PlatformSettingsAdminController {
  constructor(
    private readonly smtp: PlatformSmtpService,
    private readonly publicUrls: PlatformPublicUrlsService,
    private readonly plans: PlatformPlansService,
    private readonly branding: PlatformBrandingService,
  ) {}

  @Get('smtp')
  getSmtp() {
    return this.smtp.getPublic();
  }

  @Patch('smtp')
  updateSmtp(@Body() dto: UpdatePlatformSmtpDto) {
    return this.smtp.update(dto);
  }

  @Get('public-urls')
  getPublicUrls() {
    return this.publicUrls.getPublic();
  }

  @Patch('public-urls')
  updatePublicUrls(@Body() dto: UpdatePlatformPublicUrlsDto) {
    return this.publicUrls.update(dto);
  }

  @Get('system-plans')
  listPlans() {
    return this.plans.list();
  }

  @Patch('system-plans')
  updatePlans(@Body() dto: UpdateSystemPlansDto) {
    return this.plans.updateAll(dto);
  }

  @Get('branding')
  getBranding() {
    return this.branding.getAdmin();
  }

  @Patch('branding')
  updateBranding(@Body() dto: UpdatePlatformBrandingDto) {
    return this.branding.update(dto);
  }
}
