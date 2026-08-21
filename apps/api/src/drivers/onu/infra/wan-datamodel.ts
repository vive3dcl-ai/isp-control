/**
 * La WAN del CPE en los dos modelos de datos TR-069.
 *
 * Las Huawei y FiberHome publican TR-098 (`InternetGatewayDevice`), donde una
 * WANIPConnection reúne IP, máscara, gateway, NAT, DNS y VLAN. Las ZTE F6600P
 * hablan TR-181 (`Device`) y reparten lo mismo en cuatro sitios: la IP en
 * `Device.IP.Interface.{i}`, la VLAN en `Device.Ethernet.VLANTermination.{k}`,
 * el NAT en `Device.NAT.InterfaceSetting.{k}` y el DNS en
 * `Device.DNS.Client.Server.{k}`, enlazados por `LowerLayers` e `Interface`.
 *
 * Sin esta traducción el panel busca WANIPConnection en un árbol que no la
 * tiene, concluye que la ONU no tiene WAN y la marca como fallida aunque esté
 * dando servicio.
 */
import {
  boolVal,
  genieChildIndices,
  genieGet,
  genieNodeExists,
  strVal,
} from '../../../topology/shared/genieacs-nbi.client';
import { detectDataModelRoot } from './connreq-credentials';
import {
  pickServiceWanConnection,
  type WanConnectionCandidate,
} from './wan-connection';
import { inspectWanVlanLeaves } from './wan-vlan-leaf';

export type Tr069DataModel = 'tr098' | 'tr181';

/** El gateway no es estándar en TR-181: cada fabricante lo cuelga de lo suyo. */
const TR181_GATEWAY_LEAVES = [
  'X_ZTE-COM_Gateway',
  'X_CT-COM_Gateway',
  'X_HW_Gateway',
  'Gateway',
];

export interface WanConnectionRef {
  model: Tr069DataModel;
  /** Nodo de la conexión: WANIPConnection.{i} o IP.Interface.{i}. */
  conn: string;
  /** Objeto a refrescar para que el ACS pueble sus hojas. */
  connDevice: string;
  /** True cuando lo único que hay es la conexión de gestión. */
  isMgmt: boolean;
}

export interface WanConnectionState {
  ip: string | null;
  mask: string | null;
  gateway: string | null;
  dns: string | null;
  /** null = el modelo no publica NAT, que no es lo mismo que tenerlo apagado. */
  nat: boolean | null;
  vlan: number | null;
  vlanPath: string | null;
  exposedVlanLeaves: Array<{ path: string; value: string | null }>;
  addressingType: string | null;
  connectionStatus: string | null;
  bytesSent: number;
  bytesRecv: number;
}

export interface WanWriteTargets {
  /** Hojas booleanas que deben quedar en true para que la WAN levante. */
  enableLeaves: string[];
  ip: string;
  mask: string;
  gateway: string;
  natEnable: string | null;
  vlan: string | null;
  /** TR-098 lleva la lista entera en una hoja; TR-181 una hoja por servidor. */
  dnsLeaves: string[];
  dnsJoined: boolean;
  connectionType: string | null;
  addressingType: string | null;
}

export function dataModelOf(device: Record<string, unknown>): Tr069DataModel {
  return detectDataModelRoot(device) === 'Device' ? 'tr181' : 'tr098';
}

/** Subárboles que hay que refrescar para que la WAN aparezca con valores. */
export function wanRefreshTargets(model: Tr069DataModel): string[] {
  return model === 'tr181'
    ? [
        'Device.IP.Interface',
        'Device.Ethernet.VLANTermination',
        'Device.NAT.InterfaceSetting',
        'Device.DNS.Client',
      ]
    : ['InternetGatewayDevice.WANDevice'];
}

