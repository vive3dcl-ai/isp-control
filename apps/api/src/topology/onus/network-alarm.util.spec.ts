import {
  INFORM_STALE_MS,
  classifyAccessAlarms,
  isDyingGasp,
  isLosPhase,
} from './network-alarm.util';

describe('classifyAccessAlarms', () => {
  it('dying gasp no abre nada (ni LOS ni Inform ni RX)', () => {
    expect(
      classifyAccessAlarms({
        online: false,
        phaseState: 'DyingGasp',
        status: 'offline',
        signalDbm: -32,
        lastInformAt: new Date(Date.now() - INFORM_STALE_MS * 2),
        hadAcsRecord: true,
      }),
    ).toEqual([]);
    expect(isDyingGasp('dying gasp', 'online')).toBe(true);
  });

  it('LOS sin dying gasp sí alerta', () => {
    expect(
      classifyAccessAlarms({
        online: false,
        phaseState: 'LOS',
        status: 'los',
      }),
    ).toEqual(['onu_los']);
    expect(isLosPhase('working', null)).toBe(false);
  });

  it('Inform stale solo si online', () => {
    const stale = new Date(Date.now() - INFORM_STALE_MS - 1000);
    expect(
      classifyAccessAlarms({
        online: true,
        phaseState: 'working',
        lastInformAt: stale,
        hadAcsRecord: true,
      }),
    ).toEqual(['onu_inform_stale']);
    expect(
      classifyAccessAlarms({
        online: false,
        phaseState: 'OffLine',
        lastInformAt: stale,
        hadAcsRecord: true,
      }),
    ).toEqual([]);
  });

  it('RX baja solo si online', () => {
    expect(
      classifyAccessAlarms({
        online: true,
        phaseState: 'working',
        signalDbm: -30,
      }),
    ).toEqual(['onu_rx_low']);
    expect(
      classifyAccessAlarms({
        online: false,
        phaseState: 'OffLine',
        signalDbm: -30,
      }),
    ).toEqual([]);
  });
});
