import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { NetworkDevice } from './network-device.entity';

/** Physical link state from the device (MikroTik running/disabled). */
export type PortLinkStatus = 'unknown' | 'up' | 'down' | 'disabled';

export type PortVlanMode = 'tagged' | 'untagged';

export interface PortVlanAssignment {
  vlanId: number;
  mode: PortVlanMode;
  /** RouterOS interface that holds L3 for this VLAN */
  interfaceName?: string;
  /** Cached CIDR addresses on the VLAN interface */
  ipAddresses?: string[];
  /** Comment from /interface/vlan */
  comment?: string;
}


@Entity({ name: 'network_ports' })
export class NetworkPort {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'device_id', type: 'uuid' })
  deviceId: string;

  @ManyToOne(() => NetworkDevice, (d) => d.ports, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'device_id' })
  device: NetworkDevice;

  @Column({ type: 'varchar', length: 80 })
  name: string;

  /** Hardware / factory name (MikroTik default-name), stable across renames */
  @Column({ name: 'default_name', type: 'varchar', length: 80, nullable: true })
  defaultName: string | null;

  @Column({ name: 'mac_address', type: 'varchar', length: 32, nullable: true })
  macAddress: string | null;

  @Column({ type: 'text', default: '' })
  comment: string;

  @Column({ name: 'ip_address', type: 'varchar', length: 64, nullable: true })
  ipAddress: string | null;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;

  /** Physical port link: up / down / disabled / unknown */
  @Column({ name: 'link_status', type: 'varchar', length: 20, default: 'unknown' })
  linkStatus: PortLinkStatus;

  /** True when port was discovered from the live device (read-only in UI). */
  @Column({ name: 'is_synced', type: 'boolean', default: false })
  isSynced: boolean;

  /** VLANs on this port from the live device (read-only). */
  @Column({ type: 'jsonb', default: () => "'[]'" })
  vlans: PortVlanAssignment[];

  /** All IPv4/IPv6 addresses (CIDR) on this interface from the device. */
  @Column({ name: 'ip_addresses', type: 'jsonb', default: () => "'[]'" })
  ipAddresses: string[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
