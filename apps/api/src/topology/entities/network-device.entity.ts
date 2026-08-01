import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';
import { NetworkPort } from './network-port.entity';
import type { OltInventoryCache } from '../olt-inventory-cache';

export const NETWORK_DEVICE_TYPES = [
  'internet',
  'router',
  'switch',
  'olt',
  'server',
  'onu',
  'ont',
  'cpe_router',
] as const;

export type NetworkDeviceType = (typeof NETWORK_DEVICE_TYPES)[number];

/** Fixed WAN cloud — one per tenant, not user-created */
export const INTERNET_DEVICE_TYPE: NetworkDeviceType = 'internet';

/** Types that may connect to the Internet cloud */
export const INTERNET_LINKABLE_TYPES: NetworkDeviceType[] = [
  'router',
  'switch',
];

/** Types users can create via UI/API */
export const CREATABLE_DEVICE_TYPES = NETWORK_DEVICE_TYPES.filter(
  (t) => t !== 'internet',
);

@Entity({ name: 'network_devices' })
export class NetworkDevice {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 120 })
  name: string;

  @Column({ type: 'varchar', length: 40 })
  type: NetworkDeviceType;

  /**
   * router: mikrotik | cisco | edge_router
   * switch: generic | mikrotik_routeros | mikrotik_swos
   * olt: zte_* | huawei_*
   */
  @Column({ type: 'varchar', length: 40, nullable: true })
  subtype: string | null;

  @Column({ type: 'text', default: '' })
  note: string;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  // —— Management connection ——
  @Column({ name: 'mgmt_host', type: 'varchar', length: 255, nullable: true })
  mgmtHost: string | null;

  @Column({ name: 'mgmt_port', type: 'int', nullable: true })
  mgmtPort: number | null;

  @Column({
    name: 'mgmt_username',
    type: 'varchar',
    length: 120,
    nullable: true,
  })
  mgmtUsername: string | null;

  @Column({ name: 'mgmt_password', type: 'text', nullable: true })
  mgmtPassword: string | null;

  /** rest_https | api_ssl (mikrotik) */
  @Column({
    name: 'mgmt_protocol',
    type: 'varchar',
    length: 40,
    nullable: true,
  })
  mgmtProtocol: string | null;

  /** unknown | connected | disconnected | error */
  @Column({
    name: 'connection_status',
    type: 'varchar',
    length: 20,
    default: 'unknown',
  })
  connectionStatus: string;

  @Column({ name: 'last_checked_at', type: 'timestamptz', nullable: true })
  lastCheckedAt: Date | null;

  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError: string | null;

  @Column({ name: 'metric_cpu_load', type: 'int', nullable: true })
  metricCpuLoad: number | null;

  @Column({ name: 'metric_free_memory', type: 'bigint', nullable: true })
  metricFreeMemory: string | null;

  @Column({ name: 'metric_total_memory', type: 'bigint', nullable: true })
  metricTotalMemory: string | null;

  @Column({
    name: 'metric_uptime',
    type: 'varchar',
    length: 80,
    nullable: true,
  })
  metricUptime: string | null;

  @Column({
    name: 'metric_identity',
    type: 'varchar',
    length: 120,
    nullable: true,
  })
  metricIdentity: string | null;

  @Column({
    name: 'metric_version',
    type: 'varchar',
    length: 80,
    nullable: true,
  })
  metricVersion: string | null;

  /** RouterOS board-name (hardware model), e.g. RB3011UiAS */
  @Column({
    name: 'metric_board_name',
    type: 'varchar',
    length: 120,
    nullable: true,
  })
  metricBoardName: string | null;

  /** Preferred temperature °C from /system/health */
  @Column({
    name: 'metric_temperature',
    type: 'double precision',
    nullable: true,
  })
  metricTemperature: number | null;

  /**
   * How we reach the device: public IP:port vs secure (VPN local IP).
   * Used mainly for OLTs; routers stay on public path.
   */
  @Column({
    name: 'mgmt_connection_mode',
    type: 'varchar',
    length: 20,
    default: 'public',
  })
  mgmtConnectionMode: string;

  /** Privilege-mode password (ZTE enable / zxr10) */
  @Column({
    name: 'mgmt_enable_password',
    type: 'text',
    nullable: true,
  })
  mgmtEnablePassword: string | null;

  @Column({
    name: 'snmp_community',
    type: 'varchar',
    length: 120,
    nullable: true,
  })
  /** SNMP v2c read-only community (GET/WALK) */
  snmpCommunity: string | null;

  @Column({
    name: 'snmp_community_rw',
    type: 'varchar',
    length: 120,
    nullable: true,
  })
  /** SNMP v2c read-write community (SET); ready for future write ops */
  snmpCommunityRw: string | null;

  @Column({ name: 'snmp_port', type: 'int', nullable: true })
  snmpPort: number | null;

  /**
   * PON technology on this OLT (SmartOLT "Supported PON types").
   * Usually auto-detected from show card line cards.
   */
  @Column({ name: 'pon_type', type: 'varchar', length: 20, nullable: true })
  ponType: string | null;

  /** Free-form probe summary (e.g. OLT card counts) */
  @Column({
    name: 'metric_summary',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  metricSummary: string | null;

  /**
   * Soft flags for OLT VLANs (Mgmt, Internet/WAN, LAN-to-LAN prefs, etc.)
   * Keyed by VLAN ID string: { "601": { usedForMgmt: true, … } }
   * Also auto-derived from IP pools when listing.
   */
  @Column({
    name: 'olt_vlan_meta',
    type: 'jsonb',
    default: () => "'{}'",
  })
  oltVlanMeta: Record<
    string,
    {
      /** ONUs cannot reach each other in this VLAN. */
      isolated?: boolean;
    }
  >;

  /**
   * Cached OLT inventory (uplinks / PON / VLANs) for fast UI.
   * Status refreshed via SNMP; config/VLAN list via CLI every ~30m or manual.
   */
  @Column({
    name: 'olt_inventory_cache',
    type: 'jsonb',
    nullable: true,
  })
  oltInventoryCache: OltInventoryCache | null;

  /** When set, skip first-connect ONU import modal for this OLT */
  @Column({
    name: 'onus_import_prompted_at',
    type: 'timestamptz',
    nullable: true,
  })
  onusImportPromptedAt: Date | null;

  /** Nodo físico (sitio) al que pertenece este activo. */
  @Column({ name: 'node_id', type: 'uuid', nullable: true })
  nodeId: string | null;

  @OneToMany(() => NetworkPort, (p) => p.device)
  ports: NetworkPort[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
