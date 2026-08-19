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

  /**
   * IGMP MVLAN work-mode on ZTE (only meaningful when purpose=tv).
   * snooping | spr | proxy | router
   */
  @Column({ name: 'igmp_work_mode', type: 'varchar', length: 20, nullable: true })
  igmpWorkMode: 'snooping' | 'spr' | 'proxy' | 'router' | null;

  /**
   * IGMP proxy host-ip (only when purpose=tv and igmpWorkMode=proxy).
   */
  @Column({ name: 'igmp_host_ip', type: 'varchar', length: 45, nullable: true })
  igmpHostIp: string | null;

  /**
   * Per-OLT IGMP MVLAN source-port ifNames (gei_/xgei_).
   * Shape: { [oltDeviceId]: string[] }
   */
  @Column({
    name: 'igmp_source_ports',
    type: 'jsonb',
    default: () => "'{}'",
  })
  igmpSourcePorts: Record<string, string[]>;

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
