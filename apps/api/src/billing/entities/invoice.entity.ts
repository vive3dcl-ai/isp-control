import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { InvoiceItem } from './invoice-item.entity';

export const INVOICE_TYPES = [
  'service',
  'installation',
  'prorate',
  'credit_note',
  'manual',
] as const;
export type InvoiceType = (typeof INVOICE_TYPES)[number];

export const INVOICE_STATUSES = [
  'draft',
  'issued',
  'sent',
  'paid',
  'void',
  'overdue',
] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

@Entity({ name: 'invoices' })
export class Invoice {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 40 })
  number: string;

  @Column({ name: 'client_id', type: 'uuid' })
  clientId: string;

  @Column({ name: 'client_service_id', type: 'uuid', nullable: true })
  clientServiceId: string | null;

  @Column({ type: 'varchar', length: 32 })
  type: InvoiceType;

  @Column({ type: 'varchar', length: 20, default: 'draft' })
  status: InvoiceStatus;

  @Column({ type: 'varchar', length: 3, default: 'USD' })
  currency: string;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  subtotal: string;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  tax: string;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  total: string;

  @Column({ name: 'period_start', type: 'date', nullable: true })
  periodStart: string | null;

  @Column({ name: 'period_end', type: 'date', nullable: true })
  periodEnd: string | null;

  @Column({ name: 'issue_date', type: 'date' })
  issueDate: string;

  @Column({ name: 'due_date', type: 'date', nullable: true })
  dueDate: string | null;

  @Column({ name: 'sent_at', type: 'timestamptz', nullable: true })
  sentAt: Date | null;

  @Column({ type: 'text', default: '' })
  notes: string;

  @OneToMany(() => InvoiceItem, (i) => i.invoice, { cascade: true })
  items: InvoiceItem[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
