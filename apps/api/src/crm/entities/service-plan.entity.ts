import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { ClientService } from './client-service.entity';
import { SpeedProfile } from './speed-profile.entity';

export type PlanBillingAnchor = 'installation' | 'calendar_month';
export type PlanBillingCycleDay = 'first' | 'last';
export type PlanServiceType = 'internet' | 'tv' | 'telephony';

@Entity({ name: 'service_plans' })
export class ServicePlan {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 120 })
  name: string;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  price: string;

  /** One-time installation charge. */
  @Column({
    name: 'installation_fee',
    type: 'decimal',
    precision: 12,
    scale: 2,
    default: 0,
  })
  installationFee: string;

  /**
   * true = add installation fee to the first recurring invoice
   * false = issue a separate installation invoice immediately on service alta
   */
  @Column({
    name: 'installation_fee_on_first_invoice',
    type: 'boolean',
    default: true,
  })
  installationFeeOnFirstInvoice: boolean;

  @Column({ name: 'invoice_label', type: 'varchar', length: 180, default: '' })
  invoiceLabel: string;

  /** Denormalized from speed profile (kept for display / legacy). */
  @Column({ name: 'download_speed', type: 'int', default: 0 })
  downloadSpeed: number;

  @Column({ name: 'upload_speed', type: 'int', default: 0 })
  uploadSpeed: number;

  /** System speed profile used when provisioning this plan. */
  @Column({ name: 'speed_profile_id', type: 'uuid', nullable: true })
  speedProfileId: string | null;

  @ManyToOne(() => SpeedProfile, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'speed_profile_id' })
  speedProfile: SpeedProfile | null;

  /** Always monthly (legacy columns kept fixed). */
  @Column({ name: 'invoicing_period', type: 'int', default: 1 })
  invoicingPeriod: number;

  @Column({
    name: 'invoicing_period_type',
    type: 'varchar',
    length: 20,
    default: 'month',
  })
  invoicingPeriodType: string;

  /**
   * installation = monthly cycles from install day
   * calendar_month = calendar months; first month prorated
   */
  @Column({
    name: 'billing_anchor',
    type: 'varchar',
    length: 32,
    default: 'installation',
  })
  billingAnchor: PlanBillingAnchor;

  /** Cycle cut/start: first or last day of the cycle. */
  @Column({
    name: 'billing_cycle_day',
    type: 'varchar',
    length: 16,
    default: 'first',
  })
  billingCycleDay: PlanBillingCycleDay;

  /** internet | tv | telephony */
  @Column({
    name: 'service_types',
    type: 'jsonb',
    default: () => `'["internet"]'`,
  })
  serviceTypes: PlanServiceType[];

  /** Legacy display label derived from serviceTypes. */
  @Column({ type: 'varchar', length: 40, default: 'Internet' })
  type: string;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @OneToMany(() => ClientService, (s) => s.servicePlan)
  services: ClientService[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
