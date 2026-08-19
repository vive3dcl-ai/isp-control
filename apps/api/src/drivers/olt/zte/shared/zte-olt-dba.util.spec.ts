import { toSystemOltProfileName } from './zte-olt-speed.util';
import {
  decideOnuHealthBadge,
  expectedInternetTcontUp,
  needsMigratedHealthBackfill,
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
