import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
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
import { TopologyService } from './topology.service';
import {
  CreateNetworkDeviceDto,
  CreateNetworkLinkDto,
  CreateNetworkPortDto,
  MikrotikCommandDto,
  EnsureBridgeDto,
  SetBridgePortDto,
  UpsertBridgeVlanDto,
  UpdateDeviceConnectionDto,
  UpdateNetworkDeviceDto,
  UpdateNetworkPortDto,
  CreatePortVlanDto,
  UpdatePortAddressesDto,
  UpdatePortCommentDto,
} from './shared/dto/topology.dto';

@Controller('app/topology')
@UseGuards(JwtAuthGuard, RolesGuard, TenantRolesGuard)
@Roles('tenant_user')
export class TopologyController {
  constructor(private readonly topology: TopologyService) {}

  @Get()
  getGraph(@CurrentUser() user: AuthUser) {
    return this.topology.getGraph(user);
  }

  @Get('devices/:id')
  getDevice(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.topology.getDeviceDetail(user, id);
  }

  @Get('devices/:id/metrics')
  getDeviceMetrics(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('hours') hours?: string,
  ) {
    const n = hours != null ? Number(hours) : 6;
    return this.topology.getDeviceMetricHistory(
      user,
      id,
      Number.isFinite(n) ? n : 6,
    );
  }

  @Post('devices')
  @TenantRoles(...CRM_WRITE_ROLES)
  createDevice(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateNetworkDeviceDto,
  ) {
    return this.topology.createDevice(user, dto);
  }

  @Patch('devices/:id')
  @TenantRoles(...CRM_WRITE_ROLES)
  updateDevice(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateNetworkDeviceDto,
  ) {
    return this.topology.updateDevice(user, id, dto);
  }

  @Patch('devices/:id/connection')
  @TenantRoles(...CRM_WRITE_ROLES)
  updateConnection(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDeviceConnectionDto,
  ) {
    return this.topology.updateConnection(user, id, dto);
  }

  @Post('devices/:id/connection/test')
  @TenantRoles(...CRM_WRITE_ROLES)
  testConnection(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.topology.testConnection(user, id);
  }

  @Get('devices/:id/cards')
  getDeviceCards(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.topology.getDeviceCards(user, id);
  }

  @Post('devices/:id/cards/:slot/reboot')
  @TenantRoles(...CRM_WRITE_ROLES)
  rebootDeviceCard(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('slot') slot: string,
    @Body() body?: { rack?: string; shelf?: string },
  ) {
    return this.topology.rebootDeviceCard(user, id, slot, body);
  }

  @Get('devices/:id/pon-ports')
  getDevicePonPorts(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('refresh') refresh?: string,
  ) {
    const force = refresh === '1' || refresh === 'true' || refresh === 'yes';
    return this.topology.getDevicePonPorts(user, id, force);
  }

  @Patch('devices/:id/pon-ports/config')
  @TenantRoles(...CRM_WRITE_ROLES)
  configureDevicePonPort(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body()
    body: {
      ifName: string;
      adminEnabled: boolean;
      description?: string;
      minRangeM?: number;
      maxRangeM?: number;
      maxOnus?: number | null;
    },
  ) {
    return this.topology.configureDevicePonPort(user, id, body);
  }

  @Post('devices/:id/pon-ports/enable-all')
  @TenantRoles(...CRM_WRITE_ROLES)
  enableAllDevicePonPorts(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.topology.enableAllDevicePonPorts(user, id);
  }

  @Post('devices/:id/pon-ports/reboot-onus')
  @TenantRoles(...CRM_WRITE_ROLES)
  rebootDevicePonOnus(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { ifName?: string; slot?: string; all?: boolean },
  ) {
    return this.topology.rebootDevicePonOnus(user, id, body ?? {});
  }

  @Get('devices/:id/rogue-detect')
  getRogueDetect(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.topology.getRogueDetect(user, id);
  }

  @Post('devices/:id/rogue-detect')
  @TenantRoles(...CRM_WRITE_ROLES)
  setRogueDetect(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body()
    body: {
      slots: string[];
      enable: boolean;
      locate?: boolean;
      autoShutdown?: boolean;
    },
  ) {
    return this.topology.setRogueDetect(user, id, body);
  }

  @Post('devices/:id/rogue-detect/check')
  @TenantRoles(...CRM_WRITE_ROLES)
  checkRogueOnus(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.topology.checkRogueOnus(user, id);
  }

  @Get('devices/:id/uplinks')
  getDeviceUplinks(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('refresh') refresh?: string,
  ) {
    const force = refresh === '1' || refresh === 'true' || refresh === 'yes';
    return this.topology.getDeviceUplinks(user, id, force);
  }

  @Patch('devices/:id/uplinks/config')
  @TenantRoles(...CRM_WRITE_ROLES)
  configureDeviceUplink(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body()
    body: {
      ifName: string;
      description?: string;
      addVlans?: string;
      removeVlans?: string;
      mode?: string;
      adminEnabled?: boolean;
    },
  ) {
    return this.topology.configureDeviceUplink(user, id, body);
  }

  @Get('devices/:id/vlans')
  getDeviceVlans(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('refresh') refresh?: string,
  ) {
    const force = refresh === '1' || refresh === 'true' || refresh === 'yes';
    return this.topology.getDeviceVlans(user, id, force);
  }

