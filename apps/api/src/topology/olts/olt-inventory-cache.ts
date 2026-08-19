/** Persisted OLT inventory snapshot (jsonb on network_devices). */

export type CachedOltUplink = {
  ifName: string;
  description: string | null;
  mediaType: 'fiber' | 'copper' | 'unknown';
  adminEnabled: boolean;
  status: string;
  negotiation: string | null;
  mtu: number | null;
  wavelengthNm: number | null;
  signalDbm: number | null;
  tempC: number | null;
  pvidUntag: number | null;
  mode: string | null;
  taggedVlans: number[];
};

export type CachedOltPonPort = {
  rack: string;
  shelf: string;
  slot: string;
  port: string;
  ifName: string;
  boardType: string;
  ponType: 'gpon' | 'epon';
  adminEnabled: boolean;
  status: 'Up' | 'Down';
  onuOnline: number;
  onuTotal: number;
  maxOnus: number;
  avgSignalDbm: number | null;
  description: string | null;
  minRangeM: number;
  maxRangeM: number;
  rogueDetectEnabled: boolean | null;
  txPowerDbm: number | null;
};

export type CachedOltVlan = {
  vlanId: number;
  description: string | null;
  isolated: boolean;
  usedForIptv: boolean;
  onuCount: number;
  isSystem: boolean;
};

export type OltInventoryCache = {
  uplinks?: CachedOltUplink[];
  ponPorts?: CachedOltPonPort[];
  vlans?: CachedOltVlan[];
  speedProfiles?: Array<{
    name: string;
    uploadProfile: string | null;
    downloadProfile: string | null;
    uploadMbps: number | null;
    downloadMbps: number | null;
    uploadKbps: number | null;
    downloadKbps: number | null;
  }>;
  /** Last SNMP status probe for uplinks/PON. */
  statusProbedAt?: string | null;
  /** Last CLI enrich for uplink/PON config fields (either scope). */
  configProbedAt?: string | null;
  /** Last CLI sync of uplink interfaces only. */
  uplinksConfigProbedAt?: string | null;
  /** Last CLI sync of PON port config only. */
  ponConfigProbedAt?: string | null;
  /** Last CLI VLAN list. */
  vlansProbedAt?: string | null;
  /** Last CLI DBA speed-profile list. */
  speedProfilesProbedAt?: string | null;
};

/** Config (CLI) older than this → background refresh. */
export const OLT_INVENTORY_CONFIG_TTL_MS = 30 * 60_000;
