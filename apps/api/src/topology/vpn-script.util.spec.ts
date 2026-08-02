import {
  allocateClientAddressInSubnet,
  allocateTunnelSubnet,
  buildMikrotikVpnScript,
  placeBeforeTables,
  resolvePlaceBeforeBatches,
  scriptToApiBatches,
  tunnelSubnetMatchesProtocol,
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

describe('api-ssl certificate setup', () => {
  it('signs a certificate for api-ssl when the router has none', () => {
    const script = buildMikrotikVpnScript(base);
    expect(script).toContain('/certificate add name="isp-control-api"');
    expect(script).toContain('/ip service set api-ssl disabled=no');
  });

  it('never applies conditional blocks through the RouterOS API', () => {
    const flat = scriptToApiBatches(buildMikrotikVpnScript(base)).map((words) =>
      words.join(' '),
    );
    expect(flat.some((cmd) => cmd.includes('/certificate'))).toBe(false);
    expect(
      flat.some((cmd) => cmd.includes('certificate=isp-control-api')),
    ).toBe(false);
  });
});

describe('scriptToApiBatches', () => {
  it('translates space separated CLI paths into API paths', () => {
    const flat = scriptToApiBatches(buildMikrotikVpnScript(base)).map((words) =>
      words.join(' '),
    );
    expect(flat).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          '/interface/ovpn-client/add =name=isp-ovpn-tenant_1',
        ),
        expect.stringContaining('/ip/firewall/filter/add =chain=input'),
        expect.stringContaining('/ip/route/add =dst-address=192.168.10.0/24'),
      ]),
    );
  });

  it('skips set commands that need an implicit item id', () => {
    expect(scriptToApiBatches('/ip service set api-ssl disabled=no')).toEqual(
      [],
    );
    expect(scriptToApiBatches('/ip service set port=8729')).toEqual([
      ['/ip/service/set', '=port=8729'],
    ]);
  });
});

describe('resolvePlaceBeforeBatches', () => {
  const batches = () =>
    scriptToApiBatches(buildMikrotikVpnScript(base)).filter((w) =>
      w.some((x) => x.startsWith('=place-before=')),
    );

  it('lists only the tables that need a lookup', () => {
    expect(
      placeBeforeTables(scriptToApiBatches(buildMikrotikVpnScript(base))),
    ).toEqual(['/ip/firewall/filter', '/ip/firewall/nat']);
    expect(
      placeBeforeTables([['/ip/route/add', '=dst-address=1.1.1.1/32']]),
    ).toEqual([]);
  });

  it('points to the first rule of the same chain', () => {
    const resolved = resolvePlaceBeforeBatches(batches(), {
      '/ip/firewall/filter': [
        { '.id': '*5', chain: 'input' },
        { '.id': '*9', chain: 'forward' },
      ],
      '/ip/firewall/nat': [{ '.id': '*2', chain: 'srcnat' }],
    });
    const byChain = (chain: string) =>
      resolved
        .filter((w) => w.includes(`=chain=${chain}`))
        .map((w) => w.find((x) => x.startsWith('=place-before=')));
    expect(byChain('forward')).toEqual([
      '=place-before=*9',
      '=place-before=*9',
    ]);
    expect(byChain('input')).toEqual(['=place-before=*5']);
    expect(byChain('srcnat')).toEqual(['=place-before=*2']);
  });

  it('drops the argument when the chain has no rules yet', () => {
    const resolved = resolvePlaceBeforeBatches(batches(), {
      '/ip/firewall/filter': [],
      '/ip/firewall/nat': [],
    });
    expect(
      resolved.every((w) => !w.some((x) => x.startsWith('=place-before='))),
    ).toBe(true);
    // El resto del comando queda intacto
    expect(resolved[0]).toContain('=action=accept');
  });
});

describe('allocateTunnelSubnet', () => {
  it('keeps OpenVPN TCP and WireGuard in the tun0 pool', () => {
    expect(allocateTunnelSubnet([], 'openvpn_tcp').tunnelSubnet).toBe(
      '10.69.1.0/24',
    );
    expect(
      allocateTunnelSubnet(['10.69.1.0/24'], 'wireguard').tunnelSubnet,
    ).toBe('10.69.2.0/24');
  });

  it('allocates next host in the same /24 for extra clients', () => {
    expect(
      allocateClientAddressInSubnet('10.69.1.0/24', ['10.69.1.2']),
    ).toBe('10.69.1.3');
    expect(
      allocateClientAddressInSubnet('10.69.1.0/24', [
        '10.69.1.2',
        '10.69.1.3',
      ]),
    ).toBe('10.69.1.4');
  });

  it('allocates OpenVPN UDP from the tun1 pool', () => {
    const alloc = allocateTunnelSubnet(['10.69.1.0/24'], 'openvpn_udp');
    expect(alloc).toEqual({
      tunnelSubnet: '10.69.129.0/24',
      serverAddress: '10.69.129.1',
      clientAddress: '10.69.129.2',
    });
  });

  it('throws instead of reusing a subnet when the range is full', () => {
    const used = Array.from({ length: 126 }, (_, i) => `10.69.${i + 1}.0/24`);
    expect(() => allocateTunnelSubnet(used, 'openvpn_tcp')).toThrow(
      /Sin subredes libres/,
    );
  });

  it('validates manual subnets against the protocol pool', () => {
    expect(tunnelSubnetMatchesProtocol('10.69.10.0/24', 'openvpn_tcp')).toBe(
      true,
    );
    expect(tunnelSubnetMatchesProtocol('10.69.10.0/24', 'openvpn_udp')).toBe(
      false,
    );
    expect(tunnelSubnetMatchesProtocol('10.69.200.0/24', 'openvpn_udp')).toBe(
      true,
    );
    expect(tunnelSubnetMatchesProtocol('10.70.1.0/24', 'openvpn_tcp')).toBe(
      false,
    );
  });
});
