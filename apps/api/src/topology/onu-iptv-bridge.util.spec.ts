import {
  addLanPort,
  boundEthPortsFromWan,
  iptvBridgeName,
  isIptvBridgeWan,
  isProtectedWan,
  joinLanInterfaceList,
  parseLanInterfaceList,
  removeLanPort,
  type FhWanConn,
} from './onu-iptv-bridge.util';

describe('onu-iptv-bridge.util', () => {
  const internet: FhWanConn = {
    path: 'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1',
    cdIndex: 1,
    ipIndex: 1,
    name: '1_INTERNET_R_VID_500',
    type: 'IP_Routed',
    vlanId: 701,
    serviceList: 'INTERNET',
    lanInterface:
      'InternetGatewayDevice.LANDevice.1.LANEthernetInterfaceConfig.1,InternetGatewayDevice.LANDevice.1.LANEthernetInterfaceConfig.4',
    addressingType: 'Static',
    externalIp: '40.40.20.1',
  };

  const bridge: FhWanConn = {
    path: 'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.3.WANIPConnection.1',
    cdIndex: 3,
    ipIndex: 1,
    name: iptvBridgeName(801),
    type: 'IP_Bridged',
    vlanId: 801,
    serviceList: 'OTHER',
    lanInterface: 'InternetGatewayDevice.LANDevice.1.LANEthernetInterfaceConfig.4',
    addressingType: '',
    externalIp: '',
  };

  it('protects internet/tr069 and recognizes iptv bridge', () => {
    expect(isProtectedWan(internet)).toBe(true);
    expect(isIptvBridgeWan(internet)).toBe(false);
    expect(isProtectedWan(bridge)).toBe(false);
    expect(isIptvBridgeWan(bridge)).toBe(true);
  });

  it('moves eth port between lan lists without dupes', () => {
    const without4 = removeLanPort(
      parseLanInterfaceList(internet.lanInterface),
      4,
    );
    expect(without4.join(',')).not.toContain('LANEthernetInterfaceConfig.4');
    const with4 = addLanPort(without4, 4);
    expect(joinLanInterfaceList(with4)).toContain(
      'LANEthernetInterfaceConfig.4',
    );
    expect(boundEthPortsFromWan(bridge)).toEqual([4]);
  });
});
