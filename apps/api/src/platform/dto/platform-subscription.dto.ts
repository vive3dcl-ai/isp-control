import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsNumber,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { BILLING_CYCLE_IDS } from '../billing-cycles';

export class SystemPlanPriceItemDto {
  @IsIn([...BILLING_CYCLE_IDS])
  cycle!: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  priceUsd!: number;

  @IsBoolean()
  enabled!: boolean;
}

export class UpdateSystemPlansDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SystemPlanPriceItemDto)
  plans!: SystemPlanPriceItemDto[];
}

export class ChangeSubscriptionPlanDto {
  @IsIn([...BILLING_CYCLE_IDS])
  cycle!: string;
}

export class ContractModuleDto {
  @IsIn(['one_time', 'recurring'])
  mode!: 'one_time' | 'recurring';
}
