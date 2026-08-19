/**
 * Helpers WAN locales del modelo HG/EG8145X6 (copia; no depende de hgu-veip).
 */
import {
  genieChildIndices,
  genieGet,
  strVal,
} from '../../../../topology/shared/genieacs-nbi.client';
import type { OnuModelProvisionWanPlan } from '../../types';
import type { WanConnectionRef } from '../../infra/wan-datamodel';

const WAN_DEV = 'InternetGatewayDevice.WANDevice';

export type HuaweiWanConnSummary = {
  cd: number;
  ip: number;
  conn: string;
  connDevice: string;
  name: string | null;
  serviceList: string | null;
  vlan: number | null;
  externalIp: string | null;
  status: string | null;
  dnsServers: string | null;
};

export function listHuaweiWanIpConnections(
  device: Record<string, unknown>,
): HuaweiWanConnSummary[] {
  const out: HuaweiWanConnSummary[] = [];
  for (const wd of genieChildIndices(device, WAN_DEV)) {
    const cdBase = `${WAN_DEV}.${wd}.WANConnectionDevice`;
    for (const cd of genieChildIndices(device, cdBase)) {
      const connDevice = `${cdBase}.${cd}`;
      const ipBase = `${connDevice}.WANIPConnection`;
      for (const ip of genieChildIndices(device, ipBase)) {
        const conn = `${ipBase}.${ip}`;
        const vlanRaw = strVal(genieGet(device, `${conn}.X_HW_VLAN`));
        const vlan = vlanRaw != null && vlanRaw !== '' ? Number(vlanRaw) : null;
        out.push({
          cd,
          ip,
          conn,
          connDevice,
          name: strVal(genieGet(device, `${conn}.Name`)),
          serviceList: strVal(genieGet(device, `${conn}.X_HW_SERVICELIST`)),
          vlan: Number.isFinite(vlan) ? vlan : null,
          externalIp: strVal(genieGet(device, `${conn}.ExternalIPAddress`)),
          status: strVal(genieGet(device, `${conn}.ConnectionStatus`)),
          dnsServers: strVal(genieGet(device, `${conn}.DNSServers`)),
        });
      }
    }
  }
  return out;
}

export function findHuaweiInternetWan(
  conns: HuaweiWanConnSummary[],
): HuaweiWanConnSummary | null {
  return conns.find((c) => /INTERNET/i.test(c.serviceList ?? '')) ?? null;
}

export function resolveHuaweiLibraryServiceWan(
  device: Record<string, unknown>,
): WanConnectionRef | null {
  const conns = listHuaweiWanIpConnections(device);
  const internet = findHuaweiInternetWan(conns);
  if (internet) {
    return {
      model: 'tr098',
      conn: internet.conn,
      connDevice: internet.connDevice,
      isMgmt: false,
    };
  }
  const mgmt = conns.find((c) =>
    /TR069|VOIP|MGMT/i.test(c.serviceList ?? ''),
  );
  if (mgmt) {
    return {
      model: 'tr098',
      conn: mgmt.conn,
      connDevice: mgmt.connDevice,
      isMgmt: true,
    };
  }
  return null;
}

export function expectedHuaweiDns(wan: OnuModelProvisionWanPlan): string {
  return [wan.wanDns1, wan.wanDns2]
    .filter((v): v is string => !!v?.trim())
    .join(',');
}

export function isServiceWanApplied(
  device: Record<string, unknown>,
  wan: OnuModelProvisionWanPlan,
): boolean {
  const target = findHuaweiInternetWan(listHuaweiWanIpConnections(device));
  if (!target) return false;
  if (target.vlan !== wan.wanVlan || target.externalIp !== wan.wanIp) {
    return false;
  }
  const want = expectedHuaweiDns(wan);
  if (want && (target.dnsServers ?? '').trim() !== want) return false;

  for (const n of [1, 2, 3, 4]) {
    const lan = strVal(
      genieGet(device, `${target.conn}.X_HW_LANBIND.Lan${n}Enable`),
    );
    if (lan === '0') return false;
  }
  for (const n of [1, 2, 3, 4]) {
    const ssid = strVal(
      genieGet(device, `${target.conn}.X_HW_LANBIND.SSID${n}Enable`),
    );
    if (ssid === '0') return false;
  }
  return true;
}

export function findReusableBlankHuaweiWan(
  conns: HuaweiWanConnSummary[],
): HuaweiWanConnSummary | null {
  return (
    conns.find((c) => {
      const svc = (c.serviceList ?? '').trim();
      if (/TR069|VOIP|MGMT|INTERNET|IPTV|OTHER/i.test(svc)) return false;
      const ip = (c.externalIp ?? '').trim();
      return !svc && (!ip || ip === '0.0.0.0');
    }) ?? null
  );
}

export function needsNewWanConnectionDevice(
  conns: HuaweiWanConnSummary[],
): boolean {
  if (!conns.length) return true;
  if (findReusableBlankHuaweiWan(conns)) return false;
  return true;
}

export function buildHuaweiServiceWanParams(
  conn: string,
  wan: OnuModelProvisionWanPlan,
): Array<[string, string | number | boolean, string]> {
  const dns = [wan.wanDns1, wan.wanDns2]
    .filter((v): v is string => !!v?.trim())
    .join(',');
  const u = 'xsd:unsignedInt' as const;
  const ssidBinds: Array<[string, number, string]> = [1, 2, 3, 4, 5, 6, 7, 8].map(
    (n) => [`${conn}.X_HW_LANBIND.SSID${n}Enable`, 1, u],
  );
  return [
    [`${conn}.X_HW_SERVICELIST`, 'INTERNET', 'xsd:string'],
    [`${conn}.X_HW_VLAN`, wan.wanVlan, u],
    [`${conn}.Name`, `ISPCTRL_INTERNET_${wan.wanVlan}`, 'xsd:string'],
    [`${conn}.ConnectionType`, 'IP_Routed', 'xsd:string'],
    [`${conn}.AddressingType`, 'Static', 'xsd:string'],
    [`${conn}.ExternalIPAddress`, wan.wanIp, 'xsd:string'],
    [`${conn}.SubnetMask`, wan.wanMask, 'xsd:string'],
    [`${conn}.DefaultGateway`, wan.wanGateway, 'xsd:string'],
    [`${conn}.DNSEnabled`, true, 'xsd:boolean'],
    [`${conn}.DNSServers`, dns, 'xsd:string'],
    [`${conn}.NATEnabled`, true, 'xsd:boolean'],
    [`${conn}.X_HW_LANBIND.Lan1Enable`, 1, u],
    [`${conn}.X_HW_LANBIND.Lan2Enable`, 1, u],
    [`${conn}.X_HW_LANBIND.Lan3Enable`, 1, u],
    [`${conn}.X_HW_LANBIND.Lan4Enable`, 1, u],
    ...ssidBinds,
    [`${conn}.Enable`, true, 'xsd:boolean'],
  ];
}
