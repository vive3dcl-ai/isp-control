import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Tenant } from './tenant.entity';
import type { TenantUserRole } from '../../auth/roles';

export type { TenantUserRole };

@Entity({ name: 'user_directory', schema: 'public' })
export class UserDirectory {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255, unique: true })
  email: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @ManyToOne(() => Tenant)
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @Column({ type: 'varchar', length: 20 })
  role: TenantUserRole;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
