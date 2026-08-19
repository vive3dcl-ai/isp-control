import {
  buildWanDnsParams,
  dataModelOf,
  findServiceWanConnection,
  listWanCandidates,
  readWanConnectionState,
  resolveWanWriteTargets,
  wanRefreshTargets,
} from './wan-datamodel';

const leaf = (value: unknown) => ({ _value: value });

/**
 * Copiado del árbol real de una ZTE F6600P: la LAN, la WAN heredada de SmartOLT
 * en VLAN 351, la de gestión en 401 y la de servicio en 702.
 */
function tr181Device(): Record<string, unknown> {
  return {
    _id: 'C4EBFF-F6600P-5A544547D71F2028',
    Device: {
      ManagementServer: {
        ConnectionRequestUsername: leaf('acs'),
      },
      IP: {
        Interface: {
          1: {
            Name: leaf('DEV.IP.IF1'),
            Status: leaf('Up'),
            LowerLayers: leaf('Device.Ethernet.Link.1'),
            'X_ZTE-COM_ServiceList': leaf(''),
            IPv4Address: {
              1: {
                IPAddress: leaf('192.168.1.1'),
                SubnetMask: leaf('255.255.255.0'),
                'X_ZTE-COM_Gateway': leaf('0.0.0.0'),
                AddressingType: leaf('Static'),
              },
            },
          },
          3: {
            Name: leaf('DEV.IP.IF3'),
            Status: leaf('Up'),
            LowerLayers: leaf('Device.Ethernet.VLANTermination.1'),
            'X_ZTE-COM_ServiceList': leaf('INTERNET'),
            IPv4Address: {
              1: {
                IPAddress: leaf('10.0.110.3'),
                SubnetMask: leaf('255.255.255.0'),
                'X_ZTE-COM_Gateway': leaf('10.0.110.1'),
                AddressingType: leaf('Static'),
              },
            },
          },
          4: {
            Name: leaf('DEV.IP.IF4'),
            Status: leaf('Up'),
            LowerLayers: leaf('Device.Ethernet.VLANTermination.2'),
            'X_ZTE-COM_ServiceList': leaf('TR069_VoIP'),
            IPv4Address: {
              1: {
                IPAddress: leaf('30.30.20.62'),
                SubnetMask: leaf('255.255.255.0'),
                'X_ZTE-COM_Gateway': leaf('30.30.20.1'),
                AddressingType: leaf('Static'),
              },
            },
          },
          5: {
            Name: leaf('DEV.IP.IF5'),
            Status: leaf('Up'),
            LowerLayers: leaf('Device.Ethernet.VLANTermination.3'),
            'X_ZTE-COM_ServiceList': leaf('INTERNET_TR069_VoIP'),
            IPv4Address: {
              1: {
                IPAddress: leaf('40.40.21.10'),
                SubnetMask: leaf('255.255.255.0'),
                'X_ZTE-COM_Gateway': leaf('40.40.21.1'),
                AddressingType: leaf('Static'),
              },
            },
            Stats: {
              BytesReceived: leaf(6672),
              BytesSent: leaf(0),
            },
          },
        },
      },
      Ethernet: {
        VLANTermination: {
          1: { VLANID: leaf(351), Enable: leaf(true) },
          2: { VLANID: leaf(401), Enable: leaf(true) },
          3: { VLANID: leaf(702), Enable: leaf(true) },
        },
      },
      NAT: {
        InterfaceSetting: {
          2: { Interface: leaf('Device.IP.Interface.4'), Enable: leaf(false) },
          3: { Interface: leaf('Device.IP.Interface.5'), Enable: leaf(true) },
        },
      },
      DNS: {
        Client: {
          Server: {
            5: {
              Interface: leaf('Device.IP.Interface.5'),
              DNSServer: leaf('8.8.8.8'),
            },
            6: {
              Interface: leaf('Device.IP.Interface.5'),
              DNSServer: leaf('8.8.4.4'),
            },
          },
        },
      },
    },
  };
}

