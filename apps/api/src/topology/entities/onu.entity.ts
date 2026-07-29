import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'onus' })
@Index('uq_onus_olt_if', ['oltId', 'onuIf'], { unique: true })
export class Onu {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'olt_id', type: 'uuid' })
  oltId: string;

  @Column({ name: 'onu_if', type: 'varchar', length: 80 })
  onuIf: string;

  @Column({ name: 'pon_type', type: 'varchar', length: 20, default: 'gpon' })
  ponType: string;

  @Column({ type: 'varchar', length: 20, default: '' })
  board: string;

  @Column({ type: 'varchar', length: 20, default: '' })
  port: string;

  @Column({ name: 'onu_id', type: 'varchar', length: 20, default: '' })
  onuId: string;

  @Column({ type: 'varchar', length: 40, nullable: true })
  sn: string | null;

  @Column({ name: 'onu_type', type: 'varchar', length: 80, nullable: true })
  onuType: string | null;

  @Column({ type: 'varchar', length: 160, nullable: true })
  name: string | null;

  @Column({ type: 'text', default: '' })
  description: string;

  @Column({ type: 'varchar', length: 40, default: 'other' })
  status: string;

  @Column({ name: 'phase_state', type: 'varchar', length: 40, default: '' })
  phaseState: string;

  @Column({ name: 'admin_state', type: 'varchar', length: 40, default: '' })
  adminState: string;

  @Column({ type: 'boolean', default: false })
  online: boolean;

  @Column({
    name: 'signal_dbm',
    type: 'double precision',
    nullable: true,
  })
  signalDbm: number | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  mode: string | null;

  @Column({ type: 'int', nullable: true })
  vlan: number | null;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  vlans: number[];

  @Column({ type: 'varchar', length: 120, nullable: true })
  zone: string | null;

  /** Catálogo CRM (`zones.id`). `zone` guarda el nombre desnormalizado. */
  @Column({ name: 'zone_id', type: 'uuid', nullable: true })
  zoneId: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  odb: string | null;

  @Column({ type: 'varchar', length: 80, nullable: true })
  voip: string | null;

  @Column({ type: 'varchar', length: 80, nullable: true })
  tv: string | null;

  @Column({ name: 'auth_date', type: 'timestamptz', nullable: true })
  authDate: Date | null;

  @Column({ name: 'last_probed_at', type: 'timestamptz', nullable: true })
  lastProbedAt: Date | null;

  /**
   * When the ONU was last observed going online (SNMP/CLI poll).
   * Used to show live “Online Duration” without Telnet.
   */
  @Column({ name: 'online_since', type: 'timestamptz', nullable: true })
  onlineSince: Date | null;

  /**
   * ZTE XPON ONU ifIndex (3902.1015…, often >2^31) for traffic counters.
   * Live path can also re-encode from slot/pon/onuId.
   */
  @Column({ name: 'if_index', type: 'bigint', nullable: true })
  ifIndex: number | null;

  /** Assigned management IP from an ip_pool (purpose=management). */
  @Column({ name: 'mgmt_ip', type: 'varchar', length: 45, nullable: true })
  mgmtIp: string | null;

  @Column({ name: 'mgmt_pool_id', type: 'uuid', nullable: true })
  mgmtPoolId: string | null;

  /** Assigned WAN/internet IP from an ip_pool (purpose=internet). */
  @Column({ name: 'wan_ip', type: 'varchar', length: 45, nullable: true })
  wanIp: string | null;

  @Column({ name: 'wan_pool_id', type: 'uuid', nullable: true })
  wanPoolId: string | null;

  /** Active TR069 profile when TR069 is enabled on this ONU. */
  @Column({ name: 'tr069_profile_id', type: 'uuid', nullable: true })
  tr069ProfileId: string | null;

  /**
   * Provisioning mode: 'auto' = OLT/OMCI/TR069 gestionan la ONU.
   * 'manual' = el técnico configura la WAN por la web de la ONU.
   */
  @Column({
    name: 'provision_mode',
    type: 'varchar',
    length: 12,
    default: 'auto',
  })
  provisionMode: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
