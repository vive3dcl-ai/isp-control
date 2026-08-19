/**
 * DTOs compartidos del contrato OLT (CLI + SNMP).
 * Neutrales entre Huawei / ZTE C3xx / Titan — sin dependencias de silo.
 */
import type { OltHealthMetrics } from './_shared/transport/snmp-health';

export interface ConnectedOnu {
  onuIf: string;
  ponType: 'gpon' | 'epon';
  board: string;
  port: string;
  onuId: string;
  status: string;
  online: boolean;
  phaseState: string;
  adminState: string;
  sn: string | null;
  onuType: string | null;
  name: string | null;
  description: string | null;
  signalDbm: number | null;
  mode: 'bridge' | 'router' | null;
  vlan: number | null;
  vlans: number[];
}

export interface ConnectedOnuDetail extends ConnectedOnu {
  oltRxDbm: number | null;
  distanceM: number | null;
  onlineDuration: string | null;
  /** Customer download (bajada) — OLT output rate, bytes/s */
  downloadBps: number | null;
  /** Customer upload (subida) — OLT input rate, bytes/s */
  uploadBps: number | null;
  runningConfig: string;
  detailInfoRaw: string;
  ethernetPorts: Array<{
    port: string;
    adminState: string;
    mode: string;
    dhcp: string;
  }>;
  wifiPorts: Array<{
    port: string;
    band: string;
    adminState: string;
    mode: string;
    ssid: string;
    dhcp: string;
  }>;
  voipSupported: boolean | null;
  catvSupported: boolean | null;
}

export interface OltCard {
  rack: string;
  shelf: string;
  slot: string;
  cfgType: string;
  realType: string;
  ports?: number;
  softVer?: string;
  status: string;
  role?: string | null;
}

export interface OltCardsResult {
  ok: boolean;
  error?: string;
  cards: OltCard[];
  probedAt: string;
  summary: string | null;
}

export interface OltProbeResult {
  ok: boolean;
  error?: string;
  product?: string;
  hostname?: string;
  softVer?: string;
  firmwareFamily?: string;
  ponType?: 'gpon' | 'epon' | 'gpon_epon';
  cards?: OltCard[];
  rawCardSummary?: string;
  cpuLoad?: number;
  freeMemory?: number;
  totalMemory?: number;
  temperature?: number;
  uptime?: string;
}

export type SnmpConn = {
  host: string;
  snmpPort?: number | null;
  /** Read-only community only — never pass RW here. */
  snmpCommunity: string;
};

export type SnmpOnuRow = {
  onuIf: string;
  shelf: string;
  slot: string;
  port: string;
  onuId: string;
  sn: string | null;
  name: string | null;
  phaseState: string | null;
  online: boolean;
  status: 'online' | 'offline';
  signalDbm: number | null;
  ifIndex: number | null;
  inOctets: number | null;
  outOctets: number | null;
};

export type SnmpMonitorResult = {
  ok: boolean;
  error?: string;
  source: 'snmp_v21' | 'snmp_legacy' | 'snmp_huawei' | 'none';
  onus: SnmpOnuRow[];
  probedAt: string;
};

export type SnmpProbeResult = {
  ok: boolean;
  error?: string;
  sysUpTimeTicks?: number;
  ifTableV2Compatible?: boolean;
  warning?: string;
  health?: OltHealthMetrics;
};

export type SnmpPortRow = {
  ifName: string;
  ifIndex: number;
  kind: 'uplink' | 'pon';
  family: 'gpon' | 'epon' | null;
  shelf: string | null;
  slot: string | null;
  port: string | null;
  adminEnabled: boolean;
  operUp: boolean;
  status: string;
  speedMbps: number | null;
  inOctets: number | null;
  outOctets: number | null;
};

export type SnmpPortsResult = {
  ok: boolean;
  error?: string;
  uplinks: SnmpPortRow[];
  ponPorts: SnmpPortRow[];
  probedAt: string;
};

/** Aliases legacy (ZTE names) — mismos shapes; no romper callers existentes. */
export type ZteConnectedOnu = ConnectedOnu;
export type ZteConnectedOnuDetail = ConnectedOnuDetail;
export type ZteOltCard = OltCard;
export type ZteOltCardsResult = OltCardsResult;
export type ZteOltProbeResult = OltProbeResult;
export type ZteSnmpConn = SnmpConn;
export type ZteSnmpOnuRow = SnmpOnuRow;
export type ZteSnmpMonitorResult = Omit<SnmpMonitorResult, 'source'> & {
  source: 'snmp_v21' | 'snmp_legacy' | 'none';
};
export type ZteSnmpProbeResult = SnmpProbeResult;
export type ZteSnmpPortRow = SnmpPortRow;
export type ZteSnmpPortsResult = SnmpPortsResult;
