import { createHash, timingSafeEqual } from 'node:crypto';

/** Constant-time comparison for shared secrets received over HTTP. */
export function secureSecretEquals(
  supplied: string | undefined,
  expected: string | undefined,
): boolean {
  if (!supplied || !expected) return false;
  const suppliedBytes = Buffer.from(supplied);
  const expectedBytes = Buffer.from(expected);
  if (suppliedBytes.length !== expectedBytes.length) return false;
  return timingSafeEqual(suppliedBytes, expectedBytes);
}

/** Non-reversible marker that invalidates JWTs after password changes. */
export function credentialVersion(
  passwordHash: string | null | undefined,
): string {
  return createHash('sha256')
    .update(passwordHash || '')
    .digest('base64url')
    .slice(0, 22);
}
