import {
  applyZteOnuAdminToggle,
  zteCliLooksRejected,
  zteOnuAdminAttempts,
} from './zte-olt-onu-admin.util';

describe('zteOnuAdminAttempts', () => {
  it('C3xx suspends via ONU-interface shutdown, not onu N disable', () => {
    const attempts = zteOnuAdminAttempts({
      action: 'disable',
      fwFamily: 'c3xx',
      oltIf: 'gpon-olt_1/2/9',
      onuIf: 'gpon-onu_1/2/9:34',
      onuId: '34',
    });
    expect(attempts.map((a) => a.cmd)).toEqual([
      'shutdown',
      'onu 34 disable',
    ]);
    expect(attempts[0].enterIf).toBe('gpon-onu_1/2/9:34');
  });

  it('C6xx tries onu N disable first', () => {
    const attempts = zteOnuAdminAttempts({
      action: 'disable',
      fwFamily: 'c6xx',
      oltIf: 'gpon_olt-1/2/9',
      onuIf: 'gpon_onu-1/2/9:34',
      onuId: '34',
    });
    expect(attempts[0]).toEqual({
      id: 'olt-onu-flag',
      enterIf: 'gpon_olt-1/2/9',
      cmd: 'onu 34 disable',
    });
  });

  it('enable uses no shutdown / onu N enable', () => {
    const c3 = zteOnuAdminAttempts({
      action: 'enable',
      fwFamily: 'c3xx',
      oltIf: 'gpon-olt_1/2/9',
      onuIf: 'gpon-onu_1/2/9:34',
      onuId: '34',
    });
    expect(c3[0].cmd).toBe('no shutdown');
    expect(c3[1].cmd).toBe('onu 34 enable');
  });
});

describe('applyZteOnuAdminToggle', () => {
  it('C3xx falls through Error 20201 on onu disable and uses shutdown', async () => {
    const sent: string[] = [];
    const replies = [
      '', // interface gpon-onu
      '', // shutdown ok
      '', // exit
    ];
    const result = await applyZteOnuAdminToggle({
      action: 'disable',
      fwFamily: 'c3xx',
      oltIf: 'gpon-olt_1/2/9',
      onuIf: 'gpon-onu_1/2/9:34',
      onuId: '34',
      send: async (cmd) => {
        sent.push(cmd);
      },
      read: async () => replies.shift() ?? '',
      clean: (s) => s,
    });
    expect(result.method).toBe('onu-if-shutdown');
    expect(sent).toEqual([
      'interface gpon-onu_1/2/9:34',
      'shutdown',
      'exit',
    ]);
  });

  it('C6xx skips rejected onu disable and falls back to shutdown', async () => {
    const sent: string[] = [];
    const replies = [
      '', // interface olt ok
      '^ %Error 20201: Invalid input detected at \'^\' marker.Invalid command key word',
      '', // exit after failed cmd
      '', // interface onu
      '', // shutdown
      '', // exit
    ];
    const result = await applyZteOnuAdminToggle({
      action: 'disable',
      fwFamily: 'c6xx',
      oltIf: 'gpon_olt-1/2/9',
      onuIf: 'gpon_onu-1/2/9:34',
      onuId: '34',
      send: async (cmd) => {
        sent.push(cmd);
      },
      read: async () => replies.shift() ?? '',
      clean: (s) => s,
    });
    expect(result.method).toBe('onu-if-shutdown');
    expect(sent).toContain('onu 34 disable');
    expect(sent).toContain('shutdown');
  });

  it('detects ZTE Error 20201 as rejected', () => {
    expect(
      zteCliLooksRejected(
        "^ %Error 20201: Invalid input detected at '^' marker.Invalid command key word",
      ),
    ).toBe(true);
  });
});
