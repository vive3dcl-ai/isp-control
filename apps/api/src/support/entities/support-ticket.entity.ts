import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export const SUPPORT_TICKET_CATEGORIES = [
  'billing',
  'technical',
  'account',
  'other',
] as const;
export type SupportTicketCategory = (typeof SUPPORT_TICKET_CATEGORIES)[number];

export const SUPPORT_TICKET_STATUSES = [
  'open',
  'awaiting_tenant',
  'awaiting_admin',
  'resolved',
  'closed',
] as const;
export type SupportTicketStatus = (typeof SUPPORT_TICKET_STATUSES)[number];

export const SUPPORT_TICKET_PRIORITIES = ['low', 'normal', 'high'] as const;
export type SupportTicketPriority = (typeof SUPPORT_TICKET_PRIORITIES)[number];

@Entity({ name: 'support_tickets', schema: 'public' })
export class SupportTicket {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'created_by_user_id', type: 'varchar', length: 80 })
  createdByUserId: string;

  @Column({ type: 'varchar', length: 200 })
  subject: string;

  @Column({ type: 'varchar', length: 40, default: 'other' })
  category: SupportTicketCategory;

  @Index()
  @Column({ type: 'varchar', length: 40, default: 'open' })
  status: SupportTicketStatus;

  @Column({ type: 'varchar', length: 20, default: 'normal' })
  priority: SupportTicketPriority;

  @Column({ name: 'last_message_at', type: 'timestamptz' })
  lastMessageAt: Date;

  @Column({ name: 'tenant_unread', type: 'boolean', default: false })
  tenantUnread: boolean;

  @Column({ name: 'admin_unread', type: 'boolean', default: true })
  adminUnread: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
