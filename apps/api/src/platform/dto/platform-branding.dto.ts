import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdatePlatformBrandingDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  productName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(24)
  shortName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(180)
  pageTitle?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  metaDescription?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  metaKeywords?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2_000_000)
  logoUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2_000_000)
  faviconUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2_000_000)
  ogImageUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  footerText?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  footerCopyright?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  loginTagline?: string;
}
