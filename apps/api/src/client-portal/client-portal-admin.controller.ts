import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { IsIn, IsString } from 'class-validator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { PlatformAccess } from '../auth/decorators/roles.decorator';
import { ClientPortalService } from './client-portal.service';
import {
  CLIENT_PORTAL_USER_STATUSES,
  type ClientPortalUserStatus,
} from './entities/client-portal-user.entity';

class AdminSetStatusDto {
  @IsString()
  @IsIn([...CLIENT_PORTAL_USER_STATUSES])
  status!: ClientPortalUserStatus;
}

@Controller('admin/client-portal-users')
@UseGuards(JwtAuthGuard, RolesGuard)
@PlatformAccess()
export class ClientPortalAdminController {
  constructor(private readonly portal: ClientPortalService) {}

  @Get()
  list(
    @Query('tenantId') tenantId?: string,
    @Query('status') status?: string,
    @Query('q') q?: string,
    @Query('limit') limit?: string,
  ) {
    return this.portal.adminList({
      tenantId,
      status,
      q,
      limit: limit ? Number(limit) : 200,
    });
  }

  @Patch(':id/status')
  setStatus(@Param('id') id: string, @Body() dto: AdminSetStatusDto) {
    return this.portal.adminSetStatus(id, dto.status);
  }
}
