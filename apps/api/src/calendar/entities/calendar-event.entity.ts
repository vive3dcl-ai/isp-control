import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export const CALENDAR_EVENT_TYPES = [
  'visit',
  'support',
  'installation',
] as const;
export type CalendarEventType = (typeof CALENDAR_EVENT_TYPES)[number];

export const CALENDAR_EVENT_STATUSES = [
  'scheduled',
  'done',
  'cancelled',
] as const;
export type CalendarEventStatus = (typeof CALENDAR_EVENT_STATUSES)[number];

@Entity({ name: 'calendar_events' })
@Index('idx_calendar_events_starts', ['startsAt'])
@Index('idx_calendar_events_type', ['type'])
export class CalendarEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 32 })
  type: CalendarEventType;

  @Column({ type: 'varchar', length: 200 })
  title: string;

  @Column({ type: 'text', default: '' })
  notes: string;

  @Column({ name: 'starts_at', type: 'timestamptz' })
  startsAt: Date;

  @Column({ name: 'ends_at', type: 'timestamptz' })
  endsAt: Date;

  @Column({ name: 'all_day', type: 'boolean', default: false })
  allDay: boolean;

  @Column({ type: 'varchar', length: 20, default: 'scheduled' })
  status: CalendarEventStatus;

  @Column({ name: 'client_id', type: 'uuid', nullable: true })
  clientId: string | null;

  @Column({ name: 'assigned_user_id', type: 'uuid', nullable: true })
  assignedUserId: string | null;

  @Column({ type: 'varchar', length: 255, default: '' })
  address: string;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
