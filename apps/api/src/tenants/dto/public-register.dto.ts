import {
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { CreateTenantDto } from './create-tenant.dto';
import { USER_PLAN_CODES } from '../../platform/billing-cycles';

export class PublicRegisterDto extends CreateTenantDto {
  @IsString()
  @IsIn([...USER_PLAN_CODES], { message: 'Plan inválido' })
  planCode: string;

  /** Honeypot anti-bot: debe ir vacío. Si viene con valor, se ignora el alta. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  website?: string;

  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  ownerPasswordConfirm?: string;
}
