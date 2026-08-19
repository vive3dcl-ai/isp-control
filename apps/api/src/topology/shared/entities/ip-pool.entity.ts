import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type IpPoolPurpose = 'internet' | 'management';

@Entity({ name: 'ip_pools' })
@Index('uq_ip_pools_olt_vlan_purpose', ['oltId', 'vlanId', 'purpose'], {
  unique: true,
})
export class IpPool {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'olt_id', type: 'uuid' })
  oltId: string;

  @Column({ name: 'vlan_id', type: 'int' })
  vlanId: number;

  /** internet | management */
  @Column({ type: 'varchar', length: 20 })
  purpose: IpPoolPurpose;

  @Column({ type: 'varchar', length: 120, nullable: true })
  name: string | null;

  @Column({ type: 'varchar', length: 45 })
  gateway: string;

  /** CIDR prefix length, e.g. 24 */
  @Column({ type: 'int' })
  prefix: number;

  /** Computed network address, e.g. 10.70.0.0 */
  @Column({ type: 'varchar', length: 45 })
  network: string;

  /** Primary DNS (internet / WAN pools). */
  @Column({ name: 'dns1', type: 'varchar', length: 45, nullable: true })
  dns1: string | null;

  /** Secondary DNS (internet / WAN pools). */
  @Column({ name: 'dns2', type: 'varchar', length: 45, nullable: true })
  dns2: string | null;

  /** MikroTik where gateway is published as /ip/address on vlan_<id>. */
  @Column({ name: 'router_id', type: 'uuid', nullable: true })
  routerId: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
