import { sshHostVerification } from './olt-ssh-host-key.util';

describe('sshHostVerification', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv, NODE_ENV: 'production' };
    delete process.env.OLT_SSH_HOST_KEYS;
    delete process.env.OLT_SSH_ALLOW_UNVERIFIED;
    delete process.env.OLT_SSH_REQUIRE_HOST_KEYS;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('allows panel-managed OLTs without a pinned key by default', () => {
    expect(sshHostVerification('10.0.0.2', 22)).toEqual({});
  });

  it('treats an empty JSON map as no pins', () => {
    process.env.OLT_SSH_HOST_KEYS = '{}';
    expect(sshHostVerification('10.0.0.2', 22)).toEqual({});
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

  it('fails closed when host keys are explicitly required', () => {
    process.env.OLT_SSH_REQUIRE_HOST_KEYS = 'true';
    expect(() => sshHostVerification('10.0.0.2', 22)).toThrow(
      'Falta fingerprint SSH',
    );
  });

  it('fails closed when unverified SSH is explicitly disabled', () => {
    process.env.OLT_SSH_ALLOW_UNVERIFIED = 'false';
    expect(() => sshHostVerification('10.0.0.2', 22)).toThrow(
      'Falta fingerprint SSH',
    );
  });
});
