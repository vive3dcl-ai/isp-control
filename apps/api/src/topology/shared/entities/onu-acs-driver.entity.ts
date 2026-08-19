import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/** Receta ACS por modelo (ProductClass / onu_type). No se matchea por SN. */
@Entity({ name: 'onu_acs_drivers' })
@Index('uq_onu_acs_drivers_model', ['modelKey'], { unique: true })
export class OnuAcsDriver {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** ProductClass / onu_type normalizado (único). */
  @Column({ name: 'model_key', type: 'varchar', length: 80 })
  modelKey: string;

  @Column({ type: 'varchar', length: 32 })
  family: string;

  @Column({ name: 'library_id', type: 'varchar', length: 80, nullable: true })
  libraryId: string | null;

  @Column({ name: 'wan_path', type: 'varchar', length: 255, nullable: true })
  wanPath: string | null;

  @Column({ name: 'vlan_leaf', type: 'varchar', length: 255, nullable: true })
  vlanLeaf: string | null;

  @Column({ name: 'bind_leaf', type: 'varchar', length: 255, nullable: true })
  bindLeaf: string | null;

  @Column({ type: 'jsonb', default: () => "'{}'" })
  spv: Record<string, unknown>;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  playbook: string[];

  @Column({ name: 'faults_skip', type: 'jsonb', default: () => "'[]'" })
  faultsSkip: string[];

  @Column({ type: 'varchar', length: 16, default: 'seed' })
  source: 'seed' | 'learned';

  @Column({ type: 'boolean', default: true })
  enabled: boolean;

  @Column({ name: 'success_count', type: 'int', default: 0 })
  successCount: number;

  @Column({ name: 'learned_from_sn', type: 'varchar', length: 40, nullable: true })
  learnedFromSn: string | null;

  @Column({ name: 'needs_reboot_after_creds', type: 'boolean', default: false })
  needsRebootAfterCreds: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
