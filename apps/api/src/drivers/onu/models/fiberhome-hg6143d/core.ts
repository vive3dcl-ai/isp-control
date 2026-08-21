/**
 * FiberHome HG6143D / HG6244C / HG6145F (SN FHTT… / OUI 000AC2).
 *
 * Validado en FHTT964E6978 (HG6143D). En OLT ZTE el `onu_type` a veces llega
 * como `F600` (perfil OMCI), pero el ACS publica ProductClass real.
 *
 * Camino TR-098 FiberHome:
 *  - Servicio: X_FH_ServiceList=INTERNET
 *  - VLAN: WANConnectionDevice.X_FH_WANGponLinkConfig.VLANID (+ VLANIDMark)
 *  - LAN/Wi‑Fi bind: X_FH_LanInterface (eth1–4 + WLAN.1 + WLAN.5)
 *  - Gestión: X_FH_ServiceList=TR069 — nunca reescribirla
 *
 * OMCI `wan-ip` de ZTE no configura estas hojas → skipOmci + script propio.
 */
import {
  genieChildIndices,
  genieGet,
  strVal,
  type GenieAcsNbiClient,
} from '../../../../topology/shared/genieacs-nbi.client';
import { normalizeOnuModelName } from '../../../../topology/onus/onu-model-catalog';
import { vendorFromSn } from '../../infra/vendor-from-sn';
import type {
  OnuModelProvisionCtx,
  OnuModelProvisionMatchCtx,
  OnuModelProvisionResult,
  OnuModelProvisionWanPlan,
} from '../../types';
import type { WanConnectionRef } from '../../infra/wan-datamodel';
import {
  assessServiceLanBind,
  FH_HG6143D_DEFAULT_LAN_BIND,
  lanWifiStringBindOk,
} from '../../infra/lan-bind';

export { FH_HG6143D_DEFAULT_LAN_BIND };

const WAN_DEV = 'InternetGatewayDevice.WANDevice';

/**
 * HG6143D / HG6244C / HG6145F y revisiones (…-10, etc.).
 * HG6145F usa el mismo árbol X_FH_* que HG6143D; si cae en generic-fiberhome
 * (sin ownsWanSelection) el checker no cura WAN con connreq ajeno (RMS/Entel).
 */
const MODEL_RE = /^(HG6143D|HG6244C|HG6145F)/i;

export type FiberhomeWanConnSummary = {
  cd: number;
  ip: number;
  conn: string;
  connDevice: string;
  serviceList: string | null;
  vlan: number | null;
  externalIp: string | null;
  dnsServers: string | null;
  lanInterface: string | null;
};

export function isFiberhomeHg6143dModel(
  onuType?: string | null,
  acsModel?: string | null,
): boolean {
  return [onuType, acsModel]
    .map((raw) => (raw?.trim() ? normalizeOnuModelName(raw) : ''))
    .filter(Boolean)
    .some((m) => MODEL_RE.test(m));
}

export function matchesFiberhomeHg6143d(
  ctx: OnuModelProvisionMatchCtx,
): boolean {
  if (vendorFromSn(ctx.sn) !== 'fiberhome') return false;
  return isFiberhomeHg6143dModel(ctx.onuType, ctx.acsModel);
}

export function listFiberhomeWanIpConnections(
  device: Record<string, unknown>,
): FiberhomeWanConnSummary[] {
  const out: FiberhomeWanConnSummary[] = [];
  for (const wd of genieChildIndices(device, WAN_DEV)) {
    const cdBase = `${WAN_DEV}.${wd}.WANConnectionDevice`;
    for (const cd of genieChildIndices(device, cdBase)) {
      const connDevice = `${cdBase}.${cd}`;
      const ipBase = `${connDevice}.WANIPConnection`;
      for (const ip of genieChildIndices(device, ipBase)) {
        const conn = `${ipBase}.${ip}`;
        const vlanRaw =
          strVal(
            genieGet(device, `${connDevice}.X_FH_WANGponLinkConfig.VLANID`),
          ) ?? strVal(genieGet(device, `${conn}.VLANID`));
        const vlan =
          vlanRaw != null && vlanRaw !== '' ? Number(vlanRaw) : null;
        out.push({
          cd,
          ip,
          conn,
          connDevice,
          serviceList: strVal(genieGet(device, `${conn}.X_FH_ServiceList`)),
          vlan: Number.isFinite(vlan) ? vlan : null,
          externalIp: strVal(genieGet(device, `${conn}.ExternalIPAddress`)),
          dnsServers: strVal(genieGet(device, `${conn}.DNSServers`)),
          lanInterface: strVal(genieGet(device, `${conn}.X_FH_LanInterface`)),
        });
      }
    }
  }
  return out;
}

export function findFiberhomeInternetWan(
  conns: FiberhomeWanConnSummary[],
): FiberhomeWanConnSummary | null {
  return conns.find((c) => /INTERNET/i.test(c.serviceList ?? '')) ?? null;
}

