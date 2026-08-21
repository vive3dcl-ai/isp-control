import {
  firmwareModelMatches,
  firmwareUpgradeSkipReason,
} from './onu-firmware.util';

describe('firmwareModelMatches', () => {
  it('casa tipo OLT con la clave de imagen (normalizada)', () => {
    expect(firmwareModelMatches('HG9', 'HG9')).toBe(true);
    expect(firmwareModelMatches('Huawei-HG8145X6', 'HG8145X6')).toBe(true);
    expect(firmwareModelMatches('HG8145X6-10', 'HG8145X6')).toBe(true);
    expect(firmwareModelMatches('F660', 'F660')).toBe(true);
  });

  it('no casa otro modelo ni vacío', () => {
    expect(firmwareModelMatches('HG9', 'HG8145X6')).toBe(false);
    expect(firmwareModelMatches('HG9', null)).toBe(false);
    expect(firmwareModelMatches('HG9', 'n/a')).toBe(false);
    expect(firmwareModelMatches('', 'HG9')).toBe(false);
  });
});

describe('firmwareUpgradeSkipReason', () => {
  it('no encola sin SN o sin ACS', () => {
    expect(
      firmwareUpgradeSkipReason({
        sn: null,
        acsDeviceId: 'dev-1',
        genieFileId: 'fw.bin',
      }),
    ).toBe('sin_sn');
    expect(
      firmwareUpgradeSkipReason({
        sn: '  ',
        acsDeviceId: 'dev-1',
        genieFileId: 'fw.bin',
      }),
    ).toBe('sin_sn');
    expect(
      firmwareUpgradeSkipReason({
        sn: 'ZTEG1234',
        acsDeviceId: null,
        genieFileId: 'fw.bin',
      }),
    ).toBe('sin_acs');
  });

  it('no encola si el archivo no está en GenieACS', () => {
    expect(
      firmwareUpgradeSkipReason({
        sn: 'ZTEG1234',
        acsDeviceId: 'dev-1',
        genieFileId: null,
      }),
    ).toBe('sin_archivo_acs');
  });

  it('permite encolar con SN, ACS y archivo', () => {
    expect(
      firmwareUpgradeSkipReason({
        sn: 'ZTEG1234',
        acsDeviceId: 'OUI-HG9-ZTEG1234',
        genieFileId: 'isp-fw.bin',
      }),
    ).toBeNull();
  });
});
