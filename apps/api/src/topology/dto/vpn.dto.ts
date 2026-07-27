import {
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { VPN_MODES, VPN_PROTOCOLS } from '../vpn.constants';

export class CreateVpnTunnelDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name?: string;

  @IsIn([...VPN_PROTOCOLS])
  protocol: string;

  /** outbound (default) | reverse */
  @IsOptional()
  @IsIn([...VPN_MODES])
  mode?: string;

  /** Public MikroTik host/IP — required when mode=reverse */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  endpointHost?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  tunnelSubnet?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  tunnelRoutes?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  password?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class UpdateVpnTunnelDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  endpointHost?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  tunnelSubnet?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  tunnelRoutes?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  password?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class ImportVpnToRouterDto {
  @IsUUID()
  deviceId: string;
}
