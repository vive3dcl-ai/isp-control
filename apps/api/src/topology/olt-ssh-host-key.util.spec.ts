import { sshHostVerification } from './olt-ssh-host-key.util';

describe('sshHostVerification', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv, NODE_ENV: 'production' };
    delete process.env.OLT_SSH_HOST_KEYS;
    delete process.env.OLT_SSH_ALLOW_UNVERIFIED;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('fails closed in production without a pinned key', () => {
    expect(() => sshHostVerification('10.0.0.2', 22)).toThrow(
      'Falta fingerprint SSH',
    );
  });

  it('accepts only the configured SHA256 fingerprint', () => {
    const hex = '00'.repeat(32);
    const base64 = Buffer.from(hex, 'hex')
      .toString('base64')
      .replace(/=+$/, '');
    process.env.OLT_SSH_HOST_KEYS = JSON.stringify({
      '10.0.0.2:22': `SHA256:${base64}`,
    });

    const config = sshHostVerification('10.0.0.2', 22);
    expect(config.hostHash).toBe('sha256');
    expect(config.hostVerifier?.(hex)).toBe(true);
    expect(config.hostVerifier?.('11'.repeat(32))).toBe(false);
  });

  it('requires an explicit break-glass flag to skip verification', () => {
    process.env.OLT_SSH_ALLOW_UNVERIFIED = 'true';
    expect(sshHostVerification('10.0.0.2', 22)).toEqual({});
  });
});
