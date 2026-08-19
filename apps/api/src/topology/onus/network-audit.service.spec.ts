import { NetworkAuditService } from './network-audit.service';

describe('NetworkAuditService.record', () => {
  it('no lanza si el repositorio falla', async () => {
    const tenants = {
      getDeviceAuditEventRepository: jest.fn().mockRejectedValue(new Error('db down')),
    };
    const svc = new NetworkAuditService(tenants as never);
    await expect(
      svc.record('tenant_x', { action: 'reboot', ok: true, sn: 'HWTC1' }),
    ).resolves.toBeUndefined();
  });
});
