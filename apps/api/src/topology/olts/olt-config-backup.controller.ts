import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { IsBoolean } from 'class-validator';
import type { Response } from 'express';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import {
  CRM_WRITE_ROLES,
  TenantRoles,
} from '../../auth/decorators/tenant-roles.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { TenantRolesGuard } from '../../auth/guards/tenant-roles.guard';
import type { AuthUser } from '../../auth/auth.types';
import { OltConfigBackupService } from './olt-config-backup.service';

class TechnicianModeDto {
  @IsBoolean()
  technicianMode!: boolean;
}

@Controller('app/topology/devices')
@UseGuards(JwtAuthGuard, RolesGuard, TenantRolesGuard)
@Roles('tenant_user')
export class OltConfigBackupController {
  constructor(private readonly backups: OltConfigBackupService) {}

  @Get(':id/config-backups')
  list(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.backups.list(user, id);
  }

  @Post(':id/config-backups')
  @TenantRoles(...CRM_WRITE_ROLES)
  captureNow(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.backups.captureNow(user, id);
  }

  @Get(':id/config-backups/diff')
  diff(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('a') a?: string,
    @Query('b') b?: string,
  ) {
    return this.backups.diff(user, id, a ?? '', b ?? '');
  }

  @Get(':id/config-backups/:snapId/download')
  async download(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('snapId', ParseUUIDPipe) snapId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { stream, fileName } = await this.backups.download(user, id, snapId);
    res.set({
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition': `attachment; filename="${fileName}"`,
    });
    return new StreamableFile(stream);
  }

  @Patch(':id/technician-mode')
  @TenantRoles(...CRM_WRITE_ROLES)
  setTechnicianMode(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TechnicianModeDto,
  ) {
    return this.backups.setTechnicianMode(user, id, dto.technicianMode);
  }
}
