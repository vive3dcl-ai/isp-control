import {
  isMikrotikReadPath,
  isMikrotikReadWords,
  isMikrotikWriteWordsAllowed,
} from './mikrotik-safe.util';

describe('mikrotik-safe.util', () => {
  it('allows print paths', () => {
    expect(isMikrotikReadPath('/interface/print')).toBe(true);
    expect(isMikrotikReadPath('/ip/address/print')).toBe(true);
    expect(isMikrotikReadPath('/system/resource')).toBe(true);
    expect(isMikrotikReadPath('/interface/set')).toBe(false);
  });

  it('allows read words', () => {
    expect(isMikrotikReadWords(['/ip/route/print'])).toBe(true);
    expect(isMikrotikReadWords(['/interface/set', 'comment=test'])).toBe(
      false,
    );
  });

  it('blocks destructive writes', () => {
    expect(
      isMikrotikWriteWordsAllowed(['/system/reboot']),
    ).toBe(false);
    expect(
      isMikrotikWriteWordsAllowed([
        '/interface/set',
        '=comment=wan-backup',
      ]),
    ).toBe(true);
  });
});
