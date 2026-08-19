import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/** SN denylist: orphan ONUs with these SNs are hidden from Huérfanas. */
@Entity({ name: 'onu_denied' })
@Index('uq_onu_denied_sn', ['sn'], { unique: true })
export class OnuDenied {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 40 })
  sn: string;

  @Column({ name: 'olt_id', type: 'uuid', nullable: true })
  oltId: string | null;

  @Column({ name: 'olt_if', type: 'varchar', length: 80, nullable: true })
  oltIf: string | null;

  @Column({ name: 'olt_name', type: 'varchar', length: 120, nullable: true })
  oltName: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  board: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  port: string | null;

  @Column({ name: 'pon_type', type: 'varchar', length: 20, nullable: true })
  ponType: string | null;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  /** true = bloqueo hecho por un operador; nunca se borra automáticamente. */
  @Column({ type: 'boolean', default: true })
  manual: boolean;

  @Column({ name: 'denied_at', type: 'timestamptz' })
  deniedAt: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
