import {
  IsEmail,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateTenantDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name: string;

  @IsString()
  @MinLength(2)
  @MaxLength(180)
  legalName: string;

  @IsString()
  @MinLength(7)
  @MaxLength(40)
  phone: string;

  @IsString()
  @MinLength(5)
  @MaxLength(255)
  address: string;

  /** Lowercase slug: letters, numbers, hyphens. Auto-derived from name if omitted. */
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: 'slug must be lowercase alphanumeric with optional hyphens',
  })
  slug?: string;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  ownerName: string;

  @IsEmail()
  ownerEmail: string;

  @IsString()
  @MinLength(8)
  @MaxLength(72)
  ownerPassword: string;
}
