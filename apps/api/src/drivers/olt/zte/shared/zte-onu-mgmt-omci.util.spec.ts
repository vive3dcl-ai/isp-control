import {
  buildZteOnuMgmtCleanup,
  buildZteOnuFlowCommands,
  buildZteOnuMgmtIpHostCommands,
  buildZteOnuVeipVlanCommands,
  type ZteOnuMgmtOmciParams,
} from './zte-onu-mgmt-omci.util';

const base: ZteOnuMgmtOmciParams = {
  index: 2,
  priority: 2,
  vlan: 401,
  ip: '30.30.20.13',
  mask: '255.255.255.0',
  gateway: '30.30.20.1',
};

const lines = (cmds: { line: string }[]) => cmds.map((c) => c.line);

describe('secuencia OMCI de gestión ZTE', () => {
  describe('camino L2', () => {
    it('crea el flow antes de configurarlo', () => {
      const out = lines(buildZteOnuFlowCommands(base));
      const create = out.indexOf('flow 2 switch switch_0/1');
      expect(create).toBe(0);
      // Sin el create previo la OLT responde "Flow does not exist".
      expect(create).toBeLessThan(out.indexOf('flow mode 2 tag-filter vlan-filter untag-filter discard'));
      expect(create).toBeLessThan(out.indexOf('flow 2 pri 2 vlan 401'));
      expect(create).toBeLessThan(out.indexOf('gemport 2 flow 2'));
    });

    it('ata el gemport al flow del mismo índice', () => {
      expect(lines(buildZteOnuFlowCommands({ ...base, index: 3 }))).toContain(
        'gemport 3 flow 3',
      );
    });

    it('marca todo el camino L2 como crítico', () => {
      for (const cmd of buildZteOnuFlowCommands(base)) {
        expect(cmd.critical).toBe(true);
      }
    });
  });

  describe('gestión IP', () => {
    it('usa el mismo índice en ip-host, switchport-bind y vlan-filter', () => {
      const out = lines(buildZteOnuMgmtIpHostCommands({ ...base, index: 2 }));
      expect(out).toContain('switchport-bind switch_0/1 iphost 2');
      expect(out).toContain(
        'ip-host 2 ip 30.30.20.13 mask 255.255.255.0 gateway 30.30.20.1',
      );
      expect(out).toContain(
        'vlan-filter-mode iphost 2 tag-filter vlan-filter untag-filter discard',
      );
      expect(out).toContain('vlan-filter iphost 2 pri 2 vlan 401');
      expect(out).toContain('veip 1 port udp 1232 host 2');
      expect(out.some((l) => /ping-response|traceroute-response/.test(l))).toBe(
        false,
      );
      // El fallo original: filtrar sobre el veip en vez de sobre el ip-host.
      expect(out.some((l) => /^vlan-filter(-mode)? veip /.test(l))).toBe(false);
    });

    it('no deja ningún índice suelto al cambiar de índice', () => {
      const out = lines(buildZteOnuMgmtIpHostCommands({ ...base, index: 3 }));
      const iphostRefs = out.filter((l) => /iphost|ip-host|host \d/.test(l));
      expect(iphostRefs.length).toBeGreaterThan(0);
      for (const l of iphostRefs) {
        expect(l).not.toMatch(/\b(iphost|ip-host|host) [^3]\b/);
      }
    });

    it('omite la dirección cuando no hay IP, pero mantiene los filtros', () => {
      const out = lines(
        buildZteOnuMgmtIpHostCommands({
          ...base,
          ip: null,
          mask: null,
          gateway: null,
        }),
      );
      expect(out.some((l) => l.startsWith('ip-host 2 ip '))).toBe(false);
      expect(out).toContain('vlan-filter iphost 2 pri 2 vlan 401');
    });

    it('deja el bind del veip como no crítico y el del iphost como crítico', () => {
      const cmds = buildZteOnuMgmtIpHostCommands(base);
      const veip = cmds.find((c) => c.line === 'switchport-bind switch_0/1 veip 1');
      const iphost = cmds.find((c) => c.line === 'switchport-bind switch_0/1 iphost 2');
      expect(veip?.critical).toBe(false);
      expect(iphost?.critical).toBe(true);
    });
  });

  describe('admisión de VLAN en el veip', () => {
    it('mete la VLAN de servicio en la lista blanca del veip', () => {
      const out = lines(buildZteOnuVeipVlanCommands({ priority: 0, vlan: 701 }));
      expect(out).toContain('switchport-bind switch_0/1 veip 1');
      expect(out).toContain(
        'vlan-filter-mode veip 1 tag-filter vlan-filter untag-filter discard',
      );
      // Sin esta línea el router del CPE no ve la WAN: IP puesta y cero ARP.
      expect(out).toContain('vlan-filter veip 1 pri 0 vlan 701');
    });

    it('no toca el iphost, que es cosa de la gestión', () => {
      const out = lines(buildZteOnuVeipVlanCommands({ priority: 0, vlan: 701 }));
      expect(out.some((l) => /iphost/.test(l))).toBe(false);
    });
  });

  describe('limpieza previa', () => {
    it('borra flow, ip-host y bind del índice antes de reescribir', () => {
      expect(buildZteOnuMgmtCleanup(2)).toEqual([
        'no switchport-bind iphost 2',
        'no ip-host 2',
        'no flow 2',
      ]);
    });
  });
});
