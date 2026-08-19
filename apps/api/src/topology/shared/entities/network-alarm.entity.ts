import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type NetworkAlarmStatus = 'open' | 'cleared';

@Entity({ name: 'network_alarms' })
@Index('idx_network_alarms_status', ['status'])
@Index('idx_network_alarms_onu', ['onuId'])
export class NetworkAlarm {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 32 })
  kind: string;

  @Column({ name: 'onu_id', type: 'uuid', nullable: true })
  onuId: string | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  sn: string | null;

  @Column({ name: 'olt_id', type: 'uuid', nullable: true })
  oltId: string | null;

  @Column({ type: 'varchar', length: 12, default: 'open' })
  status: NetworkAlarmStatus;

  @Column({ type: 'jsonb', default: () => "'{}'" })
  detail: Record<string, unknown>;

  @CreateDateColumn({ name: 'opened_at' })
  openedAt: Date;

  @Column({ name: 'cleared_at', type: 'timestamptz', nullable: true })
  clearedAt: Date | null;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
