import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Tenant-wide service VLAN catalog.
 * Presence on OLT/MikroTik is synced on assign (create-if-missing).
 */
@Entity({ name: 'service_vlans' })
@Index('uq_service_vlans_vlan_id', ['vlanId'], { unique: true })
export class ServiceVlan {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'vlan_id', type: 'int' })
  vlanId: number;

  @Column({ type: 'varchar', length: 255, nullable: true })
  description: string | null;

  /**
   * Semantic role of the VLAN in the tenant catalog.
   * TV VLANs feed the ONU Ethernet untagged IPTV port picker.
   */
  @Column({ type: 'varchar', length: 20, default: 'internet' })
  purpose: 'internet' | 'management' | 'tv';

  /** OLT device UUIDs this VLAN should exist on. */
  @Column({ name: 'olt_ids', type: 'jsonb', default: () => "'[]'" })
  oltIds: string[];

  /** MikroTik router device UUIDs this VLAN should exist on. */
  @Column({ name: 'router_ids', type: 'jsonb', default: () => "'[]'" })
  routerIds: string[];

  /** MikroTik RouterOS switch device UUIDs this VLAN should exist on. */
  @Column({ name: 'switch_ids', type: 'jsonb', default: () => "'[]'" })
  switchIds: string[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
