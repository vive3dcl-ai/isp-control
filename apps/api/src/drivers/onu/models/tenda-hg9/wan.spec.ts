import {
  buildTendaDisableJunkParams,
  buildTendaServiceWanParams,
  findTendaJunkInternetWans,
  findTendaServiceWan,
  isTendaServiceWanApplied,
  listTendaWanIpConnections,
  resolveTendaLibraryServiceWan,
} from './wan';
import { matchesTendaHg9 } from './match';
import type { OnuModelProvisionWanPlan } from '../../types';

function leaf(value: unknown) {
  return { _value: value };
}

/** Árbol ACS realista (TDTC353E9A98 post-provision). */
function tendaDevice(opts?: {
  wcd1Enable?: boolean;
  wcd3Ip?: string;
  wcd3Vlan?: number;
}) {
  const wcd1Enable = opts?.wcd1Enable ?? false;
  const wcd3Ip = opts?.wcd3Ip ?? '40.40.22.66';
  const wcd3Vlan = opts?.wcd3Vlan ?? 703;
  return {
    InternetGatewayDevice: {
      DeviceInfo: {
        Manufacturer: leaf('Tenda'),
        ModelName: leaf('HG9'),
        ProductClass: leaf('HG9'),
      },
      WANDevice: {
        1: {
          WANConnectionDevice: {
            1: {
              X_TDTC_VLAN: leaf(350),
              X_TDTC_VLANEnabled: leaf(true),
              WANIPConnection: {
                1: {
                  Name: leaf('nas0_0'),
                  Enable: leaf(wcd1Enable),
                  ConnectionStatus: leaf('Disconnected'),
                  ServiceType: leaf('INTERNET'),
                  X_TDTC_ServiceList: leaf(wcd1Enable ? 'INTERNET' : ''),
                  ExternalIPAddress: leaf('40.40.22.66'),
                  DefaultGateway: leaf('40.40.22.1'),
                  NATEnabled: leaf(wcd1Enable),
                  X_TDTC_LanInterfaceBind: leaf(
                    wcd1Enable
                      ? 'WLAN0-AP1,WLAN0-AP2,WLAN0-AP3,WLAN0-AP4'
                      : '',
                  ),
                },
              },
            },
            3: {
              X_TDTC_VLAN: leaf(wcd3Vlan),
              X_TDTC_VLANEnabled: leaf(true),
              WANIPConnection: {
                1: {
                  Name: leaf('ISPCTRL_INTERNET_703'),
                  Enable: leaf(true),
                  ConnectionStatus: leaf('Connected'),
                  ServiceType: leaf('None'),
                  X_TDTC_ServiceList: leaf(''),
                  ExternalIPAddress: leaf(wcd3Ip),
                  DefaultGateway: leaf('40.40.22.1'),
                  SubnetMask: leaf('255.255.255.0'),
                  DNSServers: leaf('8.8.8.8,8.8.4.4'),
                  NATEnabled: leaf(true),
                  X_TDTC_LanInterfaceBind: leaf(
                    'WLAN0-AP1,WLAN0-AP2,WLAN0-AP3,WLAN0-AP4,WLAN1-AP1,WLAN1-AP2,WLAN1-AP3,WLAN1-AP4',
                  ),
                },
              },
            },
            4: {
              X_TDTC_VLAN: leaf(401),
              X_TDTC_VLANEnabled: leaf(true),
              WANIPConnection: {
                1: {
                  Name: leaf(''),
                  Enable: leaf(true),
                  ConnectionStatus: leaf('Connected'),
                  ServiceType: leaf('TR069'),
                  X_TDTC_ServiceList: leaf('TR069'),
                  ExternalIPAddress: leaf('30.30.20.186'),
                  NATEnabled: leaf(false),
                },
              },
            },
          },
        },
      },
    },
  };
}

const wan: OnuModelProvisionWanPlan = {
  wanIp: '40.40.22.66',
  wanVlan: 703,
  wanGateway: '40.40.22.1',
  wanMask: '255.255.255.0',
  wanDns1: '8.8.8.8',
  wanDns2: '8.8.4.4',
};

