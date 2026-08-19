import {
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateTr069ProfileDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  acsUrl?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  acsPort?: number;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  acsUsername?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  acsPassword?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  connectionRequestUsername?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  connectionRequestPassword?: string;

  @IsOptional()
  @IsBoolean()
  periodicInformEnable?: boolean;

  @IsOptional()
  @IsInt()
  @Min(30)
  @Max(86400)
  periodicInformInterval?: number;
}

export class UpdateTr069ProfileDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  acsUrl?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  acsPort?: number;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  acsUsername?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  acsPassword?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  connectionRequestUsername?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  connectionRequestPassword?: string;

  @IsOptional()
  @IsBoolean()
  periodicInformEnable?: boolean;

  @IsOptional()
  @IsInt()
  @Min(30)
  @Max(86400)
  periodicInformInterval?: number;
}

export class SetTr069ProfileOltsDto {
  @IsArray()
  @IsUUID('4', { each: true })
  deviceIds: string[];
}
