import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  Min,
  ValidateNested,
} from 'class-validator';
import { USER_PLAN_CODES } from '../billing-cycles';

export class SystemPlanPriceItemDto {
  @IsIn([...USER_PLAN_CODES])
  code!: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  priceUsd!: number;

  @IsBoolean()
  enabled!: boolean;

  @IsOptional()
  @IsBoolean()
  isFree?: boolean;
}

export class UpdateSystemPlansDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SystemPlanPriceItemDto)
  plans!: SystemPlanPriceItemDto[];

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  extraBlockPriceUsd?: number;
}

export class ChangeSubscriptionPlanDto {
  @IsIn([...USER_PLAN_CODES])
  code!: string;
}

export class AdjustExtraBlocksDto {
  /** Nuevo total de bloques extra (cada uno = 50 usuarios). */
  @Type(() => Number)
  @IsInt()
  @Min(0)
  blocks!: number;
}

export class ContractModuleDto {
  @IsIn(['one_time', 'recurring'])
  mode!: 'one_time' | 'recurring';
}
