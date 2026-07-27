import { IsString, MinLength } from 'class-validator';

/** Must type the tenant slug exactly to confirm destructive delete. */
export class DeleteTenantDto {
  @IsString()
  @MinLength(2)
  confirmationSlug: string;
}