  @Put('devices/:id/vlans')
  @TenantRoles(...CRM_WRITE_ROLES)
  upsertDeviceVlan(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body()
    body: {
      vlanId: number;
      description?: string;
      isolated?: boolean;
    },
  ) {
    return this.topology.upsertDeviceVlan(user, id, body);
  }

  @Delete('devices/:id/vlans/:vlanId')
  @TenantRoles(...CRM_WRITE_ROLES)
  deleteDeviceVlan(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('vlanId') vlanIdRaw: string,
  ) {
    const vlanId = Number(vlanIdRaw);
    return this.topology.deleteDeviceVlan(user, id, vlanId);
  }

  @Get('devices/:id/speed-profiles')
  getDeviceSpeedProfiles(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('refresh') refresh?: string,
  ) {
    const force = refresh === '1' || refresh === 'true' || refresh === 'yes';
    return this.topology.getDeviceSpeedProfiles(user, id, force);
  }

  @Put('devices/:id/speed-profiles')
  @TenantRoles(...CRM_WRITE_ROLES)
  upsertDeviceSpeedProfile(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body()
    body: {
      name: string;
      downloadMbps: number;
      uploadMbps: number;
    },
  ) {
    return this.topology.upsertDeviceSpeedProfile(user, id, body);
  }

  @Delete('devices/:id/speed-profiles/:name')
  @TenantRoles(...CRM_WRITE_ROLES)
  deleteDeviceSpeedProfile(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('name') name: string,
  ) {
    return this.topology.deleteDeviceSpeedProfile(user, id, name);
  }

  @Post('devices/:id/sync-ports')
  @TenantRoles(...CRM_WRITE_ROLES)
  syncPorts(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.topology.syncPortsFromDevice(user, id);
  }

  @Post('devices/:id/mikrotik/command')
  @TenantRoles(...CRM_WRITE_ROLES)
  mikrotikCommand(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MikrotikCommandDto,
  ) {
    return this.topology.runMikrotikCommand(user, id, dto);
  }

  @Get('devices/:id/bridge')
  getBridge(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.topology.getDeviceBridgeConfig(user, id);
  }

  @Post('devices/:id/bridge/ensure')
  @TenantRoles(...CRM_WRITE_ROLES)
  ensureBridge(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EnsureBridgeDto,
  ) {
    return this.topology.ensureDeviceBridge(user, id, dto);
  }

  @Post('devices/:id/bridge/ports')
  @TenantRoles(...CRM_WRITE_ROLES)
  setBridgePort(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetBridgePortDto,
  ) {
    return this.topology.setDeviceBridgePort(user, id, dto);
  }

  @Put('devices/:id/bridge/vlans')
  @TenantRoles(...CRM_WRITE_ROLES)
  upsertBridgeVlan(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpsertBridgeVlanDto,
  ) {
    return this.topology.upsertDeviceBridgeVlan(user, id, dto);
  }

  @Delete('devices/:id')
  @TenantRoles(...CRM_WRITE_ROLES)
  deleteDevice(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.topology.deleteDevice(user, id);
  }

  @Post('ports')
  @TenantRoles(...CRM_WRITE_ROLES)
  createPort(@CurrentUser() user: AuthUser, @Body() dto: CreateNetworkPortDto) {
    return this.topology.createPort(user, dto);
  }

  @Patch('ports/:id')
  @TenantRoles(...CRM_WRITE_ROLES)
  updatePort(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateNetworkPortDto,
  ) {
    return this.topology.updatePort(user, id, dto);
  }

  @Delete('ports/:id')
  @TenantRoles(...CRM_WRITE_ROLES)
  deletePort(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.topology.deletePort(user, id);
  }

  @Get('ports/:id/addresses')
  getPortAddresses(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('interface') interfaceName?: string,
  ) {
    return this.topology.getPortAddresses(user, id, interfaceName);
  }

  @Put('ports/:id/addresses')
  @TenantRoles(...CRM_WRITE_ROLES)
  updatePortAddresses(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePortAddressesDto,
    @Query('interface') interfaceName?: string,
  ) {
    return this.topology.updatePortAddresses(user, id, dto, interfaceName);
  }

  @Patch('ports/:id/comment')
  @TenantRoles(...CRM_WRITE_ROLES)
  updatePortComment(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePortCommentDto,
    @Query('interface') interfaceName?: string,
  ) {
    return this.topology.updatePortComment(
      user,
      id,
      dto.comment,
      interfaceName,
    );
  }

  @Post('ports/:id/vlans')
  @TenantRoles(...CRM_WRITE_ROLES)
  createPortVlan(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreatePortVlanDto,
  ) {
    return this.topology.createPortVlan(user, id, dto.vlanId, dto.comment);
  }

  @Get('ports/:id/candidates')
  getCandidates(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.topology.getPortCandidates(user, id);
  }

  @Post('links')
  @TenantRoles(...CRM_WRITE_ROLES)
  createLink(@CurrentUser() user: AuthUser, @Body() dto: CreateNetworkLinkDto) {
    return this.topology.createLink(user, dto);
  }

  @Delete('links/:id')
  @TenantRoles(...CRM_WRITE_ROLES)
  deleteLink(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.topology.deleteLink(user, id);
  }
}
