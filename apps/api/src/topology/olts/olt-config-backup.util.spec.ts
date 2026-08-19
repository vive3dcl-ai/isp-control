import {
  diffConfigLines,
  looksCompleteHuaweiConfig,
  looksCompleteOltConfigDump,
  oltBackupDir,
  oltBackupFilePath,
  sanitizeBackupSegment,
  shouldSkipOltHealWrites,
} from './olt-config-backup.util';

describe('olt backup paths', () => {
  it('aisla schema y oltId en el path', () => {
    const a = oltBackupDir('tenant_acme', '11111111-1111-1111-1111-111111111111');
    const b = oltBackupDir('tenant_otro', '11111111-1111-1111-1111-111111111111');
    expect(a).not.toBe(b);
    expect(a).toContain('tenant_acme');
    expect(oltBackupFilePath('t', 'o', '../x.cfg')).toMatch(/x\.cfg$/);
    expect(sanitizeBackupSegment('../evil')).toBe('_evil');
  });
});

describe('looksCompleteOltConfigDump', () => {
  it('no marca completo un dump ZTE truncado', () => {
    expect(
      looksCompleteOltConfigDump('interface gpon-olt_1/1/1\n  description foo', 'zte'),
    ).toBe(false);
  });

  it('marca completo un dump ZTE con prompt final', () => {
    const text = [
      'interface gpon-olt_1/1/1',
      '  description PON',
      'ZXAN#',
    ].join('\n');
    expect(looksCompleteOltConfigDump(text, 'zte')).toBe(true);
  });

  it('Huawei incompleto sin return/prompt', () => {
    expect(looksCompleteHuaweiConfig('interface GigabitEthernet0/1/0')).toBe(
      false,
    );
  });
});

describe('shouldSkipOltHealWrites', () => {
  it('bloquea heal si técnico en OLT', () => {
    expect(shouldSkipOltHealWrites(true)).toBe(true);
    expect(shouldSkipOltHealWrites(false)).toBe(false);
    expect(shouldSkipOltHealWrites(undefined)).toBe(false);
  });
});

describe('diffConfigLines', () => {
  it('cuenta altas y bajas', () => {
    const d = diffConfigLines('vlan 10\nvlan 20\n', 'vlan 10\nvlan 30\n');
    expect(d.removed).toBe(1);
    expect(d.added).toBe(1);
    expect(d.hunks.some((h) => h.kind === 'del' && h.text === 'vlan 20')).toBe(
      true,
    );
    expect(d.hunks.some((h) => h.kind === 'add' && h.text === 'vlan 30')).toBe(
      true,
    );
  });
});
