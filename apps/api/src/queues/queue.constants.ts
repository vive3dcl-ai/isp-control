export const QUEUE_SYSTEM = 'system';
export const QUEUE_NETWORK = 'network';
export const QUEUE_BILLING = 'billing';

export type SystemJobName = 'health.ping';

export type NetworkJobName = 'mikrotik.sync' | 'olt.sync' | 'olt.provision';

export type BillingJobName =
  'billing.periods' | 'billing.generate' | 'billing.send';

export interface SystemPingJob {
  at: string;
}

export interface NetworkJobPayload {
  tenantId: string;
  schemaName: string;
  deviceId?: string;
}

/** Always includes schemaName so workers never touch another tenant. */
export interface BillingJobPayload {
  tenantId: string;
  schemaName: string;
  job: BillingJobName;
  manual?: boolean;
}
