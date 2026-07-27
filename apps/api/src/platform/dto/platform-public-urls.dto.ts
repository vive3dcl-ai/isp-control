import { IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';

export class UpdatePlatformPublicUrlsDto {
  @IsOptional()
  @ValidateIf((_, v) => v !== '' && v != null)
  @IsString()
  @MaxLength(500)
  publicApiUrl?: string;

  @IsOptional()
  @ValidateIf((_, v) => v !== '' && v != null)
  @IsString()
  @MaxLength(500)
  publicWebUrl?: string;
}