describe('tenda-hg9 match', () => {
  it('matchea TDTC + HG9', () => {
    expect(
      matchesTendaHg9({ sn: 'TDTC353E9A98', onuType: 'HG9', acsModel: 'HG9' }),
    ).toBe(true);
  });

  it('matchea TDTC sin modelo aún', () => {
    expect(matchesTendaHg9({ sn: 'TDTC353E9A98' })).toBe(true);
  });

  it('no matchea Huawei/ZTE', () => {
    expect(
      matchesTendaHg9({ sn: 'HWTC42DF94B8', onuType: 'HG9' }),
    ).toBe(false);
    expect(matchesTendaHg9({ sn: 'ZTEG12345678', onuType: 'HG9' })).toBe(
      false,
    );
  });
});

describe('tenda-hg9 wan selection', () => {
  it('elige WCD.3 por X_TDTC_VLAN=703 (no INTERNET fábrica vlan 350)', () => {
    const device = tendaDevice({ wcd1Enable: true });
    const conns = listTendaWanIpConnections(device);
    const picked = findTendaServiceWan(conns, {
      expectedVlan: 703,
      expectedIp: '40.40.22.66',
    });
    expect(picked?.cd).toBe(3);
    expect(picked?.vlan).toBe(703);

    const ref = resolveTendaLibraryServiceWan(device, {
      expectedVlanId: 703,
      expectedIp: '40.40.22.66',
    });
    expect(ref?.isMgmt).toBe(false);
    expect(ref?.conn).toContain('WANConnectionDevice.3');
  });

  it('detecta INTERNET fábrica como junk', () => {
    const conns = listTendaWanIpConnections(
      tendaDevice({ wcd1Enable: true }),
    );
    const junk = findTendaJunkInternetWans(conns, 703);
    expect(junk).toHaveLength(1);
    expect(junk[0].cd).toBe(1);
    const params = buildTendaDisableJunkParams(junk[0]);
    expect(params.some((p) => p[0].endsWith('.Enable') && p[1] === false)).toBe(
      true,
    );
    expect(params.some((p) => p[0].endsWith('.ServiceType'))).toBe(false);
  });

  it('isApplied cuando vlan+IP+NAT en WCD servicio', () => {
    expect(isTendaServiceWanApplied(tendaDevice(), wan)).toBe(true);
    expect(
      isTendaServiceWanApplied(
        tendaDevice({ wcd3Ip: '30.30.20.186' }),
        wan,
      ),
    ).toBe(false);
  });

  it('SPV no escribe ServiceType ni X_TDTC_ServiceList=INTERNET', () => {
    const conns = listTendaWanIpConnections(tendaDevice());
    const target = findTendaServiceWan(conns, { expectedVlan: 703 })!;
    const params = buildTendaServiceWanParams(target, wan);
    const paths = params.map((p) => p[0]);
    expect(paths.some((p) => p.endsWith('.ServiceType'))).toBe(false);
    expect(
      paths.some((p) => p.endsWith('.X_TDTC_ServiceList')),
    ).toBe(false);
    expect(
      params.some(
        (p) =>
          p[0].endsWith('.ExternalIPAddress') && p[1] === '40.40.22.66',
      ),
    ).toBe(true);
    // VLAN ya correcta → no reescribe X_TDTC_VLAN
    expect(paths.some((p) => p.endsWith('.X_TDTC_VLAN'))).toBe(false);
    // Siempre empuja bind LAN+WiFi
    expect(paths.some((p) => p.endsWith('.X_TDTC_LanInterfaceBind'))).toBe(
      true,
    );
  });

  it('SPV escribe X_TDTC_VLAN solo si falta', () => {
    const device = tendaDevice({ wcd3Vlan: 703 });
    // fuerza vlan null en resumen via árbol sin hoja
    const conns = listTendaWanIpConnections(device);
    const target = { ...conns.find((c) => c.cd === 3)!, vlan: null };
    const params = buildTendaServiceWanParams(target, wan);
    expect(
      params.some(
        (p) => p[0].endsWith('.X_TDTC_VLAN') && p[1] === 703,
      ),
    ).toBe(true);
  });
});
