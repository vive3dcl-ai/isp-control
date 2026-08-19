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
import { NetworkNodeService } from './network-node.service';
import {
  CreateNetworkNodeDto,
  CreateNodeHeaderDto,
  NodeHeaderPortDto,
  SetNetworkNodeDevicesDto,
  UpdateNetworkNodeDto,
  UpdateNodeHeaderDto,
} from './shared/dto/network-node.dto';

@Controller('app/network-nodes')
@UseGuards(JwtAuthGuard, RolesGuard, TenantRolesGuard)
@Roles('tenant_user')
export class NetworkNodeController {
  constructor(private readonly nodes: NetworkNodeService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.nodes.list(user);
  }

  @Get('map-markers')
  mapMarkers(@CurrentUser() user: AuthUser) {
    return this.nodes.listMapMarkers(user);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.nodes.get(user, id);
  }

  @Post()
  @TenantRoles(...CRM_WRITE_ROLES)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateNetworkNodeDto) {
    return this.nodes.create(user, dto);
  }

  @Patch(':id')
  @TenantRoles(...CRM_WRITE_ROLES)
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateNetworkNodeDto,
  ) {
    return this.nodes.update(user, id, dto);
  }

  @Delete(':id')
  @TenantRoles(...CRM_WRITE_ROLES)
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.nodes.remove(user, id);
  }

  @Get(':id/assignable-devices')
  assignable(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.nodes.listAssignableDevices(user, id);
  }

  @Put(':id/devices')
  @TenantRoles(...CRM_WRITE_ROLES)
  setDevices(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetNetworkNodeDevicesDto,
  ) {
    return this.nodes.setDevices(user, id, dto.deviceIds);
  }

  // —— Cabeceras de fibra (ODF) ——

  @Get(':id/headers')
  listHeaders(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.nodes.listHeaders(user, id);
  }

  @Post(':id/headers')
  @TenantRoles(...CRM_WRITE_ROLES)
  createHeader(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateNodeHeaderDto,
  ) {
    return this.nodes.createHeader(user, id, dto);
  }

  @Patch(':id/headers/:headerId')
  @TenantRoles(...CRM_WRITE_ROLES)
  updateHeader(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('headerId', ParseUUIDPipe) headerId: string,
    @Body() dto: UpdateNodeHeaderDto,
  ) {
    return this.nodes.updateHeader(user, id, headerId, dto);
  }

  @Patch(':id/headers/:headerId/port')
  @TenantRoles(...CRM_WRITE_ROLES)
  updateHeaderPort(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('headerId', ParseUUIDPipe) headerId: string,
    @Body() dto: NodeHeaderPortDto,
  ) {
    return this.nodes.updateHeaderPort(user, id, headerId, dto);
  }

  @Delete(':id/headers/:headerId')
  @TenantRoles(...CRM_WRITE_ROLES)
  removeHeader(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('headerId', ParseUUIDPipe) headerId: string,
  ) {
    return this.nodes.removeHeader(user, id, headerId);
  }
}