function numberOf(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function firstIndex(device: Record<string, unknown>, base: string): number {
  return genieChildIndices(device, base)[0] ?? 1;
}

/** `Device.Ethernet.VLANTermination.3` → 702. */
function tr181VlanPath(
  device: Record<string, unknown>,
  conn: string,
): string | null {
  const lower = strVal(genieGet(device, `${conn}.LowerLayers`)) ?? '';
  const link = lower
    .split(',')
    .map((entry) => entry.trim())
    .find((entry) => /VLANTermination\.\d+$/i.test(entry));
  if (!link) return null;
  const path = `${link}.VLANID`;
  return genieNodeExists(device, path) ? path : null;
}

/** Índice de `Device.NAT.InterfaceSetting` / `Device.DNS.Client.Server` que apunta a esta WAN. */
function tr181ChildrenFor(
  device: Record<string, unknown>,
  base: string,
  conn: string,
): string[] {
  return genieChildIndices(device, base)
    .map((i) => `${base}.${i}`)
    .filter((path) => strVal(genieGet(device, `${path}.Interface`)) === conn);
}

function listTr098Candidates(
  device: Record<string, unknown>,
): WanConnectionCandidate[] {
  const out: WanConnectionCandidate[] = [];
  const wanDevBase = 'InternetGatewayDevice.WANDevice';
  for (const wd of genieChildIndices(device, wanDevBase)) {
    const connBase = `${wanDevBase}.${wd}.WANConnectionDevice`;
    for (const cd of genieChildIndices(device, connBase)) {
      const connDevice = `${connBase}.${cd}`;
      const ipBase = `${connDevice}.WANIPConnection`;
      for (const ip of genieChildIndices(device, ipBase)) {
        const conn = `${ipBase}.${ip}`;
        const vlanPath = inspectWanVlanLeaves(
          device,
          conn,
          connDevice,
        ).selected;
        out.push({
          conn,
          connDevice,
          externalIp: strVal(genieGet(device, `${conn}.ExternalIPAddress`)),
          name: strVal(genieGet(device, `${conn}.Name`)),
          serviceList:
            strVal(genieGet(device, `${conn}.X_HW_SERVICELIST`)) ??
            strVal(genieGet(device, `${conn}.X_TDTC_ServiceList`)) ??
            strVal(genieGet(device, `${conn}.X_FH_ServiceList`)) ??
            strVal(genieGet(device, `${conn}.X_CT-COM_ServiceList`)),
          vlanId: vlanPath ? numberOf(genieGet(device, vlanPath)?.value) : null,
        });
      }
    }
  }
  return out;
}

function listTr181Candidates(
  device: Record<string, unknown>,
): WanConnectionCandidate[] {
  const out: WanConnectionCandidate[] = [];
  const base = 'Device.IP.Interface';
  for (const i of genieChildIndices(device, base)) {
    const conn = `${base}.${i}`;
    const addrIndices = genieChildIndices(device, `${conn}.IPv4Address`);
    if (!addrIndices.length) continue;
    const addr = `${conn}.IPv4Address.${addrIndices[0]}`;
    const lower = strVal(genieGet(device, `${conn}.LowerLayers`)) ?? '';
    const serviceList =
      strVal(genieGet(device, `${conn}.X_ZTE-COM_ServiceList`)) ?? '';
    // La LAN del CPE también es una IP.Interface: se distingue porque cuelga
    // del bridge en vez de una VLAN y no anuncia ningún servicio.
    if (!/VLANTermination|PPP/i.test(lower) && !serviceList.trim()) continue;
    const vlanPath = tr181VlanPath(device, conn);
    out.push({
      conn,
      connDevice: conn,
      externalIp: strVal(genieGet(device, `${addr}.IPAddress`)),
      name: strVal(genieGet(device, `${conn}.Name`)),
      serviceList,
      vlanId: vlanPath ? numberOf(genieGet(device, vlanPath)?.value) : null,
    });
  }
  return out;
}

export function listWanCandidates(
  device: Record<string, unknown>,
): WanConnectionCandidate[] {
  return dataModelOf(device) === 'tr181'
    ? listTr181Candidates(device)
    : listTr098Candidates(device);
}

/**
 * Conexión sobre la que mirar o escribir el servicio.
 *
 * Se descarta la de gestión —por ahí viaja el TR-069 y pisarla deja la ONU
 * incomunicada— y entre las de servicio se prefiere la que ya lleva la IP o la
 * VLAN esperadas: las ONUs migradas conservan la WAN del sistema anterior y
 * elegir «la primera» significaría tocar la que hoy da servicio al cliente.
 */
export function findServiceWanConnection(
  device: Record<string, unknown>,
  opts?: {
    mgmtIp?: string | null;
    expectedIp?: string | null;
    expectedVlanId?: number | null;
  },
): WanConnectionRef | null {
  const model = dataModelOf(device);
  const picked = pickServiceWanConnection(
    listWanCandidates(device),
    opts?.mgmtIp,
    { ip: opts?.expectedIp, vlanId: opts?.expectedVlanId },
  );
  if (!picked) return null;
  return {
    model,
    conn: picked.chosen.conn,
    connDevice: picked.chosen.connDevice,
    isMgmt: picked.isMgmt,
  };
}

export function readWanConnectionState(
  device: Record<string, unknown>,
  ref: WanConnectionRef,
): WanConnectionState {
  return ref.model === 'tr181'
    ? readTr181State(device, ref.conn)
    : readTr098State(device, ref.conn, ref.connDevice);
}

function readTr098State(
  device: Record<string, unknown>,
  conn: string,
  connDevice: string,
): WanConnectionState {
  const vlanInspection = inspectWanVlanLeaves(device, conn, connDevice);
  const vlanPath = vlanInspection.selected;
  return {
    ip: strVal(genieGet(device, `${conn}.ExternalIPAddress`)),
    mask: strVal(genieGet(device, `${conn}.SubnetMask`)),
    gateway: strVal(genieGet(device, `${conn}.DefaultGateway`)),
    dns: strVal(genieGet(device, `${conn}.DNSServers`)),
    nat: boolVal(genieGet(device, `${conn}.NATEnabled`)),
    vlan: vlanPath ? numberOf(genieGet(device, vlanPath)?.value) : null,
    vlanPath,
    exposedVlanLeaves: vlanInspection.exposed,
    addressingType: strVal(genieGet(device, `${conn}.AddressingType`)),
    connectionStatus: strVal(genieGet(device, `${conn}.ConnectionStatus`)),
    bytesSent:
      numberOf(strVal(genieGet(device, `${conn}.Stats.EthernetBytesSent`))) ??
      numberOf(strVal(genieGet(device, `${conn}.BytesSent`))) ??
      0,
    bytesRecv:
      numberOf(
        strVal(genieGet(device, `${conn}.Stats.EthernetBytesReceived`)),
      ) ??
      numberOf(strVal(genieGet(device, `${conn}.BytesReceived`))) ??
      0,
  };
}

function readTr181State(
  device: Record<string, unknown>,
  conn: string,
): WanConnectionState {
  const addr = `${conn}.IPv4Address.${firstIndex(device, `${conn}.IPv4Address`)}`;
  const gatewayLeaf = TR181_GATEWAY_LEAVES.map(
    (leaf) => `${addr}.${leaf}`,
  ).find((path) => genieNodeExists(device, path));
  const natPaths = tr181ChildrenFor(
    device,
    'Device.NAT.InterfaceSetting',
    conn,
  );
  const dnsPaths = tr181ChildrenFor(device, 'Device.DNS.Client.Server', conn);
  const vlanPath = tr181VlanPath(device, conn);
  const dns = dnsPaths
    .map((path) => strVal(genieGet(device, `${path}.DNSServer`)))
    .filter((value): value is string => !!value?.trim())
    .join(',');
  // TR-181 describe el estado de la interfaz, no el de una «conexión»; se
  // traduce para que el resto del panel lea siempre el mismo vocabulario.
  const status = strVal(genieGet(device, `${conn}.Status`));

  return {
    ip: strVal(genieGet(device, `${addr}.IPAddress`)),
    mask: strVal(genieGet(device, `${addr}.SubnetMask`)),
    gateway: gatewayLeaf ? strVal(genieGet(device, gatewayLeaf)) : null,
    dns: dns || null,
    nat: natPaths.length
      ? boolVal(genieGet(device, `${natPaths[0]}.Enable`))
      : null,
    vlan: vlanPath ? numberOf(genieGet(device, vlanPath)?.value) : null,
    vlanPath,
    exposedVlanLeaves: vlanPath
      ? [{ path: vlanPath, value: strVal(genieGet(device, vlanPath)) }]
      : [],
    addressingType: strVal(genieGet(device, `${addr}.AddressingType`)),
    connectionStatus: status === 'Up' ? 'Connected' : status,
    bytesSent:
      numberOf(strVal(genieGet(device, `${conn}.Stats.BytesSent`))) ?? 0,
    bytesRecv:
      numberOf(strVal(genieGet(device, `${conn}.Stats.BytesReceived`))) ?? 0,
  };
}

export function resolveWanWriteTargets(
  device: Record<string, unknown>,
  ref: WanConnectionRef,
): WanWriteTargets {
  if (ref.model === 'tr098') {
    const conn = ref.conn;
    return {
      enableLeaves: [`${conn}.Enable`],
      ip: `${conn}.ExternalIPAddress`,
      mask: `${conn}.SubnetMask`,
      gateway: `${conn}.DefaultGateway`,
      natEnable: `${conn}.NATEnabled`,
      vlan: inspectWanVlanLeaves(device, conn, ref.connDevice).selected,
      dnsLeaves: [`${conn}.DNSServers`],
      dnsJoined: true,
      connectionType: `${conn}.ConnectionType`,
      addressingType: `${conn}.AddressingType`,
    };
  }

  const conn = ref.conn;
  const addr = `${conn}.IPv4Address.${firstIndex(device, `${conn}.IPv4Address`)}`;
  const gatewayLeaf =
    TR181_GATEWAY_LEAVES.map((leaf) => `${addr}.${leaf}`).find((path) =>
      genieNodeExists(device, path),
    ) ?? `${addr}.${TR181_GATEWAY_LEAVES[0]}`;
  const natPaths = tr181ChildrenFor(
    device,
    'Device.NAT.InterfaceSetting',
    conn,
  );
  const dnsPaths = tr181ChildrenFor(device, 'Device.DNS.Client.Server', conn);

  return {
    enableLeaves: [`${conn}.Enable`, `${conn}.IPv4Enable`, `${addr}.Enable`],
    ip: `${addr}.IPAddress`,
    mask: `${addr}.SubnetMask`,
    gateway: gatewayLeaf,
    natEnable: natPaths.length ? `${natPaths[0]}.Enable` : null,
    vlan: tr181VlanPath(device, conn),
    dnsLeaves: dnsPaths.map((path) => `${path}.DNSServer`),
    dnsJoined: false,
    // AddressingType y ConnectionType son de sólo lectura en TR-181: el modo
    // estático se deduce de que la dirección esté escrita a mano.
    connectionType: null,
    addressingType: null,
  };
}

/** Pares DNS listos para SetParameterValues, según lo que acepte el modelo. */
export function buildWanDnsParams(
  targets: WanWriteTargets,
  servers: string[],
): Array<[string, string, string]> {
  const wanted = servers.filter((value) => !!value?.trim());
  if (!wanted.length) return [];
  if (targets.dnsJoined) {
    return targets.dnsLeaves.length
      ? [[targets.dnsLeaves[0], wanted.join(','), 'xsd:string']]
      : [];
  }
  return targets.dnsLeaves
    .slice(0, wanted.length)
    .map((path, i) => [path, wanted[i], 'xsd:string']);
}
