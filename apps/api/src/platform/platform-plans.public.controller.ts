import { Controller, Get } from '@nestjs/common';
import { PlatformPlansService } from './platform-plans.service';
import { EXTRA_USER_BLOCK_SIZE } from './billing-cycles';

/** Planes públicos para la landing (sin autenticación). */
@Controller('public/platform')
export class PlatformPlansPublicController {
  constructor(private readonly plans: PlatformPlansService) {}

  @Get('plans')
  async listPlans() {
    const admin = await this.plans.listAdmin();
    return {
      plans: admin.plans
        .filter((p) => p.enabled)
        .map((p) => ({
          code: p.code,
          label: p.label,
          userLimit: p.userLimit,
          priceUsd: p.priceUsd,
          sortOrder: p.sortOrder,
        })),
      extraBlockSize: admin.extraBlockSize ?? EXTRA_USER_BLOCK_SIZE,
      extraBlockPriceUsd: admin.extraBlockPriceUsd,
      currency: 'USD',
      billing: 'monthly',
    };
  }
}
