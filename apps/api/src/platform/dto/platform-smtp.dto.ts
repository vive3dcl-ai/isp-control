import { IsBoolean, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class UpdatePlatformSmtpDto {
  @IsString()
  host!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  port!: number;

  @IsBoolean()
  secure!: boolean;

  @IsString()
  username!: string;

  /** Vacío = no cambiar. */
  @IsOptional()
  @IsString()
  password?: string;

  @IsString()
  fromEmail!: string;

  @IsString()
  fromName!: string;
}
