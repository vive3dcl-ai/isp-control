import { huaweiHg8145x6Handler } from './models/huawei-hg8145x6';
import { genericZteDriver } from './models/generic-zte';
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
    expect(ids).toContain('net_wan');
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
