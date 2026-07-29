import {
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { COMPANY_CURRENCY_CODES } from '../company-currencies';

export class UpdateTenantDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(180)
  legalName?: string;

  @IsOptional()
  @IsString()
  @MinLength(7)
  @MaxLength(40)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  email?: string;

  @IsOptional()
  @IsString()
  @MinLength(5)
  @MaxLength(255)
  address?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  city?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  country?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  taxId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(180)
  legalRepresentative?: string;

  @IsOptional()
  @IsIn([...COMPANY_CURRENCY_CODES])
  currency?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2_000_000)
  logoUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  invoiceFooter?: string;

  @IsOptional()
  @IsIn(['Factura', 'Boleta'])
  invoiceDocLabel?: string;

  @IsOptional()
  @IsIn(['active', 'inactive', 'suspended'])
  status?: 'active' | 'inactive' | 'suspended';
}
