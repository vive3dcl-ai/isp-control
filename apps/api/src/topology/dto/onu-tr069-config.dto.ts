import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class Tr069WifiPatchDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  index!: number;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  ssid?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  key?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class Tr069EthPatchDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  index!: number;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class Tr069WebUserPatchDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  index!: number;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  username?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  password?: string;
}

export class ApplyTr069OnuConfigDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(16)
  @ValidateNested({ each: true })
  @Type(() => Tr069WifiPatchDto)
  wifi?: Tr069WifiPatchDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(16)
  @ValidateNested({ each: true })
  @Type(() => Tr069EthPatchDto)
  ethernet?: Tr069EthPatchDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(8)
  @ValidateNested({ each: true })
  @Type(() => Tr069WebUserPatchDto)
  webUsers?: Tr069WebUserPatchDto[];

  @IsOptional()
  @IsBoolean()
  refresh?: boolean;
}
