import { Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { MODULE_IDS } from '../module-catalog';

export class UpdateTenantModulesDto {
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  enabledModules!: string[];
}

export class UpdateSmtpConfigDto {
  @IsString()
  @MaxLength(255)
  host!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  port!: number;

  @IsBoolean()
  secure!: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  username?: string;

  /** Si se omite o llega vacío, se conserva la contraseña guardada. */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  password?: string;

  @IsEmail()
  @MaxLength(255)
  fromEmail!: string;

  @IsOptional()
  @IsString()
  @MaxLength(180)
  fromName?: string;
}

export class UpdateMercadoPagoConfigDto {
  @IsIn(['sandbox', 'production'])
  environment!: 'sandbox' | 'production';

  @IsString()
  @MaxLength(255)
  publicKey!: string;

  /** Vacío = conservar el token guardado. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  accessToken?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  webhookSecret?: string;
}

export class UpdateWhatsAppConfigDto {
  @IsIn(['cloud_api', 'baileys'])
  provider!: 'cloud_api' | 'baileys';

  @IsOptional()
  @IsString()
  @MaxLength(80)
  phoneNumberId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  businessAccountId?: string;

  /** Vacío = conservar el token guardado. */
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  accessToken?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  webhookVerifyToken?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  templateName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  templateLanguage?: string;
}

export class WhatsAppBaileysStatusDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  tenantId!: string;

  @IsIn(['disconnected', 'qr', 'connected', 'connecting'])
  status!: 'disconnected' | 'qr' | 'connected' | 'connecting';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2_000_000)
  qrDataUrl?: string;

  /** When false, do not treat as needsAttention / email alert. */
  @IsOptional()
  @IsBoolean()
  alert?: boolean;
}

export class UpdatePlatformPaymentMethodDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsIn(['sandbox', 'production'])
  environment?: 'sandbox' | 'production';

  @IsOptional()
  @IsString()
  @MaxLength(255)
  publicKey?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  accessToken?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  webhookSecret?: string;
}

export class UpdateModulePricingDto {
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  priceMonthly!: number;

  @IsString()
  @MaxLength(3)
  @MinLength(3)
  priceCurrency!: string;
}

export function assertKnownModules(ids: string[]) {
  const known = new Set(MODULE_IDS as string[]);
  for (const id of ids) {
    if (!known.has(id)) {
      return id;
    }
  }
  return null;
}
