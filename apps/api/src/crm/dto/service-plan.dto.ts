import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';

export const PLAN_SERVICE_TYPES = ['internet', 'tv', 'telephony'] as const;
export type PlanServiceTypeDto = (typeof PLAN_SERVICE_TYPES)[number];

export const PLAN_BILLING_ANCHORS = ['installation', 'calendar_month'] as const;
export const PLAN_BILLING_CYCLE_DAYS = ['first', 'last'] as const;

export class CreateServicePlanDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  price: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  installationFee?: number;

  /** If true, fee goes on first invoice; if false, invoice on service alta. */
  @IsOptional()
  @IsBoolean()
  installationFeeOnFirstInvoice?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(180)
  invoiceLabel?: string;

  /** Required: system speed profile for this plan. */
  @IsUUID()
  speedProfileId: string;

  /** Monthly cycles from install day, or calendar month (prorate first). */
  @IsIn([...PLAN_BILLING_ANCHORS])
  billingAnchor: (typeof PLAN_BILLING_ANCHORS)[number];

  /** First or last day of the billing cycle. */
  @IsIn([...PLAN_BILLING_CYCLE_DAYS])
  billingCycleDay: (typeof PLAN_BILLING_CYCLE_DAYS)[number];

  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsIn([...PLAN_SERVICE_TYPES], { each: true })
  serviceTypes: PlanServiceTypeDto[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  decoCount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  additionalDecoPrice?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateServicePlanDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  price?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  installationFee?: number;

  @IsOptional()
  @IsBoolean()
  installationFeeOnFirstInvoice?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(180)
  invoiceLabel?: string;

  @IsOptional()
  @IsUUID()
  speedProfileId?: string;

  @IsOptional()
  @IsIn([...PLAN_BILLING_ANCHORS])
  billingAnchor?: (typeof PLAN_BILLING_ANCHORS)[number];

  @IsOptional()
  @IsIn([...PLAN_BILLING_CYCLE_DAYS])
  billingCycleDay?: (typeof PLAN_BILLING_CYCLE_DAYS)[number];

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsIn([...PLAN_SERVICE_TYPES], { each: true })
  serviceTypes?: PlanServiceTypeDto[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  decoCount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  additionalDecoPrice?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