/** Library FiberHome: WAN INTERNET por X_FH_ServiceList. */
export function resolveFiberhomeLibraryServiceWan(
  device: Record<string, unknown>,
): WanConnectionRef | null {
  const conns = listFiberhomeWanIpConnections(device);
  const internet = findFiberhomeInternetWan(conns);
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

export function expectedFiberhomeDns(wan: OnuModelProvisionWanPlan): string {
  return [wan.wanDns1, wan.wanDns2]
    .filter((v): v is string => !!v?.trim())
    .join(',');
}

export function isFiberhomeServiceWanApplied(
  device: Record<string, unknown>,
  wan: OnuModelProvisionWanPlan,
): boolean {
  const target = findFiberhomeInternetWan(listFiberhomeWanIpConnections(device));
  if (!target) return false;
  if (target.vlan !== wan.wanVlan || target.externalIp !== wan.wanIp) {
    return false;
  }
  const want = expectedFiberhomeDns(wan);
  if (want && (target.dnsServers ?? '').trim() !== want) return false;
  return assessServiceLanBind(device, target.conn).ok;
}

export function needsNewFiberhomeWanConnectionDevice(
  conns: FiberhomeWanConnSummary[],
): boolean {
  if (!conns.length) return true;
  if (conns.every((c) => /TR069|VOIP|MGMT/i.test(c.serviceList ?? ''))) {
    return true;
  }
  return false;
}

export function buildFiberhomeServiceWanParams(
  target: FiberhomeWanConnSummary,
  wan: OnuModelProvisionWanPlan,
): Array<[string, string | number | boolean, string]> {
  const dns = expectedFiberhomeDns(wan);
  const { conn, connDevice } = target;
  const params: Array<[string, string | number | boolean, string]> = [
    [`${conn}.X_FH_ServiceList`, 'INTERNET', 'xsd:string'],
    [`${conn}.ConnectionType`, 'IP_Routed', 'xsd:string'],
    [`${conn}.AddressingType`, 'Static', 'xsd:string'],
    [`${conn}.ExternalIPAddress`, wan.wanIp, 'xsd:string'],
    [`${conn}.SubnetMask`, wan.wanMask, 'xsd:string'],
    [`${conn}.DefaultGateway`, wan.wanGateway, 'xsd:string'],
    [`${conn}.DNSServers`, dns, 'xsd:string'],
    [`${conn}.DNSEnabled`, true, 'xsd:boolean'],
    [`${conn}.NATEnabled`, true, 'xsd:boolean'],
    [`${conn}.Enable`, true, 'xsd:boolean'],
    // Mode=2 = tagged service WAN (observado en HG6143D INTERNET).
    [`${connDevice}.X_FH_WANGponLinkConfig.Enable`, true, 'xsd:boolean'],
    [`${connDevice}.X_FH_WANGponLinkConfig.Mode`, 2, 'xsd:unsignedInt'],
    [
      `${connDevice}.X_FH_WANGponLinkConfig.VLANID`,
      wan.wanVlan,
      'xsd:unsignedInt',
    ],
    [
      `${connDevice}.X_FH_WANGponLinkConfig.VLANIDMark`,
      wan.wanVlan,
      'xsd:unsignedInt',
    ],
  ];
  // Boolean `true` lo escribió el genérico FiberHome y no liga LAN/Wi‑Fi.
  if (!lanWifiStringBindOk(target.lanInterface)) {
    params.push([
      `${conn}.X_FH_LanInterface`,
      FH_HG6143D_DEFAULT_LAN_BIND,
      'xsd:string',
    ]);
  }
  return params;
}

export function resolveNewFiberhomeWanConnection(
  before: FiberhomeWanConnSummary[],
  after: FiberhomeWanConnSummary[],
): FiberhomeWanConnSummary | null {
  const beforeKeys = new Set(before.map((c) => c.conn));
  const created = after.find((c) => !beforeKeys.has(c.conn));
  if (created) return created;
  return findFiberhomeInternetWan(after);
}

async function refreshWanTree(
  client: GenieAcsNbiClient,
  deviceId: string,
): Promise<void> {
  try {
    await client.refreshObject(deviceId, WAN_DEV);
  } catch {
    /* seguimos con lo que haya */
  }
}

async function createFiberhomeServiceWanConnection(
  ctx: OnuModelProvisionCtx,
  device: Record<string, unknown>,
  conns: FiberhomeWanConnSummary[],
  notes: string[],
): Promise<
  | { ok: true; device: Record<string, unknown>; notes: string[] }
  | { ok: false; notes: string[] }
> {
  const { client, deviceId } = ctx;
  let current = device;

  if (needsNewFiberhomeWanConnectionDevice(conns)) {
    const wcdBase = `${WAN_DEV}.1.WANConnectionDevice`;
    notes.push(`1/3 AddObject ${wcdBase} (nuevo WCD; TR069 ya ocupa otro)`);
    try {
      const add = await client.addObject(deviceId, wcdBase);
      notes.push(
        add.status === 200
          ? 'WANConnectionDevice creado'
          : `WANConnectionDevice encolado (status ${add.status})`,
      );
    } catch (e) {
      return {
        ok: false,
        notes: [
          ...notes,
          `AddObject WCD falló: ${e instanceof Error ? e.message : String(e)}`,
        ],
      };
    }
    await refreshWanTree(client, deviceId);
    current = (await client.findBySerial(ctx.sn)) ?? current;
    const after = listFiberhomeWanIpConnections(current);
    if (resolveNewFiberhomeWanConnection(conns, after)) {
      return { ok: true, device: current, notes };
    }
    notes.push('WCD sin WANIPConnection visible; AddObject bajo el WCD nuevo');
  }

  const connDevice = (() => {
    const after = listFiberhomeWanIpConnections(current);
    const beforeKeys = new Set(conns.map((c) => c.connDevice));
    const freshCd = after.find((c) => !beforeKeys.has(c.connDevice));
    if (freshCd) return freshCd.connDevice;
    const wcdBase = `${WAN_DEV}.1.WANConnectionDevice`;
    const cds = genieChildIndices(current, wcdBase);
    const known = new Set(conns.map((c) => c.cd));
    const newCd = cds.find((cd) => !known.has(cd));
    if (newCd != null) return `${wcdBase}.${newCd}`;
    if (after.length) return after[0].connDevice;
    if (conns.length) return conns[0].connDevice;
    return `${WAN_DEV}.1.WANConnectionDevice.1`;
  })();

  notes.push(`2/3 AddObject ${connDevice}.WANIPConnection`);
  try {
    const add = await client.addObject(
      deviceId,
      `${connDevice}.WANIPConnection`,
    );
    notes.push(
      add.status === 200
        ? 'WANIPConnection creada'
        : `WANIPConnection encolada (status ${add.status})`,
    );
  } catch (e) {
    return {
      ok: false,
      notes: [
        ...notes,
        `AddObject WANIPConnection falló: ${
          e instanceof Error ? e.message : String(e)
        }`,
      ],
    };
  }
  await refreshWanTree(client, deviceId);
  current = (await client.findBySerial(ctx.sn)) ?? current;
  return { ok: true, device: current, notes };
}

export async function ensureFiberhomeServiceWan(
  ctx: OnuModelProvisionCtx,
): Promise<OnuModelProvisionResult> {
  const notes: string[] = [];
  const { client, deviceId, wan } = ctx;
  let device = ctx.device;

  await refreshWanTree(client, deviceId);
  const fresh = await client.findBySerial(ctx.sn);
  if (fresh) device = fresh;

  let conns = listFiberhomeWanIpConnections(device);
  let target = findFiberhomeInternetWan(conns);
  const before = conns;

  if (!target) {
    const created = await createFiberhomeServiceWanConnection(
      ctx,
      device,
      conns,
      notes,
    );
    if (!created.ok) return { ok: false, notes: created.notes };
    device = created.device;
    conns = listFiberhomeWanIpConnections(device);
    target = resolveNewFiberhomeWanConnection(before, conns);
    if (!target) {
      return {
        ok: false,
        notes: [
          ...notes,
          'el CPE no creó la WAN de servicio (AddObject rechazado o aún sin Inform)',
        ],
      };
    }
  } else {
    notes.push(
      `WAN INTERNET existente (${target.conn.split('.').slice(-3).join('.')})`,
    );
  }

  const params = buildFiberhomeServiceWanParams(target, wan);
  const dns = expectedFiberhomeDns(wan);
  try {
    const spv = await client.setParameterValues(deviceId, params);
    notes.push(
      spv.status === 200
        ? `3/3 SPV INTERNET ${wan.wanIp} vlan=${wan.wanVlan} (X_FH_+NAT+LanInterface)`
        : `3/3 SPV INTERNET ${wan.wanIp} vlan=${wan.wanVlan} encolada (status ${spv.status})`,
    );
  } catch (e) {
    return {
      ok: false,
      notes: [
        ...notes,
        `SPV falló: ${e instanceof Error ? e.message : String(e)}`,
      ],
    };
  }

  if (dns) {
    try {
      const dnsSpv = await client.setParameterValues(deviceId, [
        [`${target.conn}.DNSServers`, dns, 'xsd:string'],
      ]);
      notes.push(
        dnsSpv.status === 200
          ? `DNS ${dns} (hoja sola)`
          : `DNS ${dns} encolado (status ${dnsSpv.status})`,
      );
    } catch (e) {
      notes.push(
        `DNS hoja sola falló: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  return { ok: true, notes };
}

export async function provisionFiberhomeHg6143d(
  ctx: OnuModelProvisionCtx,
): Promise<OnuModelProvisionResult> {
  const notes: string[] = [];

  if (isFiberhomeServiceWanApplied(ctx.device, ctx.wan)) {
    return {
      ok: true,
      notes: [`WAN INTERNET ya en vlan=${ctx.wan.wanVlan} ip=${ctx.wan.wanIp}`],
    };
  }

  const reachable = await ctx.isReachable();
  if (!reachable) {
    notes.push(await ctx.preloadConnReq());
    const rb = await ctx.reboot({ force: ctx.explicit });
    notes.push(rb.note);
  }

  const tmpl = await ensureFiberhomeServiceWan(ctx);
  return { ok: tmpl.ok, notes: [...notes, ...tmpl.notes] };
}
