import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'olt_config_snapshots' })
export class OltConfigSnapshot {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'olt_id', type: 'uuid' })
  oltId: string;

  @Column({ type: 'varchar', length: 16 })
  source: 'scheduled' | 'manual';

  @Column({ name: 'byte_size', type: 'int' })
  byteSize: number;

  @Column({ type: 'varchar', length: 64 })
  sha256: string;

  @Column({ type: 'boolean', default: false })
  complete: boolean;

  @Column({ name: 'file_name', type: 'varchar', length: 255 })
  fileName: string;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
