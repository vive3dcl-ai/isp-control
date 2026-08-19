import {
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { VPN_PROTOCOLS } from '../../vpn.constants';

// Validation intentionally rejects ASCII controls, quotes, and backslashes.
// eslint-disable-next-line no-control-regex
const SAFE_PASSWORD_RE = new RegExp('^[^\\x00-\\x1F\\x7F"\\\\]+$');

export class CreateVpnTunnelDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  @Matches(/^[A-Za-z0-9_-]+$/, {
    message: 'name solo permite letras, números, guion y guion bajo',
  })
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
  @Matches(SAFE_PASSWORD_RE, {
    message: 'password contiene caracteres no permitidos',
  })
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
  @Matches(/^[A-Za-z0-9_-]+$/, {
    message: 'name solo permite letras, números, guion y guion bajo',
  })
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
  @Matches(SAFE_PASSWORD_RE, {
    message: 'password contiene caracteres no permitidos',
  })
  password?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class CreateVpnTunnelClientDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  @Matches(/^[A-Za-z0-9_-]+$/, {
    message: 'name solo permite letras, números, guion y guion bajo',
  })
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  @Matches(/^\d+\.\d+\.\d+\.\d+$/, {
    message: 'clientAddress debe ser una IPv4',
  })
  clientAddress?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  @Matches(SAFE_PASSWORD_RE, {
    message: 'password contiene caracteres no permitidos',
  })
  password?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class UpdateVpnTunnelClientDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  @Matches(/^[A-Za-z0-9_-]+$/, {
    message: 'name solo permite letras, números, guion y guion bajo',
  })
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  @Matches(SAFE_PASSWORD_RE, {
    message: 'password contiene caracteres no permitidos',
  })
  password?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class ImportVpnToRouterDto {
  @IsUUID()
  deviceId!: string;

  /** Cliente VPN a importar (requerido si el túnel tiene varios). */
  @IsOptional()
  @IsUUID()
  clientId?: string;

  /** Fases cortas (evita timeout del proxy). Default: all. */
  @IsOptional()
  @IsIn(['connect', 'plan', 'apply', 'verify', 'all'])
  phase?: 'connect' | 'plan' | 'apply' | 'verify' | 'all';
}

export class VpnSetupDto {
  @IsOptional()
  @IsUUID()
  clientId?: string;
}
