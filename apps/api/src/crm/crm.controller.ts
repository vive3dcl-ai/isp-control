import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import {
  CRM_WRITE_ROLES,
  FIELD_INSTALL_ROLES,
  TenantRoles,
} from '../auth/decorators/tenant-roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { TenantRolesGuard } from '../auth/guards/tenant-roles.guard';
import type { AuthUser } from '../auth/auth.types';
import { CrmService } from './crm.service';
import { BillingService } from '../billing/billing.service';
import { CreateClientDto, UpdateClientDto } from './dto/client.dto';
import {
  CreateServicePlanDto,
  UpdateServicePlanDto,
} from './dto/service-plan.dto';
import {
  CreateSpeedProfileDto,
  UpdateSpeedProfileDto,
  SpeedProfileOltDto,
} from './dto/speed-profile.dto';
import {
  CreateClientServiceDto,
  UpdateClientServiceDto,
} from './dto/client-service.dto';
import { CreateZoneDto, UpdateZoneDto } from './dto/zone.dto';

@Controller('app')
@UseGuards(JwtAuthGuard, RolesGuard, TenantRolesGuard)
@Roles('tenant_user')
export class CrmController {
  constructor(
    private readonly crm: CrmService,
    private readonly billing: BillingService,
  ) {}

  // —— Clients ——

  @Get('clients')
  listClients(@CurrentUser() user: AuthUser) {
    return this.crm.listClients(user);
  }

  /** Ubicaciones para el módulo Mapa de red (clientes + servicios con ONU). */
  @Get('network-map/locations')
  listNetworkMapLocations(@CurrentUser() user: AuthUser) {
    return this.crm.listNetworkMapLocations(user);
  }

  @Get('clients/:id')
  getClient(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.crm.getClient(user, id);
  }

  @Get('clients/:id/invoices')
  listClientInvoices(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.billing.listClientInvoices(user, id);
  }

  @Post('clients')
  @TenantRoles(...FIELD_INSTALL_ROLES)
  createClient(@CurrentUser() user: AuthUser, @Body() dto: CreateClientDto) {
    return this.crm.createClient(user, dto);
  }

  @Patch('clients/:id')
  @TenantRoles(...FIELD_INSTALL_ROLES)
  updateClient(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateClientDto,
  ) {
    return this.crm.updateClient(user, id, dto);
  }

  @Delete('clients/:id')
  @TenantRoles(...CRM_WRITE_ROLES)
  deleteClient(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.crm.deleteClient(user, id);
  }

  // —— Zones ——

  @Get('zones')
  listZones(@CurrentUser() user: AuthUser) {
    return this.crm.listZones(user);
  }

  @Get('zones/:id')
  getZone(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.crm.getZone(user, id);
  }

  @Post('zones')
  @TenantRoles(...CRM_WRITE_ROLES)
  createZone(@CurrentUser() user: AuthUser, @Body() dto: CreateZoneDto) {
    return this.crm.createZone(user, dto);
  }

  @Patch('zones/:id')
  @TenantRoles(...CRM_WRITE_ROLES)
  updateZone(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateZoneDto,
  ) {
    return this.crm.updateZone(user, id, dto);
  }

  @Delete('zones/:id')
  @TenantRoles(...CRM_WRITE_ROLES)
  deleteZone(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.crm.deleteZone(user, id);
  }

  // —— Service plans ——

  @Get('service-plans')
  listPlans(@CurrentUser() user: AuthUser) {
    return this.crm.listPlans(user);
  }

  @Get('service-plans/:id')
  getPlan(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.crm.getPlan(user, id);
  }

  @Post('service-plans')
  @TenantRoles(...CRM_WRITE_ROLES)
  createPlan(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateServicePlanDto,
  ) {
    return this.crm.createPlan(user, dto);
  }

  @Patch('service-plans/:id')
  @TenantRoles(...CRM_WRITE_ROLES)
  updatePlan(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateServicePlanDto,
  ) {
    return this.crm.updatePlan(user, id, dto);
  }

  @Delete('service-plans/:id')
  @TenantRoles(...CRM_WRITE_ROLES)
  deletePlan(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.crm.deletePlan(user, id);
  }

  // —— Speed profiles ——

  @Get('speed-profiles')
  listSpeedProfiles(@CurrentUser() user: AuthUser) {
    return this.crm.listSpeedProfiles(user);
  }

  @Get('speed-profiles/:id')
  getSpeedProfile(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('onlyOltId') onlyOltId?: string,
  ) {
    return this.crm.getSpeedProfile(user, id, {
      probe: true,
      onlyOltId: onlyOltId || undefined,
    });
  }

  @Post('speed-profiles')
  @TenantRoles(...CRM_WRITE_ROLES)
  createSpeedProfile(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateSpeedProfileDto,
  ) {
    return this.crm.createSpeedProfile(user, dto);
  }

  @Patch('speed-profiles/:id')
  @TenantRoles(...CRM_WRITE_ROLES)
  updateSpeedProfile(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSpeedProfileDto,
  ) {
    return this.crm.updateSpeedProfile(user, id, dto);
  }

  @Delete('speed-profiles/:id')
  @TenantRoles(...CRM_WRITE_ROLES)
  deleteSpeedProfile(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.crm.deleteSpeedProfile(user, id);
  }

  @Post('speed-profiles/:id/assign-olt')
  @TenantRoles(...CRM_WRITE_ROLES)
  assignSpeedProfileOlt(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SpeedProfileOltDto,
  ) {
    return this.crm.assignSpeedProfileOlt(user, id, dto.oltId);
  }

  @Post('speed-profiles/:id/unassign-olt')
  @TenantRoles(...CRM_WRITE_ROLES)
  unassignSpeedProfileOlt(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SpeedProfileOltDto,
  ) {
    return this.crm.unassignSpeedProfileOlt(user, id, dto.oltId);
  }

  @Post('speed-profiles/:id/sync-olt')
  @TenantRoles(...CRM_WRITE_ROLES)
  syncSpeedProfileOlt(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SpeedProfileOltDto,
  ) {
    return this.crm.syncSpeedProfileOlt(user, id, dto.oltId);
  }

  // —— Client services ——

  @Get('clients/:clientId/services')
  listClientServices(
    @CurrentUser() user: AuthUser,
    @Param('clientId', ParseUUIDPipe) clientId: string,
  ) {
    return this.crm.listClientServices(user, clientId);
  }

  @Post('clients/:clientId/services')
  @TenantRoles(...FIELD_INSTALL_ROLES)
  createClientService(
    @CurrentUser() user: AuthUser,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Body() dto: CreateClientServiceDto,
  ) {
    return this.crm.createClientService(user, clientId, dto);
  }

  @Patch('client-services/:id')
  @TenantRoles(...CRM_WRITE_ROLES)
  updateClientService(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateClientServiceDto,
  ) {
    return this.crm.updateClientService(user, id, dto);
  }

  @Post('client-services/:id/suspend')
  @TenantRoles(...CRM_WRITE_ROLES)
  suspendService(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.crm.setServiceStatus(user, id, 'suspended');
  }

  @Post('client-services/:id/end')
  @TenantRoles(...CRM_WRITE_ROLES)
  endService(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.crm.setServiceStatus(user, id, 'ended');
  }

  @Post('client-services/:id/activate')
  @TenantRoles(...CRM_WRITE_ROLES)
  activateService(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.crm.setServiceStatus(user, id, 'active');
  }
}
