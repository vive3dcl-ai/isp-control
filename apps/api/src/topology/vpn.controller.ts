import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
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
import { VpnService } from './vpn.service';
import {
  CreateVpnTunnelClientDto,
  CreateVpnTunnelDto,
  ImportVpnToRouterDto,
  UpdateVpnTunnelClientDto,
  UpdateVpnTunnelDto,
  VpnSetupDto,
} from './dto/vpn.dto';

@Controller('app/topology/vpn')
@UseGuards(JwtAuthGuard, RolesGuard, TenantRolesGuard)
@Roles('tenant_user')
export class VpnController {
  constructor(private readonly vpn: VpnService) {}

  @Get('tunnels')
  list(@CurrentUser() user: AuthUser) {
    return this.vpn.list(user);
  }

  @Post('tunnels')
  @TenantRoles(...CRM_WRITE_ROLES)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateVpnTunnelDto) {
    return this.vpn.create(user, dto);
  }

  @Patch('tunnels/:id')
  @TenantRoles(...CRM_WRITE_ROLES)
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateVpnTunnelDto,
  ) {
    return this.vpn.update(user, id, dto);
  }

  @Delete('tunnels/:id')
  @TenantRoles(...CRM_WRITE_ROLES)
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.vpn.remove(user, id);
  }

  @Get('tunnels/:id/clients')
  listClients(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.vpn.listClients(user, id);
  }

  @Post('tunnels/:id/clients')
  @TenantRoles(...CRM_WRITE_ROLES)
  createClient(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateVpnTunnelClientDto,
  ) {
    return this.vpn.createClient(user, id, dto);
  }

  @Patch('tunnels/:id/clients/:clientId')
  @TenantRoles(...CRM_WRITE_ROLES)
  updateClient(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Body() dto: UpdateVpnTunnelClientDto,
  ) {
    return this.vpn.updateClient(user, id, clientId, dto);
  }

  @Delete('tunnels/:id/clients/:clientId')
  @TenantRoles(...CRM_WRITE_ROLES)
  removeClient(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('clientId', ParseUUIDPipe) clientId: string,
  ) {
    return this.vpn.removeClient(user, id, clientId);
  }

  @Post('tunnels/:id/setup')
  @TenantRoles(...CRM_WRITE_ROLES)
  setup(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VpnSetupDto = {},
  ) {
    return this.vpn.getSetup(user, id, dto?.clientId);
  }

  @Post('tunnels/:id/probe')
  @TenantRoles(...CRM_WRITE_ROLES)
  probe(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.vpn.probeTunnelReachability(user, id);
  }

  @Post('tunnels/:id/import')
  @TenantRoles(...CRM_WRITE_ROLES)
  importToRouter(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ImportVpnToRouterDto,
  ) {
    return this.vpn.importToRouter(
      user,
      id,
      dto.deviceId,
      dto.phase ?? 'all',
      dto.clientId,
    );
  }
}

/** Unauthenticated MikroTik /tool fetch bootstrap (token expires ~5 min). */
@Controller('public/vpn-setup')
export class VpnPublicController {
  constructor(private readonly vpn: VpnService) {}

  @Get(':token')
  @Header('Content-Type', 'text/plain; charset=utf-8')
  async fetchScript(@Param('token') token: string, @Res() res: Response) {
    const script = await this.vpn.getSetupByTokenAcrossTenants(token);
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="isp-control-vpn-setup.rsc"',
    );
    res.send(script);
  }
}
