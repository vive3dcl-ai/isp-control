import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { COMPANY_CURRENCY_CODES } from '../company-currencies';
import { SUSPENSION_PORTAL_TEMPLATE_IDS } from '../../topology/suspension-portal-templates';

/** Tenant self-service company profile (Ajustes → Empresa). */
export class UpdateCompanyDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(180)
  legalName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;

  @IsOptional()
  @ValidateIf((_, v) => v !== '' && v != null)
  @IsEmail()
  @MaxLength(120)
  email?: string;

  @IsOptional()
  @IsString()
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

  /** data URL (image) or absolute URL; ~1MB cap to keep the row sane. */
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

  /** Portal cautivo en MikroTik en lugar de Disable ONU. */
  @IsOptional()
  @IsBoolean()
  suspensionPortalEnabled?: boolean;

  /** Routers MikroTik destino del portal (vacío = no restringir). */
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  suspensionPortalRouterIds?: string[];

  /** Plantilla del portal de suspensión. */
  @IsOptional()
  @IsIn([...SUSPENSION_PORTAL_TEMPLATE_IDS])
  suspensionPortalTemplateId?: string;

  /** Logo del portal (data URL o http(s)); vacío = logo de empresa. */
  @IsOptional()
  @IsString()
  @MaxLength(2_000_000)
  suspensionPortalLogoUrl?: string;

  @IsOptional()
  @IsIn(['internal', 'external'])
  suspensionPortalMode?: 'internal' | 'external';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  suspensionPortalExternalUrl?: string;
}
