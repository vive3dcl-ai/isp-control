import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export type SupportMessageAuthorRole = 'tenant' | 'admin';

@Entity({ name: 'support_ticket_messages', schema: 'public' })
export class SupportTicketMessage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'ticket_id', type: 'uuid' })
  ticketId: string;

  @Column({ name: 'author_role', type: 'varchar', length: 20 })
  authorRole: SupportMessageAuthorRole;

  @Column({ name: 'author_user_id', type: 'varchar', length: 80 })
  authorUserId: string;

  @Column({ name: 'author_name', type: 'varchar', length: 120, default: '' })
  authorName: string;

  @Column({ type: 'text' })
  body: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
