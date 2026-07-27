import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

export class LoginDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(6)
  password: string;

  /** Persist longer session (JWT 30d vs default). */
  @IsOptional()
  @IsBoolean()
  remember?: boolean;

  /** mobile = solo usuarios de empresa (tenant). */
  @IsOptional()
  @IsIn(['web', 'mobile'])
  channel?: 'web' | 'mobile';
}
