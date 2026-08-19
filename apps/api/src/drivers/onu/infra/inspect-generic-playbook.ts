/**
 * Lee el árbol ACS y puntúa qué pasos del playbook genérico aplican.
 * No escribe SPV: solo decide reusar / AddObject / VLAN / bind / ruta / OMCI.
 */
import {
  genieChildIndices,
  genieGet,
  genieNodeExists,
  strVal,
} from '../../../topology/shared/genieacs-nbi.client';
import { detectDataModelRoot } from './connreq-credentials';
import { vendorFromSn } from './vendor-from-sn';
import { findServiceWanConnection } from './wan-datamodel';
import { inspectWanVlanLeaves } from './wan-vlan-leaf';
import { isTendaSn } from '../models/tenda-hg9/match';

export type GenericPlaybookFamily =
  | 'huawei_hgu'
  | 'tenda'
  | 'fiberhome_hgu'
  | 'zte_hgu'
  | 'zte_bridge'
  | 'unknown_hgu'
  | 'unknown_bridge';

export type GenericPlaybookStep =
  | 'reuse'
  | 'junk'
  | 'add'
  | 'spv'
  | 'bind'
  | 'route'
  | 'omci';

export type GenericPlaybookPlan = {
  family: GenericPlaybookFamily;
  dataModel: 'tr098' | 'tr181';
  steps: GenericPlaybookStep[];
  wanPath: string | null;
  wanDevicePath: string | null;
  addObjectParent: string | null;
  vlanLeaf: string | null;
  bindLeaf: string | null;
  junkWanPath: string | null;
  notes: string[];
};

const ZTE_HGU_RE = /F6[678]0|F6600|F670L|F680/i;
const ZTE_BRIDGE_RE = /F601|F612|F401|F612W/i;

const BIND_LEAF_SUFFIXES = [
  'X_HW_LANBIND.Lan1Enable',
  'X_TDTC_LanInterfaceBind',
  'X_FH_LanInterface',
  'X_CT-COM_LanInterface',
];

const IGD_WAN = 'InternetGatewayDevice.WANDevice';

export function isZteHguModel(
  onuType?: string | null,
  acsModel?: string | null,
): boolean {
  return [onuType, acsModel].some((m) => !!m && ZTE_HGU_RE.test(m));
}

export function isZteBridgeModel(
  onuType?: string | null,
  acsModel?: string | null,
): boolean {
  return [onuType, acsModel].some((m) => !!m && ZTE_BRIDGE_RE.test(m));
}

function isTr181(device: Record<string, unknown>): boolean {
  return (
    detectDataModelRoot(device) === 'Device' ||
    genieNodeExists(device, 'Device.IP.Interface') ||
    genieNodeExists(device, 'Device.Routing.Router')
  );
}

function looksHguTree(device: Record<string, unknown>): boolean {
  if (isTr181(device)) return true;
  return (
    genieChildIndices(device, `${IGD_WAN}.1.WANConnectionDevice`).length > 0 ||
    genieNodeExists(device, `${IGD_WAN}.1.WANConnectionDevice`)
  );
}

function serviceListOf(
  device: Record<string, unknown>,
  conn: string,
): string {
  return (
    strVal(genieGet(device, `${conn}.X_HW_SERVICELIST`)) ??
    strVal(genieGet(device, `${conn}.X_TDTC_ServiceList`)) ??
    strVal(genieGet(device, `${conn}.X_FH_ServiceList`)) ??
    strVal(genieGet(device, `${conn}.X_CT-COM_ServiceList`)) ??
    strVal(genieGet(device, `${conn}.X_ZTE-COM_ServiceList`)) ??
    strVal(genieGet(device, `${conn}.Name`)) ??
    ''
  );
}

function isTr069Only(list: string): boolean {
  return /TR.?069/i.test(list) && !/INTERNET/i.test(list);
}

function findBindLeaf(
  device: Record<string, unknown>,
  conn: string,
): string | null {
  for (const suf of BIND_LEAF_SUFFIXES) {
    const path = `${conn}.${suf}`;
    if (genieNodeExists(device, path)) return path;
  }
  return null;
}

function listTr098IpConns(device: Record<string, unknown>): Array<{
  conn: string;
  connDevice: string;
}> {
  const out: Array<{ conn: string; connDevice: string }> = [];
  for (const wd of genieChildIndices(device, IGD_WAN)) {
    const wcdBase = `${IGD_WAN}.${wd}.WANConnectionDevice`;
    for (const cd of genieChildIndices(device, wcdBase)) {
      const connDevice = `${wcdBase}.${cd}`;
      const ipBase = `${connDevice}.WANIPConnection`;
      const ips = genieChildIndices(device, ipBase);
      if (!ips.length) {
        out.push({ conn: `${ipBase}.1`, connDevice });
        continue;
      }
      for (const ip of ips) {
        out.push({ conn: `${ipBase}.${ip}`, connDevice });
      }
    }
  }
  return out;
}

