import { Controller, Get, UseGuards } from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { TenantRolesGuard } from '../auth/guards/tenant-roles.guard';
import { TvServersService } from './tv-servers.service';

@Controller('app/tv')
@UseGuards(JwtAuthGuard, RolesGuard, TenantRolesGuard)
@Roles('tenant_user')
export class TvMetaController {
  constructor(private readonly tv: TvServersService) {}

  /** Agent binary version packaged in this API image. */
  @Get('agent-release')
  agentRelease() {
    return this.tv.agentRelease();
  }
}
