import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/** System-wide ONU custom profile (SmartOLT Generic_1…6 style). */
@Entity({ name: 'onu_profiles' })
export class OnuProfile {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Stable code: generic_1 … generic_6 */
  @Column({ type: 'varchar', length: 40 })
  code: string;

  /** Display name: Generic_1 */
  @Column({ type: 'varchar', length: 80 })
  name: string;

  @Column({ type: 'text', default: '' })
  description: string;

  /**
   * CLI/OMCI fragment applied on ZTE pon-onu-mng, e.g.
   * `vlan port veip_1 mode tag`
   */
  @Column({ name: 'vlan_cli', type: 'varchar', length: 255 })
  vlanCli: string;

  /** eth | veip — target family for UI */
  @Column({ name: 'port_kind', type: 'varchar', length: 20, default: 'eth' })
  portKind: string;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;

  /** Seeded system profiles cannot be deleted */
  @Column({ name: 'is_system', type: 'boolean', default: true })
  isSystem: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
