/**
 * SPV genérico de WAN de servicio (TR-098 / TR-181).
 * Cortado de `OnuTr069ConfigService.applyWanStaticTr069` — comportamiento idéntico.
 */
import {
  genieGet,
  genieNodeExists,
} from '../../../topology/shared/genieacs-nbi.client';
import {
  buildWanDnsParams,
  resolveWanWriteTargets,
  type WanConnectionRef,
} from './wan-datamodel';
import { inspectWanVlanLeaves } from './wan-vlan-leaf';
import type { ApplyServiceSpvParams } from '../types';
import { ensureWanLeaf } from './ensure-wan-leaf';
import { isHguRateLeaf } from '../param-owners';

/** @deprecated Use ApplyServiceSpvParams from types. */
export type ApplyGenericServiceSpvParams = ApplyServiceSpvParams;

function vlanEnableLeaf(
  ref: WanConnectionRef,
  vlanLeaf: string,
): string | null {
  if (ref.model === 'tr181') {
    return vlanLeaf.endsWith('.VLANID')
      ? `${vlanLeaf.slice(0, -'.VLANID'.length)}.Enable`
      : null;
  }
  return vlanLeaf === `${ref.conn}.VLANID` ? `${ref.conn}.VLANEnable` : null;
}

export async function applyGenericServiceSpv(
  params: ApplyServiceSpvParams,
): Promise<string> {
  const { client, deviceId, wan, found, onEnqueued } = params;
  let device = params.device;
  const notes: string[] = [...(params.priorNotes ?? [])];
  const { conn, connDevice } = found;

  try {
    await client.refreshObject(deviceId, connDevice);
    const fresh = await client.findBySerial(params.sn);
    if (fresh) device = fresh as Record<string, unknown>;
  } catch {
    /* seguimos con lo que haya */
  }

  const dnsServers = [wan.wanDns1, wan.wanDns2].filter(
    (value): value is string => !!value?.trim(),
  );
  const dns = dnsServers.join(',');
  const targets = resolveWanWriteTargets(device, found);
  if (!genieNodeExists(device, targets.ip)) {
    notes.push(
      'WAN en DB; el árbol TR069 aún no publica la dirección de esta WAN — reintenta tras el próximo Inform',
    );
    return notes.join(' · ');
  }

  const core: Array<[string, string | number | boolean, string?]> = [
    ...targets.enableLeaves
      .filter((path) => genieNodeExists(device, path))
      .map((path) => [path, true, 'xsd:boolean'] as [string, boolean, string]),
    [targets.ip, wan.wanIp, 'xsd:string'],
    [targets.gateway, wan.wanGateway, 'xsd:string'],
    ...buildWanDnsParams(targets, dnsServers),
  ];
  if (targets.connectionType) {
    core.push([targets.connectionType, 'IP_Routed', 'xsd:string']);
  }
  if (targets.addressingType) {
    core.push([targets.addressingType, 'Static', 'xsd:string']);
  }
  if (targets.natEnable) {
    core.push([targets.natEnable, true, 'xsd:boolean']);
  } else {
    notes.push('NAT: el modelo no lo publica en el árbol TR069');
  }

  const safeCore = core.filter(([path]) => !isHguRateLeaf(path));
  if (safeCore.length !== core.length) {
    notes.push('rate HGU omitido (dueño T-CONT = OLT DBA)');
  }

  const result = await client.setParameterValues(deviceId, safeCore);
  if (result.status === 200) notes.push('WAN estática aplicada por TR069');
  else if (result.status === 202) notes.push('WAN encolada en ACS');
  else notes.push(`WAN TR069 status ${result.status}`);

  if (result.status === 202 && onEnqueued) {
    const forced = await onEnqueued();
    if (forced) notes.push(forced);
  }

  const maskNote = await ensureWanLeaf(
    client,
    deviceId,
    targets.mask,
    wan.wanMask,
    'máscara',
  );
  if (maskNote) notes.push(maskNote);

  if (targets.dnsJoined && targets.dnsLeaves.length) {
    const dnsNote = await ensureWanLeaf(
      client,
      deviceId,
      targets.dnsLeaves[0],
      dns,
      'DNS',
    );
    if (dnsNote) notes.push(dnsNote);
  } else if (!targets.dnsLeaves.length && dnsServers.length) {
    notes.push('DNS: el CPE no publica servidores ligados a esta WAN');
  }

  const vlanLeaf = targets.vlan;
  if (params.owners?.serviceVlan === 'omci') {
    notes.push('VLAN WAN: dueño OMCI — ACS no escribe hoja VLAN');
  } else if (!vlanLeaf) {
    const exposed =
      found.model === 'tr098'
        ? inspectWanVlanLeaves(device, conn, connDevice)
            .exposed.map((leaf) => leaf.path.split('.').pop())
            .join(',')
        : '';
    notes.push(
      exposed
        ? `VLAN WAN: el modelo expone ${exposed}, pero ninguna hoja es segura para escritura`
        : 'VLAN WAN sin hoja TR069 conocida (queda la de OMCI)',
    );
  } else {
    try {
      const vlanParams: Array<[string, string | number | boolean, string]> = [
        [vlanLeaf, wan.wanVlan, 'xsd:unsignedInt'],
      ];
      const enableLeaf = vlanEnableLeaf(found, vlanLeaf);
      if (enableLeaf && genieNodeExists(device, enableLeaf)) {
        vlanParams.push([enableLeaf, true, 'xsd:boolean']);
      }
      const r = await client.setParameterValues(deviceId, vlanParams);
      notes.push(
        r.status === 200
          ? `VLAN ${wan.wanVlan} aplicada (${vlanLeaf.split('.').pop()})`
          : `VLAN ${wan.wanVlan} encolada (status ${r.status})`,
      );
    } catch (e) {
      notes.push(
        `VLAN WAN falló: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  return notes.join(' · ');
}
