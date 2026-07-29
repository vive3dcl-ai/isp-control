import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import type {
  ModuleContractMode,
  ModuleContractStatus,
} from '../billing-cycles';

@Entity({ name: 'platform_module_contracts', schema: 'public' })
export class PlatformModuleContract {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'module_id', type: 'varchar', length: 40 })
  moduleId: string;

  /** one_time = 1 mes; recurring = suma al plan */
  @Column({ type: 'varchar', length: 20 })
  mode: ModuleContractMode;

  @Column({ type: 'varchar', length: 20, default: 'active' })
  status: ModuleContractStatus;

  @Column({
    name: 'monthly_price_usd',
    type: 'numeric',
    precision: 12,
    scale: 2,
  })
  monthlyPriceUsd: string;

  /** Monto cobrado al contratar (pago único o prorrateo). */
  @Column({ name: 'charged_usd', type: 'numeric', precision: 12, scale: 2 })
  chargedUsd: string;

  @Column({ name: 'started_at', type: 'timestamptz' })
  startedAt: Date;

  /** Solo pago único. */
  @Column({ name: 'expires_at', type: 'timestamptz', nullable: true })
  expiresAt: Date | null;

  @Column({ name: 'notified_5d_at', type: 'timestamptz', nullable: true })
  notified5dAt: Date | null;

  @Column({ name: 'notified_2d_at', type: 'timestamptz', nullable: true })
  notified2dAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
