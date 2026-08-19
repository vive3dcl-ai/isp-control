/**
 * Estado canónico de servicio (Etapa 1).
 * Se deriva de CRM + OLT + denylist; no se persiste.
 */

export type CanonicalServiceState =
  | 'active'
  | 'suspended'
  | 'denied'
  | 'disabled_olt'
  | 'pending_auth';

export type CrmServiceDesired =
  | 'prepared'
  | 'active'
  | 'suspended'
  | 'ended'
  | null;

export type OltAdminView = 'enable' | 'disable' | 'unknown';

export type ServiceEnforcement = 'olt_shutdown' | 'portal' | 'none';

export type ServiceDriftCode =
  | 'crm_active_olt_disabled'
  | 'crm_suspended_olt_enabled'
  | 'crm_ended_onu_present'
  | 'crm_active_sn_denied';

export type ServiceDrift = {
  code: ServiceDriftCode;
  message: string;
};

export type ServiceStateView = {
  canonical: CanonicalServiceState;
  desired: CrmServiceDesired;
  oltAdmin: OltAdminView;
  enforcement: ServiceEnforcement;
  drift: ServiceDrift | null;
};

export type DeriveServiceStateInput = {
  crmStatus?: CrmServiceDesired;
  adminState?: string | null;
  denied?: boolean;
  inUncfg?: boolean;
  inInventory?: boolean;
  portalSuspension?: boolean;
};

const DRIFT_MSG: Record<ServiceDriftCode, string> = {
  crm_active_olt_disabled:
    'Contrato activo en CRM y ONU en disable en la OLT',
  crm_suspended_olt_enabled:
    'Contrato suspendido en CRM y ONU habilitada en la OLT',
  crm_ended_onu_present:
    'Contrato finalizado y la ONU sigue autorizada en la OLT',
  crm_active_sn_denied:
    'Contrato activo y el SN está en la lista de denegados',
};

export function isOltAdminDisabled(
  adminState: string | null | undefined,
): boolean {
  return /disable/i.test(adminState ?? '');
}

export function pickLinkedService<
  T extends { status: string; createdAt: Date },
>(services: T[]): T | null {
  if (!services.length) return null;
  const open = services.filter((s) => s.status !== 'ended');
  const pool = open.length ? open : services;
  return [...pool].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
  )[0];
}

function oltAdminFromState(
  adminState: string | null | undefined,
  inInventory: boolean,
): OltAdminView {
  if (!inInventory && (adminState == null || adminState === '')) {
    return 'unknown';
  }
  if (adminState == null || adminState === '') {
    return inInventory ? 'unknown' : 'unknown';
  }
  return isOltAdminDisabled(adminState) ? 'disable' : 'enable';
}

export function deriveServiceState(
  input: DeriveServiceStateInput,
): ServiceStateView {
  const desired: CrmServiceDesired = input.crmStatus ?? null;
  const inInventory = !!input.inInventory;
  const denied = !!input.denied;
  const inUncfg = !!input.inUncfg;
  const portal = !!input.portalSuspension;
  const oltAdmin = oltAdminFromState(input.adminState, inInventory);

  const enforcement: ServiceEnforcement =
    desired === 'suspended'
      ? portal
        ? 'portal'
        : 'olt_shutdown'
      : 'none';

  let canonical: CanonicalServiceState;
  const openContract =
    desired === 'active' || desired === 'suspended' || desired === 'prepared';

  if (denied && !openContract) {
    canonical = 'denied';
  } else if (inUncfg && !inInventory) {
    canonical = 'pending_auth';
  } else if (desired === 'suspended') {
    canonical = 'suspended';
  } else if (oltAdmin === 'disable') {
    canonical = 'disabled_olt';
  } else if (desired === 'active') {
    canonical = 'active';
  } else if (desired === 'prepared' && !inInventory) {
    canonical = 'pending_auth';
  } else if (denied) {
    canonical = 'denied';
  } else if (inInventory && oltAdmin === 'enable') {
    canonical = 'active';
  } else if (inUncfg) {
    canonical = 'pending_auth';
  } else {
    canonical = inInventory ? 'active' : 'pending_auth';
  }

  let driftCode: ServiceDriftCode | null = null;
  if (desired === 'active' && oltAdmin === 'disable') {
    driftCode = 'crm_active_olt_disabled';
  } else if (
    desired === 'suspended' &&
    oltAdmin === 'enable' &&
    !portal
  ) {
    driftCode = 'crm_suspended_olt_enabled';
  } else if (desired === 'ended' && inInventory) {
    driftCode = 'crm_ended_onu_present';
  } else if (desired === 'active' && denied) {
    driftCode = 'crm_active_sn_denied';
  }

  return {
    canonical,
    desired,
    oltAdmin,
    enforcement,
    drift: driftCode
      ? { code: driftCode, message: DRIFT_MSG[driftCode] }
      : null,
  };
}
