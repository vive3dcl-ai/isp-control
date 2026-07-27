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
import {
  OnuConnectedService,
  type OnuImportSnapshot,
} from './onu-connected.service';
import { IpPoolService } from './ip-pool.service';
import { SetOnuTr069Dto, SetOnuNetworkVlansDto } from './dto/ip-pool.dto';
import { OnuTr069ConfigService } from './onu-tr069-config.service';
import { ApplyTr069OnuConfigDto } from './dto/onu-tr069-config.dto';
import {
  IsArray,
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  ValidateIf,
} from 'class-validator';
import { Transform } from 'class-transformer';

class OltIdDto {
  @IsUUID()
  oltId!: string;
}

class SetProvisionModeDto {
  @IsString()
  mode!: 'auto' | 'manual';
}

class OnuRebootDto {
  @IsUUID()
  oltId!: string;

  @IsString()
  onuIf!: string;
}

class OnuImportOneDto {
  @IsUUID()
  oltId!: string;

  @IsString()
  onuIf!: string;

  @IsOptional() @IsString() ponType?: string;
  @IsOptional() @IsString() board?: string;
  @IsOptional() @IsString() port?: string;
  @IsOptional() @IsString() onuId?: string;
  @IsOptional() @IsString() sn?: string | null;
  @IsOptional() @IsString() onuType?: string | null;
  @IsOptional() @IsString() name?: string | null;
  @IsOptional() @IsString() description?: string | null;
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() phaseState?: string;
  @IsOptional() @IsString() adminState?: string;
  @IsOptional() @IsBoolean() online?: boolean;
  @IsOptional() @IsNumber() signalDbm?: number | null;
  @IsOptional() @IsString() mode?: string | null;
  @IsOptional() @IsNumber() vlan?: number | null;
  @IsOptional() @IsArray() vlans?: number[];
}

class UncfgDto {
  @IsOptional()
  @IsUUID()
  oltId?: string;
}

class AuthorizeOnuDto {
  @IsUUID()
  oltId!: string;

  @IsString()
  oltIf!: string;

  @IsString()
  onuId!: string;

  @IsString()
  sn!: string;

  /** Optional preferred type; if omitted/wrong, probe catalog by SN vendor. */
  @IsOptional()
  @IsString()
  onuType?: string | null;

  @IsOptional()
  @IsString()
  name?: string | null;

  /** Texto libre OLT `description` (p. ej. dirección de instalación). */
  @IsOptional()
  @IsString()
  description?: string | null;
}

class UpdateOnuDescriptionDto {
  @IsOptional()
  @IsString()
  description?: string | null;
}

class UpdateOnuZoneDto {
  @IsOptional()
  @Transform(({ value }) =>
    value === null || value === undefined || value === '' ? null : value,
  )
  @ValidateIf((_, v) => v != null)
  @IsUUID()
  zoneId?: string | null;
}

class DenyOnuDto {
  @IsString()
  sn!: string;

  @IsOptional() @IsUUID() oltId?: string | null;
  @IsOptional() @IsString() oltIf?: string | null;
  @IsOptional() @IsString() oltName?: string | null;
  @IsOptional() @IsString() board?: string | null;
  @IsOptional() @IsString() port?: string | null;
  @IsOptional() @IsString() ponType?: string | null;
  @IsOptional() @IsString() note?: string | null;
}

