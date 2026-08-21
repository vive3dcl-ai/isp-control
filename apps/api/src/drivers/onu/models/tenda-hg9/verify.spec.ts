import type { OnuHealGaps, OnuVerifyHealCtx } from '../../types';
import {
  pickTendaHg9VerifyAction,
  verifyHealTendaHg9,
} from './verify';

function gaps(partial: Partial<OnuHealGaps>): OnuHealGaps {
  return {
    connreqOurs: false,
    informAlive: false,
    reachable: false,
    hasServiceWan: true,
    serviceWanOk: false,
    ...partial,
  };
}

describe('pickTendaHg9VerifyAction', () => {
  it('Inform vivo + WAN mal → solo SPV (no OMCI)', () => {
    expect(
      pickTendaHg9VerifyAction(
        gaps({
          informAlive: true,
          reachable: false,
          serviceWanOk: false,
        }),
      ),
    ).toBe('spv');
  });

  it('agente muerto → OMCI', () => {
    expect(
      pickTendaHg9VerifyAction(
        gaps({ informAlive: false, reachable: false }),
      ),
    ).toBe('omci');
  });

  it('WAN ok → noop aunque ConnReq falle', () => {
    expect(
      pickTendaHg9VerifyAction(
        gaps({ serviceWanOk: true, connreqOurs: false }),
      ),
    ).toBe('noop');
  });

  it('sin carrier L2 → l2 antes que SPV', () => {
    expect(
      pickTendaHg9VerifyAction(
        gaps({
          informAlive: true,
          serviceWanOk: true,
          serviceCarrierOk: false,
        }),
      ),
    ).toBe('l2');
  });
});

describe('verifyHealTendaHg9 reboot cap', () => {
  it('OMCI del heal reinicia con force false', async () => {
    const reboot = jest.fn(async () => ({ ok: true, note: 'rb' }));
    const ensureOmciTr069 = jest.fn(async () => ({
      ok: true,
      notes: ['omci'],
    }));
    await verifyHealTendaHg9({
      explicit: true,
      gaps: gaps({ informAlive: false, reachable: false }),
      ensureOmciTr069,
      reboot,
    } as unknown as OnuVerifyHealCtx);
    expect(reboot).toHaveBeenCalledWith({ force: false });
  });
});
