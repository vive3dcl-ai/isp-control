import { Controller, Get } from '@nestjs/common';
import { PlatformBrandingService } from './platform-branding.service';

/** Branding público (login / SEO) sin autenticación. */
@Controller('public/branding')
export class PlatformBrandingPublicController {
  constructor(private readonly branding: PlatformBrandingService) {}

  @Get()
  get() {
    return this.branding.getPublic();
  }
}
