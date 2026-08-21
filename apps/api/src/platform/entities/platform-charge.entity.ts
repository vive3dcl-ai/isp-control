import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/**
 * Historial de cobros de plataforma (prepago).
 * Renovaciones se generan 10 días antes del aniversario de contrato (status pending).
 */
@Entity({ name: 'platform_charges', schema: 'public' })
export class PlatformCharge {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  /**
   * renewal | plan_change | module_one_time | module_prorate | initial | service
   */
  @Column({ type: 'varchar', length: 40 })
  kind: string;

  @Column({ type: 'varchar', length: 255, default: '' })
  description: string;

  @Column({ name: 'amount_usd', type: 'numeric', precision: 12, scale: 2 })
  amountUsd: string;

  /** pending | paid | failed | cancelled | recorded (legacy = paid) */
  @Index()
  @Column({ type: 'varchar', length: 20, default: 'pending' })
  status: string;

  /** Inicio del ciclo que cubre este cobro (renovación). */
  @Column({ name: 'covers_from', type: 'timestamptz', nullable: true })
  coversFrom: Date | null;

  /** Fin del ciclo que cubre este cobro. */
  @Column({ name: 'covers_to', type: 'timestamptz', nullable: true })
  coversTo: Date | null;

  /** Vencimiento de la suscripción actual que originó la renovación. */
  @Column({ name: 'due_at', type: 'timestamptz', nullable: true })
  dueAt: Date | null;

  @Column({ name: 'paid_at', type: 'timestamptz', nullable: true })
  paidAt: Date | null;

  @Column({ name: 'notified_5d_at', type: 'timestamptz', nullable: true })
  notified5dAt: Date | null;

  @Column({ name: 'notified_2d_at', type: 'timestamptz', nullable: true })
  notified2dAt: Date | null;

  @Column({ type: 'jsonb', default: () => `'{}'` })
  meta: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
