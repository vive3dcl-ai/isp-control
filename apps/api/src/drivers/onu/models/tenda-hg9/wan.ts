/**
 * WAN helpers Tenda HG9 (vendor TDTC / OUI C83A35).
 *
 * Validado en TDTC353E9A98:
 *  - VLAN en WCD: `X_TDTC_VLAN` / `X_TDTC_VLANEnabled` (no en WANIP)
 *  - Servicio: IP/gw/NAT/bind; NO escribir ServiceType ni X_TDTC_ServiceList
 *    (9007 / session_terminated si hay otro INTERNET de fábrica)
 *  - WCD fábrica con INTERNET+VLAN≠servicio: Enable=false (VLAN no se puede cambiar)
 *  - Bind observado: WLAN0-AP1…WLAN1-AP4
 */
import {
  genieChildIndices,
  genieGet,
  strVal,
} from '../../../../topology/shared/genieacs-nbi.client';
import type { OnuModelProvisionWanPlan } from '../../types';
import type { WanConnectionRef } from '../../infra/wan-datamodel';
import {
  assessServiceLanBind,
  TENDA_HG9_DEFAULT_LAN_BIND,
} from '../../infra/lan-bind';

export { TENDA_HG9_DEFAULT_LAN_BIND };

const WAN_DEV = 'InternetGatewayDevice.WANDevice';

export type TendaWanConnSummary = {
  cd: number;
  ip: number;
  conn: string;
  connDevice: string;
  name: string | null;
  enable: boolean | null;
  status: string | null;
  serviceType: string | null;
  serviceList: string | null;
  vlan: number | null;
  vlanEnabled: boolean | null;
  externalIp: string | null;
  gateway: string | null;
  nat: boolean | null;
  dnsServers: string | null;
  lanBind: string | null;
};

function boolVal(raw: string | null): boolean | null {
  if (raw == null || raw === '') return null;
  if (raw === '1' || /^true$/i.test(raw)) return true;
  if (raw === '0' || /^false$/i.test(raw)) return false;
  return null;
}

export function listTendaWanIpConnections(
  device: Record<string, unknown>,
): TendaWanConnSummary[] {
  const out: TendaWanConnSummary[] = [];
  for (const wd of genieChildIndices(device, WAN_DEV)) {
    const cdBase = `${WAN_DEV}.${wd}.WANConnectionDevice`;
    for (const cd of genieChildIndices(device, cdBase)) {
      const connDevice = `${cdBase}.${cd}`;
      const ipBase = `${connDevice}.WANIPConnection`;
      for (const ip of genieChildIndices(device, ipBase)) {
        const conn = `${ipBase}.${ip}`;
        const vlanRaw = strVal(genieGet(device, `${connDevice}.X_TDTC_VLAN`));
        const vlan =
          vlanRaw != null && vlanRaw !== '' ? Number(vlanRaw) : null;
        out.push({
          cd,
          ip,
          conn,
          connDevice,
          name: strVal(genieGet(device, `${conn}.Name`)),
          enable: boolVal(strVal(genieGet(device, `${conn}.Enable`))),
          status: strVal(genieGet(device, `${conn}.ConnectionStatus`)),
          serviceType: strVal(genieGet(device, `${conn}.ServiceType`)),
          serviceList: strVal(
            genieGet(device, `${conn}.X_TDTC_ServiceList`),
          ),
          vlan: Number.isFinite(vlan) ? vlan : null,
          vlanEnabled: boolVal(
            strVal(genieGet(device, `${connDevice}.X_TDTC_VLANEnabled`)),
          ),
          externalIp: strVal(genieGet(device, `${conn}.ExternalIPAddress`)),
          gateway: strVal(genieGet(device, `${conn}.DefaultGateway`)),
          nat: boolVal(strVal(genieGet(device, `${conn}.NATEnabled`))),
          dnsServers: strVal(genieGet(device, `${conn}.DNSServers`)),
          lanBind: strVal(
            genieGet(device, `${conn}.X_TDTC_LanInterfaceBind`),
          ),
        });
      }
    }
  }
  return out;
}

export function isTendaTr069Wan(c: TendaWanConnSummary): boolean {
  return (
    /TR069/i.test(c.serviceType ?? '') ||
    /TR069/i.test(c.serviceList ?? '') ||
    /TR069/i.test(c.name ?? '')
  );
}

export function isTendaInternetLabel(c: TendaWanConnSummary): boolean {
  return (
    /INTERNET/i.test(c.serviceType ?? '') ||
    /INTERNET/i.test(c.serviceList ?? '') ||
    /^ISPCTRL_INTERNET_/i.test(c.name ?? '')
  );
}

/**
 * Elige la WAN de servicio: preferir WCD con `X_TDTC_VLAN` = vlan esperada
 * (no TR069). No usar el INTERNET de fábrica en VLAN distinta.
 */
export function findTendaServiceWan(
  conns: TendaWanConnSummary[],
  opts?: { expectedVlan?: number | null; expectedIp?: string | null },
): TendaWanConnSummary | null {
  const vlan = opts?.expectedVlan ?? null;
  const ip = opts?.expectedIp?.trim() || null;
  const candidates = conns.filter((c) => !isTendaTr069Wan(c));
  if (!candidates.length) return null;

  if (vlan != null) {
    const byVlan = candidates.filter((c) => c.vlan === vlan);
    if (byVlan.length) {
      if (ip) {
        const hit = byVlan.find((c) => c.externalIp === ip);
        if (hit) return hit;
      }
      const named = byVlan.find((c) => /^ISPCTRL_INTERNET_/i.test(c.name ?? ''));
      if (named) return named;
      const enabled = byVlan.find((c) => c.enable !== false);
      return enabled ?? byVlan[0];
    }
  }

  if (ip) {
    const byIp = candidates.find((c) => c.externalIp === ip && c.vlan != null);
    if (byIp) return byIp;
  }

  // No caer en INTERNET fábrica con VLAN incorrecta.
  const internetWrongVlan = candidates.filter(
    (c) =>
      isTendaInternetLabel(c) &&
      vlan != null &&
      c.vlan != null &&
      c.vlan !== vlan,
  );
  const safe = candidates.filter((c) => !internetWrongVlan.includes(c));
  return (
    safe.find((c) => c.vlan != null && c.enable !== false) ??
    safe[0] ??
    null
  );
}

