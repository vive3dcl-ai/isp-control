import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { TenantRolesGuard } from '../auth/guards/tenant-roles.guard';
import { TenantRoles } from '../auth/decorators/tenant-roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import { ClientPortalService } from './client-portal.service';

@Controller('app/client-portal/clients')
@UseGuards(JwtAuthGuard, RolesGuard, TenantRolesGuard)
@Roles('tenant_user')
export class ClientPortalAppController {
  constructor(private readonly portal: ClientPortalService) {}

  @Get(':id')
  @TenantRoles('owner', 'admin', 'administrativo', 'user', 'tecnico')
  status(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    if (!user.tenantId) return { linked: false };
    return this.portal.portalStatusForClient(user.tenantId, id);
  }

  @Post(':id/invite')
  @TenantRoles('owner', 'admin', 'administrativo')
  resend(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.portal.resendInviteForClient(user, id);
  }
}
