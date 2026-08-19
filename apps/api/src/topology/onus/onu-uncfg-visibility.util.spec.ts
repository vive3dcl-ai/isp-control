import {
  onuSnKey,
  shouldPurgeDeniedAlreadyConnected,
  uncfgHideReason,
} from './onu-uncfg-visibility.util';

describe('onuSnKey', () => {
  it('normaliza mayúsculas y quita no alfanuméricos', () => {
    expect(onuSnKey(' td-tc:353e9a98 ')).toBe('TDTC353E9A98');
  });
});

describe('uncfgHideReason', () => {
  const deniedSn = new Set(['DENIED01']);
  const connectedSn = new Set(['TDTC353E9A98', 'HWTCABC123']);

  it('oculta SN ya en Conectadas (aunque no esté disable)', () => {
    expect(
      uncfgHideReason('TDTC353E9A98', { deniedSn, connectedSn }),
    ).toBe('connected');
  });

  it('oculta SN denegado', () => {
    expect(
      uncfgHideReason('denied-01', { deniedSn, connectedSn }),
    ).toBe('denied');
  });

  it('deja pasar uncfg que no está en inventario ni denylist', () => {
    expect(
      uncfgHideReason('ZTEG00001111', { deniedSn, connectedSn }),
    ).toBeNull();
  });
});

describe('shouldPurgeDeniedAlreadyConnected', () => {
  const connectedSn = new Set(['HWTC42DF94B8']);

  it('no borra denegada manual aunque el SN esté en Conectadas', () => {
    expect(
      shouldPurgeDeniedAlreadyConnected(
        { sn: 'HWTC42DF94B8', manual: true },
        connectedSn,
      ),
    ).toBe(false);
  });

  it('no borra si manual es null/undefined', () => {
    expect(
      shouldPurgeDeniedAlreadyConnected(
        { sn: 'HWTC42DF94B8', manual: null },
        connectedSn,
      ),
    ).toBe(false);
    expect(
      shouldPurgeDeniedAlreadyConnected(
        { sn: 'HWTC42DF94B8' },
        connectedSn,
      ),
    ).toBe(false);
  });

  it('borra solo auto-bloqueo (manual === false) ya conectado', () => {
    expect(
      shouldPurgeDeniedAlreadyConnected(
        { sn: 'HWTC42DF94B8', manual: false },
        connectedSn,
      ),
    ).toBe(true);
  });

  it('no borra auto-bloqueo si el SN no está en Conectadas', () => {
    expect(
      shouldPurgeDeniedAlreadyConnected(
        { sn: 'HWTC00000000', manual: false },
        connectedSn,
      ),
    ).toBe(false);
  });
});
