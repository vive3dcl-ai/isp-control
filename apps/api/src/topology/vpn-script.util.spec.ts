import {
  buildMikrotikVpnScript,
  type VpnScriptContext,
} from './vpn-script.util';

const base: VpnScriptContext = {
  name: 'tenant_1',
  protocol: 'openvpn_tcp',
  password: 'safe-password',
  clientAddress: '10.69.1.2',
  serverAddress: '10.69.1.1',
  tunnelRoutes: ['192.168.10.0/24'],
  vpnHost: 'vpn.isp.test',
  vpnPort: 1194,
};

describe('buildMikrotikVpnScript security', () => {
  it('builds a script for validated values', () => {
    expect(buildMikrotikVpnScript(base)).toContain(
      '/interface ovpn-client add',
    );
  });

  it.each([
    { name: 'bad"name' },
    { name: 'bad\n/system user add group=full' },
    { password: 'bad"\n/system user add group=full' },
    { vpnHost: 'vpn.example.com\n/system reset-configuration' },
  ])('rejects RouterOS command injection values: %o', (override) => {
    expect(() => buildMikrotikVpnScript({ ...base, ...override })).toThrow();
  });
});
