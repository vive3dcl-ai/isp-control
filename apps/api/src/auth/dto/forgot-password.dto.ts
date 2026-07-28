import { IsEmail, IsIn, IsOptional } from 'class-validator';

export class ForgotPasswordDto {
  @IsEmail()
  email: string;

  @IsOptional()
  @IsIn(['web', 'mobile'])
  channel?: 'web' | 'mobile';
}
