import { huaweiHg8145x6Handler } from './models/huawei-hg8145x6';
import { genericZteDriver } from './models/generic-zte';
import { genericFiberhomeDriver } from './models/generic-fiberhome';
import {
  mergeProgressState,
  resolveProgressPlan,
} from './types';

describe('ONU progressPlan', () => {
  it('HG8145 plan includes ensure_* ACS steps and skips net_route', () => {
    const plan = resolveProgressPlan(huaweiHg8145x6Handler);
    const ids = plan.map((p) => p.id);
    expect(ids).toContain('ensure_connreq');
    expect(ids).toContain('ensure_service_spv');
    expect(ids).not.toContain('net_route');
    expect(ids).not.toContain('net_arp');
    expect(ids).toContain('net_wan');
    expect(ids).not.toContain('net_arp');
    expect(plan.find((p) => p.id === 'ensure_connreq')?.label).toBe(
      'Credenciales de administración',
    );
    expect(plan.find((p) => p.id === 'ensure_service_spv')?.label).toBe(
      'Árbol de servicio',
    );
    expect(plan.find((p) => p.id === 'net_wan')?.label).toBe('WAN internet');
    expect(plan.find((p) => p.id === 'net_lanBind')?.label).toBe('Bind NAT');
    expect(plan.find((p) => p.id === 'net_traffic')?.label).toBe('Internet');
    expect(ids.indexOf('net_lanBind')).toBeLessThan(ids.indexOf('net_traffic'));
  });

  it('generic FiberHome usa WAN de servicio y Árbol de servicio', () => {
    const plan = resolveProgressPlan(genericFiberhomeDriver);
    expect(plan.find((p) => p.id === 'ensure_service_wan')?.label).toBe(
      'WAN de servicio',
    );
    expect(plan.find((p) => p.id === 'apply_service_spv')?.label).toBe(
      'Árbol de servicio',
    );
  });

  it('generic-ZTE plan includes net_route', () => {
    const plan = resolveProgressPlan(genericZteDriver);
    expect(plan.map((p) => p.id)).toContain('net_route');
  });

  it('mergeProgressState accumulates completed across ticks', () => {
    const a = mergeProgressState(null, {
      currentStepId: 'ensure_connreq',
      completed: ['ensure_connreq'],
      notes: ['tick1'],
    });
    const b = mergeProgressState(a, {
      currentStepId: 'ensure_inform',
      completed: ['ensure_inform'],
      notes: ['tick2'],
    });
    expect(b.currentStepId).toBe('ensure_inform');
    expect(b.completed).toEqual(
      expect.arrayContaining(['ensure_connreq', 'ensure_inform']),
    );
    expect(b.notes).toEqual(['tick1', 'tick2']);
  });
});
