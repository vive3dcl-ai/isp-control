import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Unique,
} from 'typeorm';
import type { BillingCycleId } from '../billing-cycles';

/** Precio del valor del sistema por ciclo de facturación. */
@Entity({ name: 'platform_system_plans', schema: 'public' })
@Unique(['cycle'])
export class PlatformSystemPlan {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** monthly | quarterly | semiannual | annual */
  @Column({ type: 'varchar', length: 20 })
  cycle: BillingCycleId;

  @Column({ type: 'int' })
  months: number;

  @Column({ type: 'varchar', length: 40 })
  label: string;

  /** Precio USD por ciclo completo (prepago). */
  @Column({ name: 'price_usd', type: 'numeric', precision: 12, scale: 2 })
  priceUsd: string;

  @Column({ type: 'boolean', default: true })
  enabled: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
