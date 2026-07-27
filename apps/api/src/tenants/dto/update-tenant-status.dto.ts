import { IsIn } from 'class-validator';

export class UpdateTenantStatusDto {
  @IsIn(['active', 'inactive', 'suspended'])
  status: 'active' | 'inactive' | 'suspended';
}