@Controller('app/onus')
@UseGuards(JwtAuthGuard, RolesGuard, TenantRolesGuard)
@Roles('tenant_user')
export class OnuConnectedController {
  constructor(
    private readonly onus: OnuConnectedService,
    private readonly ipPools: IpPoolService,
    private readonly tr069Config: OnuTr069ConfigService,
  ) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.onus.list(user);
  }

  @Get('suggest-import')
  suggestImport(
    @CurrentUser() user: AuthUser,
    @Query('oltId') oltId: string,
  ) {
    return this.onus.suggestImport(user, oltId);
  }

  @Get('detail')
  detail(
    @CurrentUser() user: AuthUser,
    @Query('oltId') oltId: string,
    @Query('onuIf') onuIf: string,
  ) {
    return this.onus.detail(user, oltId, onuIf);
  }

  /** Live SmartOLT-style status (read-only; does not persist samples). */
  @Get('status')
  status(
    @CurrentUser() user: AuthUser,
    @Query('oltId') oltId: string,
    @Query('onuIf') onuIf: string,
  ) {
    return this.onus.statusReport(user, oltId, onuIf);
  }

  /** Running-config of the ONU interface (read-only). */
  @Get('running-config')
  runningConfig(
    @CurrentUser() user: AuthUser,
    @Query('oltId') oltId: string,
    @Query('onuIf') onuIf: string,
  ) {
    return this.onus.runningConfig(user, oltId, onuIf);
  }

  /** Remote ONU equipment / software info (read-only). */
  @Get('sw-info')
  swInfo(
    @CurrentUser() user: AuthUser,
    @Query('oltId') oltId: string,
    @Query('onuIf') onuIf: string,
  ) {
    return this.onus.swInfo(user, oltId, onuIf);
  }

  /** LIVE traffic rates from OLT (read-only; poll while modal is open). */
  @Get('live-traffic')
  liveTraffic(
    @CurrentUser() user: AuthUser,
    @Query('oltId') oltId: string,
    @Query('onuIf') onuIf: string,
  ) {
    return this.onus.liveTraffic(user, oltId, onuIf);
  }

  /** List SN denylist (hidden from Huérfanas). */
  @Get('denied')
  denied(@CurrentUser() user: AuthUser) {
    return this.onus.listDenied(user);
  }

  @Get(':id/metrics')
  metrics(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('hours') hours?: string,
  ) {
    const n = hours != null ? Number(hours) : 6;
    return this.onus.metrics(user, id, Number.isFinite(n) ? n : 6);
  }

  @Post('discover')
  @TenantRoles(...CRM_WRITE_ROLES)
  discover(@CurrentUser() user: AuthUser, @Body() dto: OltIdDto) {
    return this.onus.discover(user, dto.oltId);
  }

  @Post('import-one')
  @TenantRoles(...CRM_WRITE_ROLES)
  importOne(@CurrentUser() user: AuthUser, @Body() dto: OnuImportOneDto) {
    const { oltId, ...snap } = dto;
    return this.onus.importOne(user, oltId, snap as OnuImportSnapshot);
  }

  @Post('import-skip')
  @TenantRoles(...CRM_WRITE_ROLES)
  importSkip(@CurrentUser() user: AuthUser, @Body() dto: OltIdDto) {
    return this.onus.importSkip(user, dto.oltId);
  }

  @Post('sync')
  @TenantRoles(...CRM_WRITE_ROLES)
  sync(@CurrentUser() user: AuthUser, @Body() dto: OltIdDto) {
    return this.onus.sync(user, dto.oltId);
  }

  /** ONUs waiting for authorization on the OLT (uncfg). */
  @Post('uncfg')
  @TenantRoles(...FIELD_INSTALL_ROLES)
  uncfg(@CurrentUser() user: AuthUser, @Body() dto: UncfgDto) {
    return this.onus.listUncfg(user, dto.oltId);
  }

  /** Authorize orphan ONU on OLT and import to Conectadas. */
  @Post('authorize')
  @TenantRoles(...FIELD_INSTALL_ROLES)
  authorize(@CurrentUser() user: AuthUser, @Body() dto: AuthorizeOnuDto) {
    return this.onus.authorize(user, dto);
  }

  /** Deny orphan SN — stays out of Huérfanas until undenied. */
  @Post('deny')
  @TenantRoles(...CRM_WRITE_ROLES)
  deny(@CurrentUser() user: AuthUser, @Body() dto: DenyOnuDto) {
    return this.onus.denyOrphan(user, dto);
  }

  /** Remove SN from denylist. */
  @Delete('denied/:id')
  @TenantRoles(...CRM_WRITE_ROLES)
  undeny(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.onus.undeny(user, id);
  }

  @Post(':id/refresh')
  @TenantRoles(...CRM_WRITE_ROLES)
  refresh(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.onus.refresh(user, id);
  }

  @Patch(':id/description')
  @TenantRoles(...CRM_WRITE_ROLES)
  updateDescription(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateOnuDescriptionDto,
  ) {
    return this.onus.updateDescription(user, id, dto.description ?? '');
  }

  @Patch(':id/zone')
  @TenantRoles(...FIELD_INSTALL_ROLES)
  updateZone(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateOnuZoneDto,
  ) {
    return this.onus.updateZone(user, id, dto.zoneId ?? null);
  }

  @Post(':id/tr069')
  @TenantRoles(...CRM_WRITE_ROLES)
  setTr069(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetOnuTr069Dto,
  ) {
    return this.tr069Config.setOnuTr069(
      user,
      id,
      dto.enabled,
      dto.profileId,
      dto.vlanId,
    );
  }

  /** Step endpoints for progress UI (OLT → assign → apply → verify). */
  @Post(':id/network-vlans/olt')
  @TenantRoles(...FIELD_INSTALL_ROLES)
  networkVlansOlt(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetOnuNetworkVlansDto,
  ) {
    return this.tr069Config.networkVlansOlt(
      user,
      id,
      { mgmtVlanId: dto.mgmtVlanId, wanVlanId: dto.wanVlanId },
      { wanVlanSpecified: Object.prototype.hasOwnProperty.call(dto, 'wanVlanId') },
    );
  }

  @Post(':id/network-vlans/assign')
  @TenantRoles(...FIELD_INSTALL_ROLES)
  networkVlansAssign(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetOnuNetworkVlansDto,
  ) {
    return this.tr069Config.networkVlansAssign(
      user,
      id,
      { mgmtVlanId: dto.mgmtVlanId, wanVlanId: dto.wanVlanId },
      { wanVlanSpecified: Object.prototype.hasOwnProperty.call(dto, 'wanVlanId') },
    );
  }

  @Post(':id/network-vlans/apply')
  @TenantRoles(...FIELD_INSTALL_ROLES)
  networkVlansApply(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetOnuNetworkVlansDto,
  ) {
    return this.tr069Config.networkVlansApplyOnu(
      user,
      id,
      {
        mgmtVlanId: dto.mgmtVlanId,
        wanVlanId: dto.wanVlanId,
        tr069ProfileId: dto.tr069ProfileId,
      },
      { wanVlanSpecified: Object.prototype.hasOwnProperty.call(dto, 'wanVlanId') },
    );
  }

  @Post(':id/network-vlans/verify')
  @TenantRoles(...FIELD_INSTALL_ROLES)
  networkVlansVerify(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.tr069Config.networkVlansVerify(user, id);
  }

  /** Switch ONU provisioning mode: auto (managed) ↔ manual (technician). */
  @Post(':id/provision-mode')
  @TenantRoles(...CRM_WRITE_ROLES)
  setProvisionMode(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetProvisionModeDto,
  ) {
    return this.tr069Config.setProvisionMode(
      user,
      id,
      dto.mode === 'manual' ? 'manual' : 'auto',
    );
  }

  /** Manual-config data for the technician (WAN + mgmt). */
  @Get(':id/manual-config')
  getManualConfig(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.tr069Config.getManualConfig(user, id);
  }

  /** Full pipeline (compat). Prefer step endpoints above. */
  @Post(':id/network-vlans')
  @TenantRoles(...CRM_WRITE_ROLES)
  setNetworkVlans(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetOnuNetworkVlansDto,
  ) {
    return this.tr069Config.setOnuNetworkVlans(
      user,
      id,
      {
        mgmtVlanId: dto.mgmtVlanId,
        wanVlanId: dto.wanVlanId,
        tr069ProfileId: dto.tr069ProfileId,
      },
      { wanVlanSpecified: Object.prototype.hasOwnProperty.call(dto, 'wanVlanId') },
    );
  }

  @Get(':id/tr069-config')
  getTr069Config(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.tr069Config.getConfig(user, id);
  }

  @Post(':id/tr069-config')
  @TenantRoles(...CRM_WRITE_ROLES)
  applyTr069Config(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApplyTr069OnuConfigDto,
  ) {
    return this.tr069Config.applyConfig(user, id, dto);
  }

  @Post('reboot')
  @TenantRoles(...CRM_WRITE_ROLES)
  reboot(@CurrentUser() user: AuthUser, @Body() dto: OnuRebootDto) {
    return this.onus.reboot(user, dto.oltId, dto.onuIf);
  }

  @Post('disable')
  @TenantRoles(...CRM_WRITE_ROLES)
  disable(@CurrentUser() user: AuthUser, @Body() dto: OnuRebootDto) {
    return this.onus.disable(user, dto.oltId, dto.onuIf);
  }

  @Post('enable')
  @TenantRoles(...CRM_WRITE_ROLES)
  enable(@CurrentUser() user: AuthUser, @Body() dto: OnuRebootDto) {
    return this.onus.enable(user, dto.oltId, dto.onuIf);
  }

  @Post('delete')
  @TenantRoles(...CRM_WRITE_ROLES)
  deleteOnu(@CurrentUser() user: AuthUser, @Body() dto: OnuRebootDto) {
    return this.onus.deleteOnu(user, dto.oltId, dto.onuIf);
  }
}
