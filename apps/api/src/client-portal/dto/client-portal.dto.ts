import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

export class PortalLoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(1)
  password!: string;
}

export class PortalActivateDto {
  @IsString()
  @MinLength(8)
  password!: string;
}

export class PortalUpdateProfileDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsEmail()
  email?: string;
}

export class PortalChangePasswordDto {
  @IsString()
  @MinLength(1)
  currentPassword!: string;

  @IsString()
  @MinLength(8)
  newPassword!: string;
}
