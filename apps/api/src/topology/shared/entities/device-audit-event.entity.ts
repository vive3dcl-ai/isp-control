import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export type DeviceAuditActorKind = 'user' | 'system' | 'poller';

@Entity({ name: 'device_audit_events' })
@Index('idx_device_audit_sn_time', ['sn', 'occurredAt'])
@Index('idx_device_audit_olt_time', ['oltId', 'occurredAt'])
@Index('idx_device_audit_onu_time', ['onuId', 'occurredAt'])
export class DeviceAuditEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @CreateDateColumn({ name: 'occurred_at' })
  occurredAt: Date;

  @Column({ name: 'actor_id', type: 'varchar', length: 80, nullable: true })
  actorId: string | null;

  @Column({ name: 'actor_email', type: 'varchar', length: 160, nullable: true })
  actorEmail: string | null;

  @Column({ name: 'actor_kind', type: 'varchar', length: 16, default: 'user' })
  actorKind: DeviceAuditActorKind;

  @Column({ type: 'varchar', length: 40 })
  action: string;

  @Column({ type: 'boolean', default: true })
  ok: boolean;

  @Column({ name: 'duration_ms', type: 'int', default: 0 })
  durationMs: number;

  @Column({ type: 'varchar', length: 40, nullable: true })
  sn: string | null;

  @Column({ name: 'onu_id', type: 'uuid', nullable: true })
  onuId: string | null;

  @Column({ name: 'olt_id', type: 'uuid', nullable: true })
  oltId: string | null;

  @Column({ name: 'onu_if', type: 'varchar', length: 80, nullable: true })
  onuIf: string | null;

  @Column({ type: 'jsonb', default: () => "'{}'" })
  detail: Record<string, unknown>;
}
