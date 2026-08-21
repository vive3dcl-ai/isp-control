import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Singleton row per tenant: cron schedules and invoice numbering.
 * Jobs always run with an explicit schemaName — never across tenants.
 */
@Entity({ name: 'billing_settings' })
export class BillingSettings {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 64, default: 'America/Santiago' })
  timezone: string;

  @Column({ name: 'invoice_prefix', type: 'varchar', length: 20, default: 'F' })
  invoicePrefix: string;

  @Column({ name: 'next_invoice_number', type: 'int', default: 1 })
  nextInvoiceNumber: number;

  /** Maintain billing periods (advance period_start/end / next_billing_date). */
  @Column({ name: 'periods_enabled', type: 'boolean', default: true })
  periodsEnabled: boolean;

  /** Cron (min hour dom mon dow) — default daily 00:05 */
  @Column({
    name: 'periods_cron',
    type: 'varchar',
    length: 64,
    default: '5 0 * * *',
  })
  periodsCron: string;

  @Column({ name: 'periods_last_run_at', type: 'timestamptz', nullable: true })
  periodsLastRunAt: Date | null;

  /** Auto-generate recurring invoices when a period is due. */
  @Column({ name: 'generate_enabled', type: 'boolean', default: true })
  generateEnabled: boolean;

  @Column({
    name: 'generate_cron',
    type: 'varchar',
    length: 64,
    default: '0 6 * * *',
  })
  generateCron: string;

  @Column({ name: 'generate_last_run_at', type: 'timestamptz', nullable: true })
  generateLastRunAt: Date | null;

  /** Auto-send issued invoices by email (tenant SMTP). */
  @Column({ name: 'send_enabled', type: 'boolean', default: true })
  sendEnabled: boolean;

  @Column({
    name: 'send_cron',
    type: 'varchar',
    length: 64,
    default: '0 8 * * *',
  })
  sendCron: string;

  @Column({ name: 'send_last_run_at', type: 'timestamptz', nullable: true })
  sendLastRunAt: Date | null;

  @Column({ name: 'default_due_days', type: 'int', default: 5 })
  defaultDueDays: number;

  /** Días tras el vencimiento antes del corte automático del servicio. */
  @Column({ name: 'grace_days_after_due', type: 'int', default: 2 })
  graceDaysAfterDue: number;

  /** Día del mes (1–28) en que se genera la factura en régimen mensual. */
  @Column({ name: 'billing_cycle_day', type: 'smallint', default: 1 })
  billingCycleDay: number;

  /**
   * calendar_month = cobro fijo de calendario (1.er mes prorrateado).
   * from_install = ciclo mensual desde el día de instalación de cada cliente.
   */
  @Column({
    name: 'billing_regime',
    type: 'varchar',
    length: 32,
    default: 'calendar_month',
  })
  billingRegime: 'calendar_month' | 'from_install';

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
