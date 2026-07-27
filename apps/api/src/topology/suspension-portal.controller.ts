import { Controller, Get, Header, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { SuspensionPortalService } from './suspension-portal.service';

/**
 * HTML del portal cautivo (sin auth).
 * La URL pública que ven clientes/MikroTik es del panel:
 *   https://panel…/{slug}/suspension
 * nginx/vite hacen proxy a este endpoint bajo /api (no exponer el portal como
 * producto de la API).
 */
@Controller('public/suspension-portal')
export class SuspensionPortalController {
  constructor(private readonly portal: SuspensionPortalService) {}

  @Get(':tenantSlug')
  @Header('Content-Type', 'text/html; charset=utf-8')
  async suspendedPage(
    @Param('tenantSlug') tenantSlug: string,
    @Res() res: Response,
  ) {
    const html = await this.portal.renderSuspendedPage(tenantSlug);
    res.setHeader('Cache-Control', 'no-store');
    res.send(html);
  }
}

/** Rutas legacy (MikroTik ya configurados con /api/…). */
@Controller()
export class SuspensionPortalLegacyController {
  constructor(private readonly portal: SuspensionPortalService) {}

  @Get('portal/:tenantSlug/suspended')
  @Header('Content-Type', 'text/html; charset=utf-8')
  async legacySuspendedPage(
    @Param('tenantSlug') tenantSlug: string,
    @Res() res: Response,
  ) {
    const html = await this.portal.renderSuspendedPage(tenantSlug);
    res.setHeader('Cache-Control', 'no-store');
    res.send(html);
  }
}
