import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { INVOICE_TEMPLATE_TYPES } from '../entities/invoice-template.entity';

export class UpdateBillingSettingsDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(20)
  invoicePrefix?: string;

  @IsOptional()
  @IsBoolean()
  periodsEnabled?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  periodsCron?: string;

  @IsOptional()
  @IsBoolean()
  generateEnabled?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  generateCron?: string;

  @IsOptional()
  @IsBoolean()
  sendEnabled?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  sendCron?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(90)
  defaultDueDays?: number;
}

export class CreateInvoiceTemplateDto {
  @IsIn([...INVOICE_TEMPLATE_TYPES])
  type: (typeof INVOICE_TEMPLATE_TYPES)[number];

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  subject?: string;

  @IsOptional()
  @IsString()
  bodyHtml?: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateInvoiceTemplateDto {
  @IsOptional()
  @IsIn([...INVOICE_TEMPLATE_TYPES])
  type?: (typeof INVOICE_TEMPLATE_TYPES)[number];

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  subject?: string;

  @IsOptional()
  @IsString()
  bodyHtml?: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class RunBillingJobDto {
  @IsIn(['periods', 'generate', 'send'])
  job: 'periods' | 'generate' | 'send';
}

export class SendInvoiceDto {
  /** Destino del correo; si falta se usa el email del cliente. */
  @IsOptional()
  @IsString()
  @MaxLength(180)
  email?: string;
}

export class CreateBillingProductDto {
  @IsString()
  @MinLength(1)
  @MaxLength(180)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  unitPrice: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateBillingProductDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(180)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  unitPrice?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class CreateInvoiceItemDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  description: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  quantity: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  unitPrice: number;

  @IsOptional()
  @IsUUID()
  productId?: string;
}

export class CreateInvoiceDto {
  @IsUUID()
  clientId: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateInvoiceItemDto)
  items: CreateInvoiceItemDto[];

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @IsOptional()
  @IsBoolean()
  sendEmail?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(180)
  email?: string;
}
