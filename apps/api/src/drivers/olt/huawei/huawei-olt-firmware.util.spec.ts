import {
  cliRejected,
  detectHuaweiFwFamily,
  parseServicePortIndexesByGemport,
  parseServicePortIndexesByVlan,
  stripHuaweiDialectTag,
  parseOntLineProfileId,
  buildOntIpconfigCommands,
} from './huawei-olt-firmware.util';

describe('huawei-olt-firmware.util', () => {
  describe('detectHuaweiFwFamily', () => {
    it('uses subtype first', () => {
      expect(detectHuaweiFwFamily({ subtype: 'huawei_ma5800_x17' })).toBe(
        'ma5800',
      );
      expect(detectHuaweiFwFamily({ subtype: 'huawei_ma5608t' })).toBe(
        'ma5600t',
      );
    });

    it('parses product / softVer banners', () => {
      expect(
        detectHuaweiFwFamily({ product: 'MA5800-X17', softVer: 'V100R019' }),
      ).toBe('ma5800');
      expect(
        detectHuaweiFwFamily({ product: 'MA5608T', softVer: 'V800R015' }),
      ).toBe('ma5600t');
    });

    it('reads dialect tags in hints', () => {
      expect(detectHuaweiFwFamily({ versionText: 'V100R019 · ma5800' })).toBe(
        'ma5800',
      );
    });
  });

  describe('cliRejected', () => {
    it('ignores Failure: 0 success counters', () => {
      expect(cliRejected('  Failure: 0  Error: 0  ')).toBe(false);
      expect(cliRejected('Command is being executed...\nFailure: 0')).toBe(
        false,
      );
    });

    it('detects real CLI rejects', () => {
      expect(cliRejected('% Error: Wrong parameter found at')).toBe(true);
      expect(cliRejected('Unrecognized command found at')).toBe(true);
      expect(cliRejected('Failure: 1')).toBe(true);
    });
  });

  describe('parseServicePortIndexesByGemport', () => {
    it('parses common ATTR table rows (VCI = gem)', () => {
      const text = `
  Index VLAN  VLANATTR Port                 VPI  VCI FlowType FlowPara
  2677  212   common   gpon 0/1/0           0    1   vlan     212
  2680  100   common   gpon 0/1/0           0    2   vlan     100
`;
      expect(parseServicePortIndexesByGemport(text, 1)).toEqual(['2677']);
      expect(parseServicePortIndexesByGemport(text, 2)).toEqual(['2680']);
    });

    it('parses gemport keyword form', () => {
      const text =
        'service-port 10 vlan 100 gpon 0/1/0 ont 4 gemport 2 multi-service user-vlan 100';
      expect(parseServicePortIndexesByGemport(text, 2)).toEqual(['10']);
    });
  });

  describe('parseServicePortIndexesByVlan', () => {
    it('matches vlan column', () => {
      const text = `2677 212 common gpon 0/1/0 0 1 vlan 212`;
      expect(parseServicePortIndexesByVlan(text, 212)).toEqual(['2677']);
    });
  });

  describe('stripHuaweiDialectTag', () => {
    it('strips historic softVer pollution', () => {
      expect(stripHuaweiDialectTag('V100R019C10 · ma5800')).toBe('V100R019C10');
      expect(stripHuaweiDialectTag('ma5600t')).toBe('ma5600t');
    });
  });

  describe('parseOntLineProfileId', () => {
    it('reads line profile id', () => {
      expect(
        parseOntLineProfileId('Line profile ID  : 10\nRun state : online'),
      ).toBe(10);
    });
  });

  describe('buildOntIpconfigCommands', () => {
    it('orders ma5800 forms first for ma5800', () => {
      const cmds = buildOntIpconfigCommands({
        port: 0,
        ontId: 1,
        ipIndex: 0,
        vlan: 100,
        mode: 'static',
        ip: '10.0.0.2',
        mask: '255.255.255.0',
        gateway: '10.0.0.1',
        family: 'ma5800',
      });
      expect(cmds[0]).toContain('static ip-address');
    });

    it('orders classic forms first for ma5600t', () => {
      const cmds = buildOntIpconfigCommands({
        port: 0,
        ontId: 1,
        ipIndex: 0,
        vlan: 100,
        mode: 'static',
        ip: '10.0.0.2',
        mask: '255.255.255.0',
        gateway: '10.0.0.1',
        family: 'ma5600t',
      });
      expect(cmds[0]).toMatch(/static 10\.0\.0\.2/);
    });
  });
});