function tr098Device(): Record<string, unknown> {
  const conn = {
    Name: leaf('1_INTERNET_R_VID_702'),
    ExternalIPAddress: leaf('40.40.21.3'),
    SubnetMask: leaf('255.255.255.0'),
    DefaultGateway: leaf('40.40.21.1'),
    DNSServers: leaf('8.8.8.8,8.8.4.4'),
    NATEnabled: leaf(true),
    AddressingType: leaf('Static'),
    ConnectionStatus: leaf('Connected'),
    VLANID: leaf(702),
    VLANEnable: leaf(true),
    Stats: {
      EthernetBytesSent: leaf(241242),
      EthernetBytesReceived: leaf(0),
    },
  };
  const mgmt = {
    Name: leaf('2_TR069_R_VID_401'),
    ExternalIPAddress: leaf('30.30.20.54'),
    VLANID: leaf(401),
  };
  return {
    _id: '00259E-HG8145X6-48575443DF6800AA',
    InternetGatewayDevice: {
      WANDevice: {
        1: {
          WANConnectionDevice: {
            1: { WANIPConnection: { 1: conn } },
            2: { WANIPConnection: { 1: mgmt } },
          },
        },
      },
    },
  };
}

describe('modelo de datos del CPE', () => {
  it('reconoce TR-181 por la raíz Device', () => {
    expect(dataModelOf(tr181Device())).toBe('tr181');
  });

  it('reconoce TR-098 por InternetGatewayDevice', () => {
    expect(dataModelOf(tr098Device())).toBe('tr098');
  });

  it('refresca los cuatro subárboles que reparten la WAN en TR-181', () => {
    expect(wanRefreshTargets('tr181')).toEqual([
      'Device.IP.Interface',
      'Device.Ethernet.VLANTermination',
      'Device.NAT.InterfaceSetting',
      'Device.DNS.Client',
    ]);
  });
});

describe('candidatas a WAN en TR-181', () => {
  it('deja fuera la LAN, que también es una IP.Interface', () => {
    const conns = listWanCandidates(tr181Device()).map((c) => c.conn);
    expect(conns).not.toContain('Device.IP.Interface.1');
    expect(conns).toEqual([
      'Device.IP.Interface.3',
      'Device.IP.Interface.4',
      'Device.IP.Interface.5',
    ]);
  });

  it('resuelve la VLAN siguiendo LowerLayers hasta la VLANTermination', () => {
    const byConn = new Map(
      listWanCandidates(tr181Device()).map((c) => [c.conn, c.vlanId]),
    );
    expect(byConn.get('Device.IP.Interface.5')).toBe(702);
    expect(byConn.get('Device.IP.Interface.3')).toBe(351);
  });
});

describe('elegir la WAN de servicio', () => {
  it('prefiere la que ya lleva la IP esperada sobre la heredada', () => {
    const found = findServiceWanConnection(tr181Device(), {
      mgmtIp: '30.30.20.62',
      expectedIp: '40.40.21.10',
    });
    expect(found?.conn).toBe('Device.IP.Interface.5');
    expect(found?.isMgmt).toBe(false);
    expect(found?.model).toBe('tr181');
  });

  it('sin IP todavía se guía por la VLAN esperada', () => {
    const found = findServiceWanConnection(tr181Device(), {
      mgmtIp: '30.30.20.62',
      expectedVlanId: 702,
    });
    expect(found?.conn).toBe('Device.IP.Interface.5');
  });

  it('no confunde la de servicio con la de gestión aunque anuncie TR069', () => {
    const found = findServiceWanConnection(tr181Device(), {
      mgmtIp: '30.30.20.62',
      expectedIp: '40.40.21.10',
    });
    expect(found?.conn).not.toBe('Device.IP.Interface.4');
  });

  it('sigue funcionando en TR-098', () => {
    const found = findServiceWanConnection(tr098Device(), {
      mgmtIp: '30.30.20.54',
      expectedIp: '40.40.21.3',
    });
    expect(found?.model).toBe('tr098');
    expect(found?.conn).toBe(
      'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1',
    );
  });
});

