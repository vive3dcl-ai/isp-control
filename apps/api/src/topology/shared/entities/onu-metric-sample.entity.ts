import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity({ name: 'onu_metric_samples' })
@Index('idx_onu_metric_samples_onu_kind_time', ['onuId', 'kind', 'sampledAt'])
export class OnuMetricSample {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'onu_id', type: 'uuid' })
  onuId: string;

  /** signal | rx_bps | tx_bps */
  @Column({ type: 'varchar', length: 20 })
  kind: string;

  @Column({ type: 'double precision' })
  value: number;

  @Column({ name: 'sampled_at', type: 'timestamptz' })
  sampledAt: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
