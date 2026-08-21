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

  it('admin disable no alerta LOS ni RX aunque el probe diga −30 dBm', () => {
    expect(
      classifyAccessAlarms({
        online: false,
        phaseState: 'LOS',
        status: 'los',
        adminState: 'disable',
        signalDbm: -30,
      }),
    ).toEqual([]);
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

  it('Inform lento (< 1 h) no alerta', () => {
    const slow = new Date(Date.now() - 40 * 60_000);
    expect(
      classifyAccessAlarms({
        online: true,
        phaseState: 'working',
        lastInformAt: slow,
        hadAcsRecord: true,
        acsExpected: true,
      }),
    ).toEqual([]);
  });

  it('Inform stale solo si online y ACS esperado', () => {
    const stale = new Date(Date.now() - INFORM_STALE_MS - 1000);
    expect(
      classifyAccessAlarms({
        online: true,
        phaseState: 'working',
        lastInformAt: stale,
        hadAcsRecord: true,
        acsExpected: true,
      }),
    ).toEqual(['onu_inform_stale']);
    expect(
      classifyAccessAlarms({
        online: false,
        phaseState: 'OffLine',
        lastInformAt: stale,
        hadAcsRecord: true,
        acsExpected: true,
      }),
    ).toEqual([]);
    expect(
      classifyAccessAlarms({
        online: true,
        phaseState: 'working',
        lastInformAt: stale,
        hadAcsRecord: true,
        acsExpected: false,
      }),
    ).toEqual([]);
  });

  it('RX mala estable no alerta; sí si varió más de 1 dB', () => {
    expect(
      classifyAccessAlarms({
        online: true,
        phaseState: 'working',
        signalDbm: -30,
        recentSignalDbms: [-30.2, -29.8, -30.1],
      }),
    ).toEqual([]);
    expect(
      classifyAccessAlarms({
        online: true,
        phaseState: 'working',
        signalDbm: -30,
        recentSignalDbms: [-26.5, -27],
      }),
    ).toEqual(['onu_rx_low']);
    expect(
      classifyAccessAlarms({
        online: true,
        phaseState: 'working',
        signalDbm: -30,
        recentSignalDbms: [],
      }),
    ).toEqual([]);
    expect(
      classifyAccessAlarms({
        online: false,
        phaseState: 'OffLine',
        signalDbm: -30,
        recentSignalDbms: [-25],
      }),
    ).toEqual([]);
  });
});
