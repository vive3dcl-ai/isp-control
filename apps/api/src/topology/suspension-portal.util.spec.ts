import {
  isOnuAdminDisabled,
  planPortalSuspend,
  shouldRefreshSuspendedAddressList,
} from './suspension-portal.util';

describe('planPortalSuspend', () => {
  it('sin wanIp usa fallback OLT', () => {
    expect(
      planPortalSuspend({ wanIp: null, oltId: 'olt', onuIf: 'gpon-onu_1/1/1:1' }),
    ).toEqual({
      action: 'olt_fallback',
      reason:
        'La ONU no tiene IP WAN; se aplica disable en la OLT (sin portal cautivo).',
    });
  });

  it('con wanIp e interfaz usa portal (no disable OLT)', () => {
    expect(
      planPortalSuspend({
        wanIp: '10.8.0.10',
        oltId: 'olt',
        onuIf: 'gpon-onu_1/1/1:1',
      }),
    ).toEqual({ action: 'portal', wanIp: '10.8.0.10' });
  });

  it('sin interfaz OLT usa fallback', () => {
    expect(
      planPortalSuspend({ wanIp: '10.8.0.10', oltId: 'olt', onuIf: '' }),
    ).toEqual({
      action: 'olt_fallback',
      reason: 'La ONU no tiene interfaz OLT; no se puede aplicar el portal.',
    });
  });
});

describe('shouldRefreshSuspendedAddressList', () => {
  it('solo si portal ON, servicio suspendido e IP WAN', () => {
    expect(
      shouldRefreshSuspendedAddressList({
        portalEnabled: true,
        serviceStatus: 'suspended',
        wanIp: '10.8.0.11',
      }),
    ).toBe(true);
    expect(
      shouldRefreshSuspendedAddressList({
        portalEnabled: true,
        serviceStatus: 'active',
        wanIp: '10.8.0.11',
      }),
    ).toBe(false);
    expect(
      shouldRefreshSuspendedAddressList({
        portalEnabled: false,
        serviceStatus: 'suspended',
        wanIp: '10.8.0.11',
      }),
    ).toBe(false);
    expect(
      shouldRefreshSuspendedAddressList({
        portalEnabled: true,
        serviceStatus: 'suspended',
        wanIp: '  ',
      }),
    ).toBe(false);
  });
});

describe('isOnuAdminDisabled', () => {
  it('detecta disable', () => {
    expect(isOnuAdminDisabled('disable')).toBe(true);
    expect(isOnuAdminDisabled('enable')).toBe(false);
  });
});
