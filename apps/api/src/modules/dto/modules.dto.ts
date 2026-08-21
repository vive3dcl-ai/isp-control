import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
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
  ValidateNested,
} from 'class-validator';
import { MODULE_IDS } from '../module-catalog';

export class UpdateTenantModulesDto {
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  enabledModules!: string[];

  /**
   * Permitir modo «Interno» del Asistente IA (keys/cupos de plataforma).
   * Si se omite, no se modifica.
   */
  @IsOptional()
  @IsBoolean()
  aiInternalEnabled?: boolean;
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

export class UpdateAsistenteIaConfigDto {
  @IsIn(['own', 'internal'])
  mode!: 'own' | 'internal';

  @IsOptional()
  @IsIn([
    'openai',
    'anthropic',
    'grok',
    'gemini',
    'deepseek',
    'latinrouter',
  ])
  provider?:
    | 'openai'
    | 'anthropic'
    | 'grok'
    | 'gemini'
    | 'deepseek'
    | 'latinrouter';

  @IsOptional()
  @IsString()
  @MaxLength(120)
  model?: string;

  /** Vacío = conservar la key guardada. */
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  apiKey?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class ListAsistenteIaModelsDto {
  @IsIn([
    'openai',
    'anthropic',
    'grok',
    'gemini',
    'deepseek',
    'latinrouter',
  ])
  provider!:
    | 'openai'
    | 'anthropic'
    | 'grok'
    | 'gemini'
    | 'deepseek'
    | 'latinrouter';

  /** Vacío = usar la key guardada del tenant. */
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  apiKey?: string;
}

export class AsistenteChatActivityDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  id?: string;

  @IsOptional()
  @IsIn(['tool', 'skill', 'plan'])
  kind?: 'tool' | 'skill' | 'plan';

  @IsOptional()
  @IsString()
  @MaxLength(120)
  slug?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsIn(['running', 'done', 'error'])
  status?: 'running' | 'done' | 'error';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  detail?: string;

  @IsOptional()
  @IsBoolean()
  mutates?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  at?: string;
}

export class AsistenteChatMessageDto {
  @IsIn(['user', 'assistant', 'system'])
  role!: 'user' | 'assistant' | 'system';

  @IsString()
  @MaxLength(12000)
  content!: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  id?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AsistenteChatActivityDto)
  @ArrayMaxSize(40)
  activities?: AsistenteChatActivityDto[];
}

export class AsistenteChatDto {
  @IsArray()
  @ArrayMaxSize(40)
  @ValidateNested({ each: true })
  @Type(() => AsistenteChatMessageDto)
  messages!: AsistenteChatMessageDto[];

  /** Si true, el agente no puede modificar nada (solo leer / orientar). */
  @IsOptional()
  @IsBoolean()
  readOnly?: boolean;

  /**
   * Si true, cada cambio del agente debe registrar un punto de restauración
   * exacto para poder deshacerlo.
   */
  @IsOptional()
  @IsBoolean()
  restorePoints?: boolean;

  /**
   * Si true, el agente planifica y encadena más rondas de tools.
   */
  @IsOptional()
  @IsBoolean()
  thinking?: boolean;

  /** Id de sesión de chat (agrupa restore points). */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  sessionId?: string;

  /** Resumen de contexto previo (sesiones largas compactadas). */
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  contextSummary?: string;
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

  /** Mercado Pago */
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

  /** PayPal */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  clientId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  clientSecret?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  webhookId?: string;
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
