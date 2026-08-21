import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const AI_PROVIDERS = [
  'openai',
  'anthropic',
  'grok',
  'gemini',
  'deepseek',
  'latinrouter',
] as const;

export class UpdatePlatformAiSettingsDto {
  @IsBoolean()
  enabled!: boolean;

  @IsIn(AI_PROVIDERS)
  provider!: (typeof AI_PROVIDERS)[number];

  @IsString()
  @MaxLength(120)
  model!: string;

  /** Vacío = conservar la key guardada. */
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  apiKey?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  dailyRequestLimit!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1000)
  @Max(100_000_000)
  dailyTokenLimit!: number;
}

export class ListPlatformAiModelsDto {
  @IsOptional()
  @IsIn(AI_PROVIDERS)
  provider?: (typeof AI_PROVIDERS)[number];

  /** Vacío = usar la key guardada de plataforma. */
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  apiKey?: string;
}
