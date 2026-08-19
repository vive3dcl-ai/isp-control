import {
  buildZteIgmpMvlanEnsureCommands,
  buildZteIgmpReceivePortCommand,
  buildZteIgmpSourcePortCommands,
  interpretIgmpMvlanStep,
  interpretNoVlanOutput,
  mergeVlanCatalogs,
  parseVlansFromRunningConfig,
  parseVlansFromShowVlan,
  ZTE_IPTV_VPORT,
} from './zte-olt-vlan.util';

describe('zte-olt-vlan.util', () => {
  it('parses show vlan table rows', () => {
    const text = `
vlanid   status   name
1        enable
100      enable   INTERNET
200      enable   IPTV
`;
    const rows = parseVlansFromShowVlan(text);
    expect(rows.map((r) => r.vlanId)).toEqual([1, 100, 200]);
    expect(rows.find((r) => r.vlanId === 100)?.description).toBe('INTERNET');
  });

  it('merges show vlan names with running-config isolation', () => {
    const show = parseVlansFromShowVlan(`
1 enable Sistema
100 enable CLIENTS
`);
    const cfg = parseVlansFromRunningConfig(`
vlan 100
 name CLIENTS
 all-to-all
!
interface gpon-olt_1/2/1
 switchport vlan 100 tag
!
`);
    const merged = mergeVlanCatalogs(show, cfg);
    const v100 = merged.find((r) => r.vlanId === 100);
    expect(v100?.description).toBe('CLIENTS');
    expect(v100?.isolated).toBe(false);
    expect(v100?.defaultPonPorts).toContain('gpon-olt_1/2/1');
  });

  it('does not treat include-only vlan lines as rich catalog alone', () => {
    const bare = parseVlansFromRunningConfig(`
vlan 1
vlan 10
vlan 20
`);
    expect(bare.length).toBeGreaterThan(1);
    expect(bare.every((v) => v.vlanId === 1 || !v.description)).toBe(true);
  });

  describe('interpretNoVlanOutput', () => {
    it('accepts a clean removal', () => {
      const r = interpretNoVlanOutput('no vlan 401\r\nZXAN(config)#');
      expect(r).toEqual({ ok: true, absent: false, detail: null });
    });

    it('treats a missing vlan as already removed', () => {
      const r = interpretNoVlanOutput(
        'no vlan 401\r\n%Error 1002: vlan 401 does not exist\r\nZXAN(config)#',
      );
      expect(r.ok).toBe(true);
      expect(r.absent).toBe(true);
    });

    it('fails when the OLT rejects the removal', () => {
      const r = interpretNoVlanOutput(
        'no vlan 401\r\n%Error: vlan 401 is used by service-port 12\r\nZXAN(config)#',
      );
      expect(r.ok).toBe(false);
      expect(r.detail).toContain('service-port 12');
    });

    it('fails on a bare invalid input', () => {
      expect(interpretNoVlanOutput('% Invalid input detected').ok).toBe(false);
    });
  });

  describe('IGMP MVLAN ensure', () => {
    it('builds the minimum safe command set', () => {
      expect(buildZteIgmpMvlanEnsureCommands(3850)).toEqual([
        'igmp enable',
        'igmp span-vlan enable',
        'igmp mvlan 3850',
        'igmp mvlan 3850 enable',
        'igmp mvlan 3850 work-mode snooping',
      ]);
      expect(buildZteIgmpMvlanEnsureCommands(3850, 'proxy')).toContain(
        'igmp mvlan 3850 work-mode proxy',
      );
      expect(
        buildZteIgmpMvlanEnsureCommands(3850, 'proxy', '10.99.1.10'),
      ).toContain('igmp mvlan 3850 host-ip 10.99.1.10');
      expect(
        buildZteIgmpMvlanEnsureCommands(3850, 'snooping', '10.99.1.10'),
      ).not.toContain('host-ip');
    });

    it('treats soft enable failures as non-fatal', () => {
      expect(
        interpretIgmpMvlanStep('igmp enable', '%Error: Incomplete command').fatal,
      ).toBe(false);
      expect(
        interpretIgmpMvlanStep(
          'igmp span-vlan enable',
          '% Invalid input detected',
        ).fatal,
      ).toBe(false);
      expect(
        interpretIgmpMvlanStep(
          'igmp mvlan 3850 enable',
          '%Error: Unknown command',
        ).fatal,
      ).toBe(false);
    });

    it('treats already-existing MVLAN as non-fatal', () => {
      expect(
        interpretIgmpMvlanStep(
          'igmp mvlan 3850',
          '%Error: mvlan 3850 already exist',
        ).fatal,
      ).toBe(false);
    });

    it('flags hard rejection of igmp mvlan create', () => {
      const r = interpretIgmpMvlanStep(
        'igmp mvlan 3850',
        '%Error: VLAN 3850 does not exist',
      );
      expect(r.fatal).toBe(true);
      expect(r.detail).toMatch(/3850/);
    });
  });

  describe('IGMP source/receive ports', () => {
    it('builds source-port add/remove', () => {
      expect(
        buildZteIgmpSourcePortCommands(3850, {
          add: ['gei_1/3/1'],
          remove: ['gei_1/3/2'],
        }),
      ).toEqual([
        'no igmp mvlan 3850 source-port gei_1/3/2',
        'igmp mvlan 3850 source-port gei_1/3/1',
      ]);
    });

    it('builds receive-port for IPTV vport', () => {
      expect(ZTE_IPTV_VPORT).toBe(3);
      expect(
        buildZteIgmpReceivePortCommand(
          3850,
          'gpon-onu_1/1/1:5',
          ZTE_IPTV_VPORT,
          true,
        ),
      ).toBe(
        'igmp mvlan 3850 receive-port gpon-onu_1/1/1:5 vport 3',
      );
      expect(
        buildZteIgmpReceivePortCommand(
          3850,
          'gpon-onu_1/1/1:5',
          ZTE_IPTV_VPORT,
          false,
        ),
      ).toBe(
        'no igmp mvlan 3850 receive-port gpon-onu_1/1/1:5 vport 3',
      );
    });
  });
});
