import {
  Body,
  Controller,
  Get,
  Param,
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
import { PlatformSubscriptionService } from './platform-subscription.service';
import {
  ChangeSubscriptionPlanDto,
  ContractModuleDto,
} from './dto/platform-subscription.dto';

@Controller('app/settings')
@UseGuards(JwtAuthGuard, RolesGuard, TenantRolesGuard)
@Roles('tenant_user')
export class PlatformSubscriptionAppController {
  constructor(private readonly subscriptions: PlatformSubscriptionService) {}

  @Get('subscription')
  getSubscription(@CurrentUser() user: AuthUser) {
    return this.subscriptions.getSubscriptionForTenant(user.tenantId!);
  }

  @Get('subscription/quote')
  quotePlan(@CurrentUser() user: AuthUser, @Query('cycle') cycle: string) {
    return this.subscriptions.quotePlanChange(user.tenantId!, cycle);
  }

  @Post('subscription/change-plan')
  @TenantRoles(...CRM_WRITE_ROLES)
  changePlan(
    @CurrentUser() user: AuthUser,
    @Body() dto: ChangeSubscriptionPlanDto,
  ) {
    return this.subscriptions.changePlan(user.tenantId!, dto.cycle);
  }

  @Post('subscription/charges/:chargeId/pay')
  @TenantRoles(...CRM_WRITE_ROLES)
  payCharge(
    @CurrentUser() user: AuthUser,
    @Param('chargeId') chargeId: string,
  ) {
    return this.subscriptions.payCharge(user.tenantId!, chargeId);
  }

  @Get('modules/:moduleId/contract-quote')
  quoteModule(
    @CurrentUser() user: AuthUser,
    @Param('moduleId') moduleId: string,
    @Query('mode') mode: 'one_time' | 'recurring',
  ) {
    return this.subscriptions.quoteModuleContract(
      user.tenantId!,
      moduleId,
      mode === 'recurring' ? 'recurring' : 'one_time',
    );
  }

  @Post('modules/:moduleId/contract')
  @TenantRoles(...CRM_WRITE_ROLES)
  contractModule(
    @CurrentUser() user: AuthUser,
    @Param('moduleId') moduleId: string,
    @Body() dto: ContractModuleDto,
  ) {
    return this.subscriptions.contractModule(
      user.tenantId!,
      moduleId,
      dto.mode,
    );
  }
}
