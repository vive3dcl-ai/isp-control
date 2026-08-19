import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'onu_types' })
export class OnuType {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** gpon | epon */
  @Column({ name: 'pon_type', type: 'varchar', length: 20 })
  ponType: string;

  /** Channel letter shown in UI, e.g. G */
  @Column({ type: 'varchar', length: 8, default: 'G' })
  channel: string;

  @Column({ name: 'channel_gpon', type: 'boolean', default: true })
  channelGpon: boolean;

  @Column({ name: 'channel_xgpon', type: 'boolean', default: false })
  channelXgpon: boolean;

  @Column({ name: 'channel_xgspon', type: 'boolean', default: false })
  channelXgspon: boolean;

  /** Model code only, e.g. HG6243C / F660 (vendor is separate). */
  @Column({ type: 'varchar', length: 80 })
  name: string;

  /** zte | huawei | fiberhome | other */
  @Column({ type: 'varchar', length: 40, default: 'other' })
  vendor: string;

  /** Seeded from system catalog */
  @Column({ name: 'from_catalog', type: 'boolean', default: false })
  fromCatalog: boolean;

  /**
   * Visible in tenant Tipos de ONU / Autorizar.
   * Set true when the tenant registers an ONU of this model or creates the type manually.
   * Cleared only when the user deletes the type from their list.
   */
  @Column({ name: 'listed', type: 'boolean', default: false })
  listed: boolean;

  @Column({ name: 'ethernet_ports', type: 'int', default: 1 })
  ethernetPorts: number;

  @Column({ name: 'wifi_ssids', type: 'int', default: 0 })
  wifiSsids: number;

  @Column({ name: 'voip_ports', type: 'int', default: 0 })
  voipPorts: number;

  @Column({ type: 'boolean', default: false })
  catv: boolean;

  @Column({ name: 'allow_custom_profiles', type: 'boolean', default: true })
  allowCustomProfiles: boolean;

  /** FK to onu_profiles.id (nullable) */
  @Column({ name: 'default_profile_id', type: 'uuid', nullable: true })
  defaultProfileId: string | null;

  /** bridging | bridging_routing */
  @Column({ type: 'varchar', length: 40, default: 'bridging_routing' })
  capability: string;

  @Column({ name: 'use_default_image', type: 'boolean', default: true })
  useDefaultImage: boolean;

  /** Optional custom image as data URL or path */
  @Column({ name: 'image_url', type: 'text', nullable: true })
  imageUrl: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
