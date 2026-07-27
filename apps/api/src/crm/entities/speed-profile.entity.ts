import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

/** Named download/upload speeds for ONU / OLT traffic profiles. */
@Entity({ name: 'speed_profiles' })
export class SpeedProfile {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 120 })
  name: string;

  @Column({ name: 'download_mbps', type: 'int', default: 0 })
  downloadMbps: number;

  @Column({ name: 'upload_mbps', type: 'int', default: 0 })
  uploadMbps: number;

  @Column({ type: 'text', default: '' })
  description: string;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  /** OLTs where this system profile should exist (tcont/traffic). */
  @Column({ name: 'olt_ids', type: 'jsonb', default: () => "'[]'" })
  oltIds: string[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