export function resolveTendaLibraryServiceWan(
  device: Record<string, unknown>,
  opts?: { expectedIp?: string | null; expectedVlanId?: number | null },
): WanConnectionRef | null {
  const conns = listTendaWanIpConnections(device);
  const service = findTendaServiceWan(conns, {
    expectedVlan: opts?.expectedVlanId ?? null,
    expectedIp: opts?.expectedIp ?? null,
  });
  if (service) {
    return {
      model: 'tr098',
      conn: service.conn,
      connDevice: service.connDevice,
      isMgmt: false,
    };
  }
  const mgmt = conns.find((c) => isTendaTr069Wan(c));
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

export function expectedTendaDns(wan: OnuModelProvisionWanPlan): string {
  return [wan.wanDns1, wan.wanDns2]
    .filter((v): v is string => !!v?.trim())
    .join(',');
}

export function isTendaServiceWanApplied(
  device: Record<string, unknown>,
  wan: OnuModelProvisionWanPlan,
): boolean {
  const target = findTendaServiceWan(listTendaWanIpConnections(device), {
    expectedVlan: wan.wanVlan,
    expectedIp: wan.wanIp,
  });
  if (!target) return false;
  if (target.vlan !== wan.wanVlan) return false;
  if (target.externalIp !== wan.wanIp) return false;
  if (target.enable === false) return false;
  if (target.nat === false) return false;
  if (target.gateway && target.gateway !== wan.wanGateway) return false;
  const wantDns = expectedTendaDns(wan);
  if (wantDns && (target.dnsServers ?? '').trim() !== wantDns) return false;
  return assessServiceLanBind(device, target.conn).ok;
}

/**
 * INTERNET fábrica en VLAN ≠ servicio: apagar sin tocar ServiceType
 * (ServiceType=None|OTHER → 9007; VLAN rewrite → 9007).
 */
export function findTendaJunkInternetWans(
  conns: TendaWanConnSummary[],
  serviceVlan: number,
): TendaWanConnSummary[] {
  return conns.filter(
    (c) =>
      !isTendaTr069Wan(c) &&
      isTendaInternetLabel(c) &&
      c.vlan != null &&
      c.vlan !== serviceVlan &&
      c.enable !== false,
  );
}

export function buildTendaDisableJunkParams(
  junk: TendaWanConnSummary,
): Array<[string, string | number | boolean, string]> {
  return [
    [`${junk.conn}.Enable`, false, 'xsd:boolean'],
    [`${junk.conn}.NATEnabled`, false, 'xsd:boolean'],
    [`${junk.conn}.X_TDTC_ServiceList`, '', 'xsd:string'],
    [`${junk.conn}.X_TDTC_LanInterfaceBind`, '', 'xsd:string'],
  ];
}

/**
 * SPV de servicio. No incluye ServiceType / X_TDTC_ServiceList=INTERNET
 * (tumban la sesión CWMP si otro WCD aún carga INTERNET).
 *
 * Solo escribe X_TDTC_VLAN si la WCD aún no tiene la vlan de servicio
 * (WCD fábrica con otra VLAN no se puede reescribir → 9007).
 */
export function buildTendaServiceWanParams(
  target: TendaWanConnSummary,
  wan: OnuModelProvisionWanPlan,
): Array<[string, string | number | boolean, string]> {
  const dns = expectedTendaDns(wan);
  const { conn, connDevice } = target;
  const params: Array<[string, string | number | boolean, string]> = [];

  if (target.vlan !== wan.wanVlan) {
    params.push(
      [`${connDevice}.X_TDTC_VLAN`, wan.wanVlan, 'xsd:unsignedInt'],
      [`${connDevice}.X_TDTC_VLANEnabled`, true, 'xsd:boolean'],
    );
  } else if (target.vlanEnabled === false) {
    params.push([
      `${connDevice}.X_TDTC_VLANEnabled`,
      true,
      'xsd:boolean',
    ]);
  }

  params.push(
    [`${conn}.Enable`, true, 'xsd:boolean'],
    [`${conn}.ConnectionType`, 'IP_Routed', 'xsd:string'],
    [`${conn}.AddressingType`, 'Static', 'xsd:string'],
    [`${conn}.ExternalIPAddress`, wan.wanIp, 'xsd:string'],
    [`${conn}.SubnetMask`, wan.wanMask, 'xsd:string'],
    [`${conn}.DefaultGateway`, wan.wanGateway, 'xsd:string'],
    [`${conn}.NATEnabled`, true, 'xsd:boolean'],
    [
      `${conn}.Name`,
      `ISPCTRL_INTERNET_${wan.wanVlan}`,
      'xsd:string',
    ],
  );
  if (dns) {
    params.push([`${conn}.DNSServers`, dns, 'xsd:string']);
  }
  // Siempre empujar bind completo (factory/Wi‑Fi-only deja LAN sin Internet).
  params.push([
    `${conn}.X_TDTC_LanInterfaceBind`,
    TENDA_HG9_DEFAULT_LAN_BIND,
    'xsd:string',
  ]);
  return params;
}
