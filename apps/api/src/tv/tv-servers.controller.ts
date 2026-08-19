import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import {
  CRM_WRITE_ROLES,
  TenantRoles,
} from '../auth/decorators/tenant-roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { TenantRolesGuard } from '../auth/guards/tenant-roles.guard';
import type { AuthUser } from '../auth/auth.types';
import { CreateTvServerDto, TvInstallStepDto, UpdateTvServerDto } from './dto/tv-server.dto';
import { TvServersService } from './tv-servers.service';

@Controller('app/tv/servers')
@UseGuards(JwtAuthGuard, RolesGuard, TenantRolesGuard)
@Roles('tenant_user')
export class TvServersController {
  constructor(private readonly tv: TvServersService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.tv.list(user);
  }

  @Post()
  @TenantRoles(...CRM_WRITE_ROLES)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateTvServerDto) {
    return this.tv.create(user, dto);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.tv.get(user, id);
  }

  @Patch(':id')
  @TenantRoles(...CRM_WRITE_ROLES)
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTvServerDto,
  ) {
    return this.tv.update(user, id, dto);
  }

  @Delete(':id')
  @TenantRoles(...CRM_WRITE_ROLES)
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.tv.remove(user, id);
  }

  @Get(':id/next-output')
  nextOutput(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.tv.nextOutput(user, id);
  }

  @Post(':id/install')
  @TenantRoles(...CRM_WRITE_ROLES)
  install(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TvInstallStepDto,
  ) {
    return this.tv.installStep(user, id, dto.step);
  }

  @Get(':id/update-check')
  updateCheck(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.tv.checkUpdate(user, id);
  }

  @Get(':id/host')
  host(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.tv.hostMetrics(user, id);
  }

  // —— Agent proxy ——

  @Get(':id/categories')
  categories(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.tv.proxy(user, id, '/v1/categories');
  }

  @Post(':id/categories')
  @TenantRoles(...CRM_WRITE_ROLES)
  createCategory(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { name: string },
  ) {
    return this.tv.proxy(user, id, '/v1/categories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  @Delete(':id/categories/:categoryId')
  @TenantRoles(...CRM_WRITE_ROLES)
  deleteCategory(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('categoryId') categoryId: string,
  ) {
    return this.tv.proxy(user, id, `/v1/categories/${categoryId}`, {
      method: 'DELETE',
    });
  }

  @Get(':id/channels')
  channels(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.tv.proxy(user, id, '/v1/channels');
  }

  @Post(':id/channels')
  @TenantRoles(...CRM_WRITE_ROLES)
  createChannel(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.tv.proxy(user, id, '/v1/channels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  @Patch(':id/channels/:channelId')
  @TenantRoles(...CRM_WRITE_ROLES)
  patchChannel(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('channelId') channelId: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.tv.proxy(user, id, `/v1/channels/${channelId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  @Delete(':id/channels/:channelId')
  @TenantRoles(...CRM_WRITE_ROLES)
  deleteChannel(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('channelId') channelId: string,
  ) {
    return this.tv.proxy(user, id, `/v1/channels/${channelId}`, {
      method: 'DELETE',
    });
  }

  @Post(':id/channels/:channelId/start')
  @TenantRoles(...CRM_WRITE_ROLES)
  startChannel(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('channelId') channelId: string,
  ) {
    return this.tv.proxy(user, id, `/v1/channels/${channelId}/start`, {
      method: 'POST',
    });
  }

  @Post(':id/channels/:channelId/stop')
  @TenantRoles(...CRM_WRITE_ROLES)
  stopChannel(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('channelId') channelId: string,
  ) {
    return this.tv.proxy(user, id, `/v1/channels/${channelId}/stop`, {
      method: 'POST',
    });
  }

  @Get(':id/channels/:channelId/status')
  channelStatus(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('channelId') channelId: string,
  ) {
    return this.tv.proxy(user, id, `/v1/channels/${channelId}/status`);
  }

  @Post(':id/channels/:channelId/logo')
  @TenantRoles(...CRM_WRITE_ROLES)
  @UseInterceptors(FileInterceptor('logo'))
  async uploadLogo(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('channelId') channelId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file?.buffer) {
      return this.tv.proxy(user, id, `/v1/channels/${channelId}/logo`, {
        method: 'POST',
      });
    }
    const form = new FormData();
    form.append(
      'logo',
      new Blob([new Uint8Array(file.buffer)], {
        type: file.mimetype || 'application/octet-stream',
      }),
      file.originalname || 'logo.png',
    );
    return this.tv.proxyMultipart(
      user,
      id,
      `/v1/channels/${channelId}/logo`,
      form,
    );
  }

  @Get(':id/logos/:channelId')
  async logo(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('channelId') channelId: string,
    @Res() res: Response,
  ) {
    const out = await this.tv.fetchLogo(user, id, channelId);
    res.setHeader('Content-Type', out.contentType);
    res.send(out.buffer);
  }

  @Get(':id/epg/providers')
  epgProviders(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.tv.proxy(user, id, '/v1/epg/providers');
  }

  @Post(':id/epg/providers')
  @TenantRoles(...CRM_WRITE_ROLES)
  createEpg(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.tv.proxy(user, id, '/v1/epg/providers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  @Patch(':id/epg/providers/:providerId')
  @TenantRoles(...CRM_WRITE_ROLES)
  patchEpg(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('providerId') providerId: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.tv.proxy(user, id, `/v1/epg/providers/${providerId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  @Delete(':id/epg/providers/:providerId')
  @TenantRoles(...CRM_WRITE_ROLES)
  deleteEpg(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('providerId') providerId: string,
  ) {
    return this.tv.proxy(user, id, `/v1/epg/providers/${providerId}`, {
      method: 'DELETE',
    });
  }

  @Post(':id/epg/providers/:providerId/refresh')
  @TenantRoles(...CRM_WRITE_ROLES)
  refreshEpg(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('providerId') providerId: string,
  ) {
    return this.tv.proxy(
      user,
      id,
      `/v1/epg/providers/${providerId}/refresh`,
      { method: 'POST' },
    );
  }

  @Get(':id/epg/providers/:providerId/channels')
  epgChannels(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('providerId') providerId: string,
  ) {
    return this.tv.proxy(
      user,
      id,
      `/v1/epg/providers/${providerId}/channels`,
    );
  }
}