export function classifyGenericFamily(opts: {
  sn: string;
  onuType?: string | null;
  acsModel?: string | null;
  device: Record<string, unknown>;
}): GenericPlaybookFamily {
  const vendor = vendorFromSn(opts.sn);
  const hgu = looksHguTree(opts.device);
  if (isTendaSn(opts.sn)) return 'tenda';
  if (vendor === 'huawei') return 'huawei_hgu';
  if (vendor === 'fiberhome') return 'fiberhome_hgu';
  if (vendor === 'zte') {
    if (isZteBridgeModel(opts.onuType, opts.acsModel)) return 'zte_bridge';
    if (isZteHguModel(opts.onuType, opts.acsModel) || isTr181(opts.device)) {
      return 'zte_hgu';
    }
    return hgu ? 'zte_hgu' : 'zte_bridge';
  }
  return hgu ? 'unknown_hgu' : 'unknown_bridge';
}

export function inspectGenericPlaybook(opts: {
  sn: string;
  onuType?: string | null;
  acsModel?: string | null;
  device: Record<string, unknown>;
  expectedVlan?: number | null;
  expectedIp?: string | null;
}): GenericPlaybookPlan {
  const notes: string[] = [];
  const family = classifyGenericFamily(opts);
  const dataModel: 'tr098' | 'tr181' = isTr181(opts.device)
    ? 'tr181'
    : 'tr098';

  if (family === 'zte_bridge' || family === 'unknown_bridge') {
    notes.push('familia puente: WAN por OMCI, ACS no crea WCD');
    return {
      family,
      dataModel,
      steps: ['omci'],
      wanPath: null,
      wanDevicePath: null,
      addObjectParent: null,
      vlanLeaf: null,
      bindLeaf: null,
      junkWanPath: null,
      notes,
    };
  }

  const found = findServiceWanConnection(opts.device, {
    expectedIp: opts.expectedIp,
    expectedVlanId: opts.expectedVlan,
  });
  const conns = listTr098IpConns(opts.device);
  const steps: GenericPlaybookStep[] = [];

  let wanPath = found && !found.isMgmt ? found.conn : null;
  let wanDevicePath = found && !found.isMgmt ? found.connDevice : null;
  let junkWanPath: string | null = null;

  if (dataModel === 'tr098') {
    for (const c of conns) {
      const list = serviceListOf(opts.device, c.conn);
      if (isTr069Only(list)) continue;
      const vlanInsp = inspectWanVlanLeaves(
        opts.device,
        c.conn,
        c.connDevice,
      );
      const vlanVal = vlanInsp.selected
        ? Number(strVal(genieGet(opts.device, vlanInsp.selected)) ?? NaN)
        : null;
      if (
        opts.expectedVlan != null &&
        Number.isFinite(vlanVal) &&
        vlanVal !== opts.expectedVlan &&
        /INTERNET/i.test(list)
      ) {
        junkWanPath = c.conn;
      }
    }
  }

  if (wanPath) {
    steps.push('reuse');
    notes.push(`reusar ${wanPath}`);
  } else if (junkWanPath) {
    steps.push('junk');
    notes.push(`apagar WAN fábrica ${junkWanPath}`);
  }

  const wcdParent = `${IGD_WAN}.1.WANConnectionDevice`;
  const hasWcdParent =
    dataModel === 'tr098' &&
    (genieNodeExists(opts.device, wcdParent) ||
      genieNodeExists(opts.device, `${IGD_WAN}.1`));

  if (!wanPath && dataModel === 'tr098' && hasWcdParent) {
    steps.push('add');
    notes.push(`AddObject ${wcdParent} (no bajo WCD TR069)`);
  } else if (!wanPath && dataModel === 'tr181') {
    notes.push('TR-181: no AddObject IGD; SPV sobre IP.Interface de servicio');
  }

  const onlyPpp =
    dataModel === 'tr098' &&
    !conns.length &&
    genieNodeExists(
      opts.device,
      `${IGD_WAN}.1.WANConnectionDevice.1.WANPPPConnection`,
    );
  if (onlyPpp && !wanPath) {
    notes.push('solo WANPPP y plan estático — no adivinar PPPoE');
    return {
      family,
      dataModel,
      steps: [],
      wanPath: null,
      wanDevicePath: null,
      addObjectParent: null,
      vlanLeaf: null,
      bindLeaf: null,
      junkWanPath,
      notes,
    };
  }

  if (!steps.includes('omci')) steps.push('spv');

  let vlanLeaf: string | null = null;
  let bindLeaf: string | null = null;
  const probe = wanPath
    ? { conn: wanPath, connDevice: wanDevicePath ?? wanPath }
    : conns[0];
  if (probe) {
    vlanLeaf = inspectWanVlanLeaves(
      opts.device,
      probe.conn,
      probe.connDevice,
    ).selected;
    bindLeaf = findBindLeaf(opts.device, probe.conn);
  }

  if (bindLeaf) {
    steps.push('bind');
    notes.push(`bind ${bindLeaf}`);
  } else {
    notes.push('sin hoja bind — se omite');
  }

  if (dataModel === 'tr181' || family === 'zte_hgu') {
    steps.push('route');
    notes.push('TR-181/ZTE HGU: revisar ruta 0.0.0.0');
  }

  return {
    family,
    dataModel,
    steps,
    wanPath,
    wanDevicePath,
    addObjectParent: steps.includes('add') ? wcdParent : null,
    vlanLeaf,
    bindLeaf,
    junkWanPath,
    notes,
  };
}
