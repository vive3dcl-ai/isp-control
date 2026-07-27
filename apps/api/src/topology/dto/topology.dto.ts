import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CREATABLE_DEVICE_TYPES } from '../entities/network-device.entity';
import { ROUTER_SUBTYPES } from '../router.constants';
import { OLT_SUBTYPES, OLT_CONNECTION_MODES, OLT_PON_TYPES } from '../olt.constants';

export class CreateNetworkDeviceDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name: string;

  @IsIn([...CREATABLE_DEVICE_TYPES])
  type: string;

  @IsOptional()
  @IsIn([...ROUTER_SUBTYPES, ...OLT_SUBTYPES])
  subtype?: string;

  @IsOptional()
  @IsString()
  note?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  /** Number of initial ports to create (Port 1..N) */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  initialPortCount?: number;
}

export class UpdateNetworkDeviceDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsIn([...CREATABLE_DEVICE_TYPES])
  type?: string;

  @IsOptional()
  @ValidateIf((_, v) => v != null)
  @IsIn([...ROUTER_SUBTYPES, ...OLT_SUBTYPES])
  subtype?: string | null;

  @IsOptional()
  @IsString()
  note?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateDeviceConnectionDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  mgmtHost?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  mgmtPort?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  mgmtUsername?: string | null;

  /** Omit or empty to keep existing password */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  mgmtPassword?: string | null;

  /** MikroTik: rest_https|api_ssl|api_plain — OLT: telnet|ssh */
  @IsOptional()
  @IsIn(['rest_https', 'api_ssl', 'api_plain', 'telnet', 'ssh'])
  mgmtProtocol?: string | null;

  @IsOptional()
  @IsIn([...OLT_CONNECTION_MODES])
  mgmtConnectionMode?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  snmpCommunity?: string | null;

  /** SNMP read-write community (SET); optional until write ops are used */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  snmpCommunityRw?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  snmpPort?: number | null;

  /** Manual override; normally auto-detected from show card */
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== '')
  @IsIn([...OLT_PON_TYPES])
  ponType?: string | null;
}

export class MikrotikCommandDto {
  /** Menu path, e.g. /system/resource or /interface */
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  path?: string;

  /** Raw API words, e.g. ["/ip/address/print", "?disabled=false"] */
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  words?: string[];
}

export class CreateNetworkPortDto {
  @IsUUID()
  deviceId: string;

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  ipAddress?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class UpdateNetworkPortDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  ipAddress?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class PortAddressItemDto {
  /** MikroTik .id when editing an existing entry */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  id?: string;

  /** Full CIDR, e.g. 192.168.1.1/24 */
  @IsString()
  @MinLength(3)
  @MaxLength(64)
  address!: string;
}

export class UpdatePortAddressesDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PortAddressItemDto)
  addresses!: PortAddressItemDto[];
}

export class UpdatePortCommentDto {
  @IsString()
  @MaxLength(500)
  comment!: string;
}

export class CreatePortVlanDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(4094)
  vlanId!: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string;
}

export class CreateNetworkLinkDto {
  @IsUUID()
  portAId: string;

  @IsUUID()
  portBId: string;
}
