import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export type NotificationAudience = 'tenant' | 'platform';

export type NotificationType =
  | 'ticket_created'
  | 'ticket_reply'
  | 'ticket_status'
  | 'calendar_assigned'
  | 'device_down'
  | 'generic';

@Entity({ name: 'notifications', schema: 'public' })
export class AppNotification {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'varchar', length: 20 })
  audience: NotificationAudience;

  @Index()
  @Column({ name: 'tenant_id', type: 'uuid', nullable: true })
  tenantId: string | null;

  @Index()
  @Column({ name: 'user_id', type: 'varchar', length: 80, nullable: true })
  userId: string | null;

  @Column({ type: 'varchar', length: 40 })
  type: NotificationType;

  @Column({ type: 'varchar', length: 200 })
  title: string;

  @Column({ type: 'text', default: '' })
  body: string;

  @Column({ type: 'varchar', length: 255, default: '' })
  link: string;

  @Column({ name: 'read_at', type: 'timestamptz', nullable: true })
  readAt: Date | null;

  @Column({ type: 'jsonb', default: () => "'{}'" })
  meta: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
