import { toSystemOltProfileName } from './zte-olt-speed.util';
import {
  decideOnuHealthBadge,
  expectedInternetTcontUp,
  internetTcontProfileOf,
  needsMigratedHealthBackfill,
  needsDbaProfileCheck,
  parseOnuTcontBinds,
  shouldSkipHealthPass,
  tcontProfileMatches,
} from './zte-olt-dba.util';

describe('expectedInternetTcontUp', () => {
  it('usa el mismo base TLG que el sync de perfiles', () => {
    const base = toSystemOltProfileName('100-50');
    expect(base).toBeTruthy();
    expect(expectedInternetTcontUp('100-50')).toBe(`${base}-UP`);
    expect(expectedInternetTcontUp('100-50')).not.toBe(
      'SMARTOLT-1000MB-UP',
    );
  });

  it('null si el nombre no sirve', () => {
    expect(expectedInternetTcontUp('')).toBeNull();
    expect(expectedInternetTcontUp('default')).toBeNull();
  });
});

describe('parseOnuTcontBinds / match', () => {
  it('parsea tcont N profile NAME', () => {
    const binds = parseOnuTcontBinds(
      'tcont 1 profile TLG-100-50-UP\ntcont 2 profile SMARTOLT-VOIPMNG-10M\n',
    );
    expect(binds).toEqual([
      { tcontId: 1, profile: 'TLG-100-50-UP' },
      { tcontId: 2, profile: 'SMARTOLT-VOIPMNG-10M' },
    ]);
    expect(
      tcontProfileMatches(binds[0].profile, expectedInternetTcontUp('100-50')),
    ).toBe(true);
  });

  it('parsea running-config interface cuando remote-onu tcont viene vacío', () => {
    const cfg = `
interface gpon-onu_1/2/2:1
  tcont 1 profile TLG-500MB-UP
  gemport 1 tcont 1
  service-port 1 vport 1 user-vlan 701 vlan 701
`;
    const binds = parseOnuTcontBinds(cfg);
    expect(internetTcontProfileOf(binds, 1)).toBe('TLG-500MB-UP');
  });

  it('ok se salta sin force; mismatch de plan es check no fail', () => {
    expect(shouldSkipHealthPass('ok', false)).toBe(true);
    expect(shouldSkipHealthPass('ok', true)).toBe(false);
    expect(shouldSkipHealthPass('idle', false)).toBe(false);
    expect(shouldSkipHealthPass('check', false)).toBe(true);
    expect(shouldSkipHealthPass('fail', false)).toBe(true);
    expect(shouldSkipHealthPass('check', true)).toBe(false);
    expect(shouldSkipHealthPass('check', false)).toBe(true);
    expect(shouldSkipHealthPass('fail', false)).toBe(true);
    expect(shouldSkipHealthPass('check', true)).toBe(false);
    expect(
      decideOnuHealthBadge({
        planOk: false,
        wanOk: true,
        provisionOk: true,
      }),
    ).toBe('check');
    expect(
      decideOnuHealthBadge({
        planOk: true,
        wanOk: false,
        provisionOk: true,
      }),
    ).toBe('fail');
    expect(
      decideOnuHealthBadge({
        planOk: true,
        wanOk: true,
        provisionOk: true,
      }),
    ).toBe('ok');
  });

  it('backfill solo migradas sin pass cerrado', () => {
    const migrated = new Date('2026-01-01T00:00:00Z');
    expect(
      needsMigratedHealthBackfill({
        migratedAt: migrated,
        verifyStatus: 'idle',
        verifyCheckedAt: null,
      }),
    ).toBe(true);
    expect(
      needsMigratedHealthBackfill({
        migratedAt: migrated,
        verifyStatus: 'ok',
        verifyCheckedAt: new Date('2026-02-01T00:00:00Z'),
      }),
    ).toBe(false);
    expect(
      needsMigratedHealthBackfill({
        migratedAt: null,
        verifyStatus: 'idle',
      }),
    ).toBe(false);
  });
});

describe('needsDbaProfileCheck', () => {
  it('incluye Sin verificar si hay plan de velocidad', () => {
    expect(
      needsDbaProfileCheck({
        verifyStatus: 'ok',
        planOk: null,
        hasSpeedPlan: true,
      }),
    ).toBe(true);
  });

  it('no pide check si ya está OK', () => {
    expect(
      needsDbaProfileCheck({
        verifyStatus: 'ok',
        planOk: true,
        hasSpeedPlan: true,
      }),
    ).toBe(false);
  });

  it('incluye CHECK y mismatch', () => {
    expect(
      needsDbaProfileCheck({
        verifyStatus: 'check',
        planOk: true,
        hasSpeedPlan: true,
      }),
    ).toBe(true);
    expect(
      needsDbaProfileCheck({
        verifyStatus: 'ok',
        planOk: false,
        hasSpeedPlan: true,
      }),
    ).toBe(true);
  });

  it('sin plan ligado no cuenta como sin verificar', () => {
    expect(
      needsDbaProfileCheck({
        verifyStatus: 'ok',
        planOk: null,
        hasSpeedPlan: false,
      }),
    ).toBe(false);
  });
});
