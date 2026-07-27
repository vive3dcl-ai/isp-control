import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export const INVOICE_TEMPLATE_TYPES = [
  'service',
  'installation',
  'prorate',
  'credit_note',
  'manual',
  'custom',
] as const;

export type InvoiceTemplateType = (typeof INVOICE_TEMPLATE_TYPES)[number];

@Entity({ name: 'invoice_templates' })
export class InvoiceTemplate {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 32 })
  type: InvoiceTemplateType;

  @Column({ type: 'varchar', length: 120 })
  name: string;

  /** Email / document subject with {{placeholders}}. */
  @Column({ type: 'varchar', length: 255, default: '' })
  subject: string;

  @Column({ name: 'body_html', type: 'text', default: '' })
  bodyHtml: string;

  @Column({ name: 'is_default', type: 'boolean', default: false })
  isDefault: boolean;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
