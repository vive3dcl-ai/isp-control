import {
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
} from 'class-validator';

export class CreateOnuTypeDto {
  @IsIn(['gpon', 'epon'])
  ponType: string;

  @IsOptional()
  @IsString()
  @MaxLength(8)
  channel?: string;

  @IsOptional()
  @IsBoolean()
  channelGpon?: boolean;

  @IsOptional()
  @IsBoolean()
  channelXgpon?: boolean;

  @IsOptional()
  @IsBoolean()
  channelXgspon?: boolean;

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(16)
  ethernetPorts?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(16)
  wifiSsids?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(8)
  voipPorts?: number;

  @IsOptional()
  @IsBoolean()
  catv?: boolean;

  @IsOptional()
  @IsBoolean()
  allowCustomProfiles?: boolean;

  @IsOptional()
  @IsUUID()
  defaultProfileId?: string | null;

  @IsOptional()
  @IsIn(['bridging', 'bridging_routing'])
  capability?: string;

  @IsOptional()
  @IsBoolean()
  useDefaultImage?: boolean;

  @IsOptional()
  @IsString()
  imageUrl?: string | null;
}

export class UpdateOnuTypeDto {
  @IsOptional()
  @IsIn(['gpon', 'epon'])
  ponType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(8)
  channel?: string;

  @IsOptional()
  @IsBoolean()
  channelGpon?: boolean;

  @IsOptional()
  @IsBoolean()
  channelXgpon?: boolean;

  @IsOptional()
  @IsBoolean()
  channelXgspon?: boolean;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(16)
  ethernetPorts?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(16)
  wifiSsids?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(8)
  voipPorts?: number;

  @IsOptional()
  @IsBoolean()
  catv?: boolean;

  @IsOptional()
  @IsBoolean()
  allowCustomProfiles?: boolean;

  @IsOptional()
  @IsUUID()
  defaultProfileId?: string | null;

  @IsOptional()
  @IsIn(['bridging', 'bridging_routing'])
  capability?: string;

  @IsOptional()
  @IsBoolean()
  useDefaultImage?: boolean;

  @IsOptional()
  @IsString()
  imageUrl?: string | null;
}

export class UpdateOnuProfileDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  vlanCli?: string;

  @IsOptional()
  @IsIn(['eth', 'veip'])
  portKind?: string;
}
