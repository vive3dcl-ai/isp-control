import type { SyncHostFingerprintVerifier } from 'ssh2';

interface HostVerification {
  hostHash?: string;
  hostVerifier?: SyncHostFingerprintVerifier;
}

function configuredFingerprint(host: string, port: number): string | null {
  const raw = process.env.OLT_SSH_HOST_KEYS?.trim();
  if (!raw || raw === '{}') return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const value = parsed[`${host}:${port}`] ?? parsed[host];
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  } catch {
    throw new Error(
      'OLT_SSH_HOST_KEYS debe ser JSON: {"host:puerto":"SHA256:fingerprint"}',
    );
  }
}

function fingerprintMatches(actualHex: string, expected: string): boolean {
  const normalized = expected.trim();
  if (/^SHA256:/i.test(normalized)) {
    const expectedBase64 = normalized.slice(7).replace(/=+$/, '');
    const actualBase64 = Buffer.from(actualHex, 'hex')
      .toString('base64')
      .replace(/=+$/, '');
    return actualBase64 === expectedBase64;
  }
  return actualHex.toLowerCase() === normalized.replace(/:/g, '').toLowerCase();
}

/**
 * Optional SSH host-key pinning for OLTs.
 *
 * Tenants add OLTs from the panel with dynamic management IPs, so unverified
 * SSH is allowed by default. When a fingerprint exists in OLT_SSH_HOST_KEYS it
 * is always enforced. Set OLT_SSH_REQUIRE_HOST_KEYS=true only if every SSH OLT
 * must be listed in the env map before connecting.
 */
export function sshHostVerification(
  host: string,
  port: number,
): HostVerification {
  const expected = configuredFingerprint(host, port);
  if (expected) {
    const hostVerifier: SyncHostFingerprintVerifier = (actual) =>
      fingerprintMatches(actual, expected);
    return {
      hostHash: 'sha256',
      hostVerifier,
    };
  }

  const requireKeys = process.env.OLT_SSH_REQUIRE_HOST_KEYS === 'true';
  const allowUnverified = process.env.OLT_SSH_ALLOW_UNVERIFIED !== 'false';
  if (requireKeys || !allowUnverified) {
    throw new Error(
      `Falta fingerprint SSH para ${host}:${port} en OLT_SSH_HOST_KEYS`,
    );
  }
  return {};
}