describe('leer el estado de la WAN', () => {
  it('junta IP, VLAN, NAT y DNS repartidos del TR-181', () => {
    const device = tr181Device();
    const ref = findServiceWanConnection(device, {
      expectedIp: '40.40.21.10',
    })!;
    const state = readWanConnectionState(device, ref);
    expect(state).toMatchObject({
      ip: '40.40.21.10',
      mask: '255.255.255.0',
      gateway: '40.40.21.1',
      dns: '8.8.8.8,8.8.4.4',
      nat: true,
      vlan: 702,
      addressingType: 'Static',
      connectionStatus: 'Connected',
      bytesRecv: 6672,
      bytesSent: 0,
    });
  });

  it('lee las hojas juntas del TR-098', () => {
    const device = tr098Device();
    const ref = findServiceWanConnection(device, {
      mgmtIp: '30.30.20.54',
    })!;
    const state = readWanConnectionState(device, ref);
    expect(state).toMatchObject({
      ip: '40.40.21.3',
      gateway: '40.40.21.1',
      dns: '8.8.8.8,8.8.4.4',
      nat: true,
      vlan: 702,
      connectionStatus: 'Connected',
      bytesSent: 241242,
    });
  });

  it('distingue NAT apagado de NAT no publicado', () => {
    const device = tr181Device();
    delete (
      (device.Device as Record<string, unknown>).NAT as Record<string, unknown>
    ).InterfaceSetting;
    const ref = findServiceWanConnection(device, {
      expectedIp: '40.40.21.10',
    })!;
    expect(readWanConnectionState(device, ref).nat).toBeNull();
  });
});

describe('rutas de escritura', () => {
  it('apunta a las hojas vendor de la ZTE', () => {
    const device = tr181Device();
    const ref = findServiceWanConnection(device, {
      expectedIp: '40.40.21.10',
    })!;
    expect(resolveWanWriteTargets(device, ref)).toMatchObject({
      ip: 'Device.IP.Interface.5.IPv4Address.1.IPAddress',
      mask: 'Device.IP.Interface.5.IPv4Address.1.SubnetMask',
      gateway: 'Device.IP.Interface.5.IPv4Address.1.X_ZTE-COM_Gateway',
      natEnable: 'Device.NAT.InterfaceSetting.3.Enable',
      vlan: 'Device.Ethernet.VLANTermination.3.VLANID',
      dnsJoined: false,
      // En TR-181 el modo estático se deduce de la dirección escrita a mano.
      connectionType: null,
      addressingType: null,
    });
  });

  it('mantiene las hojas TR-098 donde estaban', () => {
    const device = tr098Device();
    const ref = findServiceWanConnection(device, { mgmtIp: '30.30.20.54' })!;
    const conn =
      'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1';
    expect(resolveWanWriteTargets(device, ref)).toMatchObject({
      ip: `${conn}.ExternalIPAddress`,
      mask: `${conn}.SubnetMask`,
      gateway: `${conn}.DefaultGateway`,
      natEnable: `${conn}.NATEnabled`,
      vlan: `${conn}.VLANID`,
      dnsJoined: true,
      connectionType: `${conn}.ConnectionType`,
    });
  });

  it('reparte el DNS en una hoja por servidor cuando el modelo lo exige', () => {
    const device = tr181Device();
    const ref = findServiceWanConnection(device, {
      expectedIp: '40.40.21.10',
    })!;
    const targets = resolveWanWriteTargets(device, ref);
    expect(buildWanDnsParams(targets, ['8.8.8.8', '1.1.1.1'])).toEqual([
      ['Device.DNS.Client.Server.5.DNSServer', '8.8.8.8', 'xsd:string'],
      ['Device.DNS.Client.Server.6.DNSServer', '1.1.1.1', 'xsd:string'],
    ]);
  });

  it('en TR-098 manda los dos servidores en una sola hoja', () => {
    const device = tr098Device();
    const ref = findServiceWanConnection(device, { mgmtIp: '30.30.20.54' })!;
    const targets = resolveWanWriteTargets(device, ref);
    expect(buildWanDnsParams(targets, ['8.8.8.8', '1.1.1.1'])).toEqual([
      [
        'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1.DNSServers',
        '8.8.8.8,1.1.1.1',
        'xsd:string',
      ],
    ]);
  });
});
