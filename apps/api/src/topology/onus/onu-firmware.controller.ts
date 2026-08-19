import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { tmpdir } from 'node:os';
import { IsBoolean, IsOptional, IsUUID } from 'class-validator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import {
  FIELD_INSTALL_ROLES,
  TenantRoles,
} from '../../auth/decorators/tenant-roles.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { TenantRolesGuard } from '../../auth/guards/tenant-roles.guard';
import type { AuthUser } from '../../auth/auth.types';
import { OnuFirmwareService } from './onu-firmware.service';

class FirmwareUpgradeDto {
  @IsOptional()
  @IsUUID()
  onuId?: string;

  @IsOptional()
  @IsBoolean()
  allOnlineOfModel?: boolean;
}

@Controller('app/onus/firmware')
@UseGuards(JwtAuthGuard, RolesGuard, TenantRolesGuard)
@Roles('tenant_user')
export class OnuFirmwareController {
  constructor(private readonly firmware: OnuFirmwareService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.firmware.list(user);
  }

  @Post()
  @TenantRoles(...FIELD_INSTALL_ROLES)
  @UseInterceptors(
    FileInterceptor('file', {
      dest: tmpdir(),
      limits: { fileSize: 256 * 1024 * 1024 },
    }),
  )
  upload(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body('modelKey') modelKey?: string,
    @Body('version') version?: string,
    @Body('note') note?: string,
  ) {
    return this.firmware.upload(user, file, { modelKey, version, note });
  }

  @Delete(':id')
  @TenantRoles(...FIELD_INSTALL_ROLES)
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.firmware.remove(user, id);
  }

  @Get(':id/targets')
  targets(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.firmware.targets(user, id);
  }

  @Post(':id/upgrade')
  @TenantRoles(...FIELD_INSTALL_ROLES)
  upgrade(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: FirmwareUpgradeDto,
  ) {
    return this.firmware.upgrade(user, id, dto);
  }
}
