import { secureSecretEquals } from './secure-compare';

describe('secureSecretEquals', () => {
  it('accepts identical non-empty secrets', () => {
    expect(secureSecretEquals('secret-value', 'secret-value')).toBe(true);
  });

  it('rejects missing, different-length, and different secrets', () => {
    expect(secureSecretEquals(undefined, 'secret-value')).toBe(false);
    expect(secureSecretEquals('', 'secret-value')).toBe(false);
    expect(secureSecretEquals('short', 'longer')).toBe(false);
    expect(secureSecretEquals('secret-value', 'secret-valuE')).toBe(false);
  });
});
