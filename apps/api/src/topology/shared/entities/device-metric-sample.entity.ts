import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity({ name: 'device_metric_samples' })
export class DeviceMetricSample {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'device_id', type: 'uuid' })
  deviceId: string;

  @Index()
  @Column({ name: 'sampled_at', type: 'timestamptz' })
  sampledAt: Date;

  @Column({ name: 'cpu_load', type: 'int', nullable: true })
  cpuLoad: number | null;

  /** Used RAM percent 0–100 */
  @Column({
    name: 'memory_used_pct',
    type: 'double precision',
    nullable: true,
  })
  memoryUsedPct: number | null;

  @Column({
    name: 'temperature',
    type: 'double precision',
    nullable: true,
  })
  temperature: number | null;

  @Column({ name: 'uptime_seconds', type: 'bigint', nullable: true })
  uptimeSeconds: string | null;

  /** Contadores absolutos del puerto de salida (RouterOS rx-byte / tx-byte). */
  @Column({ name: 'rx_bytes', type: 'bigint', nullable: true })
  rxBytes: string | null;

  @Column({ name: 'tx_bytes', type: 'bigint', nullable: true })
  txBytes: string | null;

  /** Bits/s estimados desde el delta con la muestra anterior. */
  @Column({
    name: 'rx_bps',
    type: 'double precision',
    nullable: true,
  })
  rxBps: number | null;

  @Column({
    name: 'tx_bps',
    type: 'double precision',
    nullable: true,
  })
  txBps: number | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
