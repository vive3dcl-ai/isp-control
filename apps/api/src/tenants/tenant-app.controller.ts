import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import { TenantConnectionService } from '../database/tenant-connection.service';
import { CrmService } from '../crm/crm.service';

@Controller('app')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('tenant_user')
export class TenantAppController {
  constructor(
    private readonly tenantConnections: TenantConnectionService,
    private readonly crm: CrmService,
  ) {}

  @Get('dashboard')
  async dashboard(@CurrentUser() user: AuthUser) {
    if (!user.schemaName) {
      return {
        message: `Welcome ${user.name}`,
        userCount: 0,
        clientCount: 0,
        planCount: 0,
        activeServices: 0,
        suspendedServices: 0,
        salesThisMonth: 0,
        estimatedEarnings: 0,
        alertsCount: 0,
        alerts: [],
      };
    }

    const users = await this.tenantConnections.getUserRepository(
      user.schemaName,
    );
    const [userCount, crmStats] = await Promise.all([
      users.count(),
      this.crm.dashboardStats(user),
    ]);

    return {
      message: `Welcome ${user.name}`,
      tenantSlug: user.tenantSlug,
      tenantRole: user.tenantRole,
      userCount,
      ...crmStats,
    };
  }
}
