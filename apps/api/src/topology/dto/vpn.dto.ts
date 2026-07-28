import {
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { VPN_PROTOCOLS } from '../vpn.constants';

export class CreateVpnTunnelDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name?: string;

  @IsIn([...VPN_PROTOCOLS])
  protocol: string;

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

  /** Fases cortas (evita timeout del proxy). Default: all. */
  @IsOptional()
  @IsIn(['connect', 'plan', 'apply', 'verify', 'all'])
  phase?: 'connect' | 'plan' | 'apply' | 'verify' | 'all';
}
