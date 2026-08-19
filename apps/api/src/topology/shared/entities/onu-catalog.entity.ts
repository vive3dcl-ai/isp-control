import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/** Global ONU model catalog (public schema) — shared by all tenants. */
@Entity({ name: 'onu_catalog', schema: 'public' })
export class OnuCatalogItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** zte | huawei | fiberhome | other */
  @Column({ type: 'varchar', length: 40 })
  vendor: string;

  @Column({ type: 'varchar', length: 80 })
  name: string;

  /** gpon | epon */
  @Column({ name: 'pon_type', type: 'varchar', length: 20 })
  ponType: string;

  @Column({ name: 'ethernet_ports', type: 'int', default: 1 })
  ethernetPorts: number;

  @Column({ name: 'wifi_ssids', type: 'int', default: 0 })
  wifiSsids: number;

  @Column({ name: 'voip_ports', type: 'int', default: 0 })
  voipPorts: number;

  @Column({ type: 'boolean', default: false })
  catv: boolean;

  /** bridging | bridging_routing */
  @Column({ type: 'varchar', length: 40, default: 'bridging_routing' })
  capability: string;

  @Column({ name: 'allow_custom_profiles', type: 'boolean', default: true })
  allowCustomProfiles: boolean;

  /** generic_1 … generic_6 or null */
  @Column({
    name: 'default_profile_code',
    type: 'varchar',
    length: 40,
    nullable: true,
  })
  defaultProfileCode: string | null;

  /**
   * Local image key under /onu/{key}.svg
   * zte-sfu | zte-hgu | huawei-sfu | huawei-hgu
   */
  @Column({
    name: 'image_key',
    type: 'varchar',
    length: 40,
    default: 'zte-hgu',
  })
  imageKey: string;

  @Column({ type: 'text', default: '' })
  note: string;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  /**
   * approved = in official catalog (propagates to all tenants)
   * pending = seen on an OLT, awaiting admin registration
   */
  @Column({
    name: 'registration_status',
    type: 'varchar',
    length: 20,
    default: 'approved',
  })
  registrationStatus: 'approved' | 'pending';

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
