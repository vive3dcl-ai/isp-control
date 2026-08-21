import {
  parseHuaweiLineProfileTconts,
  parseHuaweiOntLineProfileId,
} from './huawei-olt-dba.util';

describe('huawei-olt-dba.util', () => {
  it('parsea Line profile ID desde ont info', () => {
    expect(
      parseHuaweiOntLineProfileId(
        '  Line profile ID   : 20\n  Srv profile ID    : 20\n',
      ),
    ).toBe(20);
  });

  it('parsea T-CONT + DBA Profile-ID del line profile', () => {
    const dba = new Map<number, string>([[102, 'TLG-100-50-UP']]);
    const binds = parseHuaweiLineProfileTconts(
      `
  -----------------------------------------------------------------------------
  T-CONT 1          DBA Profile-ID:102
  T-CONT 2          DBA Profile-ID:1
  -----------------------------------------------------------------------------
`,
      dba,
    );
    expect(binds).toEqual([
      { tcontId: 1, profile: 'TLG-100-50-UP' },
      { tcontId: 2, profile: 'id:1' },
    ]);
  });
});
