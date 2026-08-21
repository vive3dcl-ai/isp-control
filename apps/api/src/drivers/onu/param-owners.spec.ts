import {
  ACS_HGU_PARAM_OWNERS,
  OMCI_BRIDGE_PARAM_OWNERS,
  isHguRateLeaf,
  resolveParamOwners,
} from './param-owners';
import { resolveOmciPlan, resolveOnuDriver } from './index';

describe('resolveParamOwners', () => {
  it('HG8145 / HG9: WAN y VLAN ACS, T-CONT OLT', () => {
    const hg = resolveOnuDriver({
      sn: 'HWTC68610FAE',
      onuType: 'HG8145X6',
    });
    expect(resolveOmciPlan(hg).serviceWanOmci).toBe('skip');
    expect(resolveParamOwners(hg)).toMatchObject({
      serviceWan: 'acs',
      serviceVlan: 'acs',
      tcont: 'olt_dba',
      mgmtIp: 'omci',
    });

    const hg9 = resolveOnuDriver({ sn: 'TDTC353E9A98', onuType: 'HG9' });
    expect(resolveParamOwners(hg9).serviceWan).toBe('acs');
  });

  it('generic-huawei omite WAN OMCI (HGU ACS-first)', () => {
    const d = resolveOnuDriver({ sn: 'HWTC00001111', onuType: 'HG8240H' });
    expect(d?.id).toBe('generic-huawei');
    expect(resolveOmciPlan(d).serviceWanOmci).toBe('skip');
    expect(resolveParamOwners(d)).toEqual(ACS_HGU_PARAM_OWNERS);
  });

  it('generic-fiberhome omite WAN OMCI', () => {
    const d = resolveOnuDriver({ sn: 'FHTT00001111', onuType: 'HG6243C' });
    expect(d?.id).toBe('generic-fiberhome');
    expect(resolveOmciPlan(d).serviceWanOmci).toBe('skip');
  });

  it('generic-zte: VLAN OMCI, ACS no es dueño de VLAN', () => {
    const d = resolveOnuDriver({ sn: 'ZTEGD71F2028', onuType: 'F6600P' });
    expect(d?.id).toBe('generic-zte');
    expect(resolveOmciPlan(d).serviceWanOmci).toBe('apply');
    expect(resolveParamOwners(d)).toMatchObject({
      serviceWan: 'omci',
      serviceVlan: 'omci',
      tcont: 'olt_dba',
    });
    expect(resolveParamOwners(d)).toEqual(OMCI_BRIDGE_PARAM_OWNERS);
  });
});

describe('isHguRateLeaf', () => {
  it('detecta hojas de rate y deja pasar IP/VLAN', () => {
    expect(isHguRateLeaf('InternetGatewayDevice.WANDevice.1.WANIPConnection.1.MaxBitRate')).toBe(
      true,
    );
    expect(isHguRateLeaf('Device.IP.Interface.1.X_HW_DownRate')).toBe(true);
    expect(
      isHguRateLeaf(
        'InternetGatewayDevice.WANDevice.1.WANIPConnection.1.ExternalIPAddress',
      ),
    ).toBe(false);
    expect(
      isHguRateLeaf(
        'InternetGatewayDevice.WANDevice.1.WANIPConnection.1.X_HW_VLAN',
      ),
    ).toBe(false);
  });
});
