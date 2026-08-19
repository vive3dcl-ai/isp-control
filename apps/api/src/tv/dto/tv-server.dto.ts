import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateTvServerDto {
  @IsUUID()
  deviceId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  sshHost!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  sshPort?: number;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  sshUsername!: string;

  @IsString()
  @MinLength(1)
  sshPassword!: string;

  /** Agent listen, e.g. ":8099" or "0.0.0.0:8099" */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  apiListen?: string;

  /**
   * Base URL the API will use to reach the agent after install.
   * Defaults to http://{sshHost}:{listenPort}
   */
  @IsOptional()
  @IsString()
  @MaxLength(512)
  apiBaseUrl?: string;

  /** Multicast segment for channels, e.g. 239.1.1.0/24 */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  multicastCidr?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  multicastPort?: number;
}

export class UpdateTvServerDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  multicastCidr?: string | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  multicastPort?: number;
}

export class TvInstallStepDto {
  @IsIn([
    'ssh',
    'detect',
    'upload',
    'install',
    'health',
    'rewrite',
    'verify',
  ])
  step!:
    | 'ssh'
    | 'detect'
    | 'upload'
    | 'install'
    | 'health'
    | 'rewrite'
    | 'verify';
}
