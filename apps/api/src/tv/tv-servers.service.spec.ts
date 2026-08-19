import { compareAgentVersions } from './tv-servers.service';

describe('compareAgentVersions', () => {
  it('orders semver-like strings', () => {
    expect(compareAgentVersions('0.2.0', '0.1.0')).toBeGreaterThan(0);
    expect(compareAgentVersions('0.1.0', '0.2.0')).toBeLessThan(0);
    expect(compareAgentVersions('0.2.0', 'v0.2.0')).toBe(0);
    expect(compareAgentVersions('0.2.1', '0.2.0')).toBeGreaterThan(0);
  });
});
