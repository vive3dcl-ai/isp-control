import {
  deriveServiceState,
  pickLinkedService,
} from './onu-service-state.util';

describe('deriveServiceState', () => {
  it('CRM active + OLT disable → disabled_olt y desvío del roadmap', () => {
    const s = deriveServiceState({
      crmStatus: 'active',
      adminState: 'disable',
      inInventory: true,
    });
    expect(s.canonical).toBe('disabled_olt');
    expect(s.desired).toBe('active');
    expect(s.oltAdmin).toBe('disable');
    expect(s.drift?.code).toBe('crm_active_olt_disabled');
  });

  it('CRM suspended + OLT disable (sin portal) → suspended, sin desvío', () => {
    const s = deriveServiceState({
      crmStatus: 'suspended',
      adminState: 'disable',
      inInventory: true,
      portalSuspension: false,
    });
    expect(s.canonical).toBe('suspended');
    expect(s.enforcement).toBe('olt_shutdown');
    expect(s.drift).toBeNull();
  });

  it('portal: CRM suspended + OLT enable no es desvío', () => {
    const s = deriveServiceState({
      crmStatus: 'suspended',
      adminState: 'enable',
      inInventory: true,
      portalSuspension: true,
    });
    expect(s.canonical).toBe('suspended');
    expect(s.enforcement).toBe('portal');
    expect(s.drift).toBeNull();
  });

  it('sin portal: CRM suspended + OLT enable es desvío', () => {
    const s = deriveServiceState({
      crmStatus: 'suspended',
      adminState: 'enable',
      inInventory: true,
      portalSuspension: false,
    });
    expect(s.canonical).toBe('suspended');
    expect(s.drift?.code).toBe('crm_suspended_olt_enabled');
  });

  it('CRM active + OLT enable → active', () => {
    const s = deriveServiceState({
      crmStatus: 'active',
      adminState: 'Enabled',
      inInventory: true,
    });
    expect(s.canonical).toBe('active');
    expect(s.drift).toBeNull();
  });

  it('contrato finalizado y ONU en inventario → desvío crm_ended_onu_present', () => {
    const s = deriveServiceState({
      crmStatus: 'ended',
      adminState: 'enable',
      inInventory: true,
    });
    expect(s.drift?.code).toBe('crm_ended_onu_present');
  });

  it('SN denegado sin contrato abierto → denied', () => {
    const s = deriveServiceState({
      denied: true,
      inUncfg: true,
      inInventory: false,
    });
    expect(s.canonical).toBe('denied');
  });

  it('uncfg y no en inventario → pending_auth', () => {
    const s = deriveServiceState({
      inUncfg: true,
      inInventory: false,
    });
    expect(s.canonical).toBe('pending_auth');
  });

  it('contrato active + SN denegado → desvío crm_active_sn_denied', () => {
    const s = deriveServiceState({
      crmStatus: 'active',
      adminState: 'enable',
      inInventory: true,
      denied: true,
    });
    expect(s.drift?.code).toBe('crm_active_sn_denied');
  });
});

describe('pickLinkedService', () => {
  const t = (status: string, day: number) => ({
    status,
    createdAt: new Date(`2026-01-0${day}T00:00:00Z`),
  });

  it('prefiere el contrato no finalizado más reciente', () => {
    const picked = pickLinkedService([
      t('ended', 5),
      t('active', 2),
      t('suspended', 4),
    ]);
    expect(picked?.status).toBe('suspended');
  });

  it('si solo hay ended, usa el más reciente', () => {
    const picked = pickLinkedService([t('ended', 1), t('ended', 3)]);
    expect(picked?.createdAt.toISOString()).toContain('2026-01-03');
  });
});
