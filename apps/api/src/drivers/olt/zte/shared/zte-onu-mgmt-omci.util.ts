/**
 * Secuencia OMCI de gestión para ONUs ZTE (submodo `pon-onu-mng`).
 *
 * Está calcada de una captura en vivo de SmartOLT aprovisionando una HG6244C,
 * porque la que teníamos antes no llegaba a levantar el camino de gestión.
 * Dos cosas son fáciles de romper y explican por qué las ONUs se quedaban
 * "esperando informe":
 *
 *  1. `flow N switch switch_0/1` es lo que CREA el flow. Sin esa línea, todo lo
 *     que venga después (`flow mode N`, `flow N pri`, `gemport N flow N`) se
 *     rechaza con "Flow does not exist".
 *  2. El índice de gestión tiene que ser el mismo en todo el bloque. La OLT liga
 *     `ip-host N` con `switchport-bind … iphost N`, con `vlan-filter iphost N` y
 *     con el `host N` del veip. Poner la IP en un índice y los filtros en otro
 *     deja al agente TR-069 sin dirección de origen.
 */

export interface ZteOmciCommand {
  line: string;
  /** Si la OLT lo rechaza, la ONU no podrá informar al ACS. */
  critical: boolean;
}

export interface ZteOnuMgmtOmciParams {
  /** Índice de gestión: gemport, vport, flow e ip-host comparten número. */
  index: number;
  priority: number;
  vlan: number;
  ip?: string | null;
  mask?: string | null;
  gateway?: string | null;
  primaryDns?: string;
  secondaryDns?: string;
}

const req = (line: string): ZteOmciCommand => ({ line, critical: true });
const opt = (line: string): ZteOmciCommand => ({ line, critical: false });

/**
 * Borra restos de intentos anteriores. Sin esto la OLT contesta "already
 * exists" y el bloque queda a medio escribir. Todo es best-effort: si no
 * existía, el rechazo da igual.
 */
export function buildZteOnuMgmtCleanup(index: number): string[] {
  return [
    `no switchport-bind iphost ${index}`,
    `no ip-host ${index}`,
    `no flow ${index}`,
  ];
}

/**
 * Camino L2 de una VLAN dentro de la ONU. Sirve igual para la de servicio
 * (índice 1) que para la de gestión (índice 2): la secuencia es la misma y
 * ambas se rompían por el mismo motivo.
 */
export function buildZteOnuFlowCommands(params: {
  index: number;
  priority: number;
  vlan: number;
}): ZteOmciCommand[] {
  const { index, priority, vlan } = params;
  return [
    req(`flow ${index} switch switch_0/1`),
    req(`flow mode ${index} tag-filter vlan-filter untag-filter discard`),
    req(`flow ${index} pri ${priority} vlan ${vlan}`),
    req(`gemport ${index} flow ${index}`),
  ];
}

/**
 * Admisión de una VLAN en el veip. El router interno del CPE (el que hace NAT
 * para LAN y WiFi) cuelga del veip, y con `untag-filter discard` solo pasan las
 * VLANs de la lista blanca. Si la VLAN de servicio no está aquí, el CPE nunca
 * ve el tráfico: la IP WAN queda configurada pero sin ARP ni ping.
 *
 * Se llama una vez por VLAN; las entradas se acumulan, así que añadir la de
 * servicio no desplaza a la de gestión.
 */
export function buildZteOnuVeipVlanCommands(params: {
  priority: number;
  vlan: number;
}): ZteOmciCommand[] {
  const { priority, vlan } = params;
  return [
    opt('switchport-bind switch_0/1 veip 1'),
    req('vlan-filter-mode veip 1 tag-filter vlan-filter untag-filter discard'),
    req(`vlan-filter veip 1 pri ${priority} vlan ${vlan}`),
  ];
}

/** Dirección de gestión y filtros por los que sale el Inform. */
export function buildZteOnuMgmtIpHostCommands(
  params: ZteOnuMgmtOmciParams,
): ZteOmciCommand[] {
  const {
    index,
    priority,
    vlan,
    ip,
    mask,
    gateway,
    primaryDns = '8.8.8.8',
    secondaryDns = '8.8.4.4',
  } = params;

  const cmds: ZteOmciCommand[] = [
    // El switch interno sale por el veip (datos del cliente) y por el ip-host
    // (gestión). Atar solo el veip deja la IP de gestión sin salida.
    opt('switchport-bind switch_0/1 veip 1'),
    req(`switchport-bind switch_0/1 iphost ${index}`),
  ];

  if (ip && mask && gateway) {
    cmds.push(
      req(`ip-host ${index} ip ${ip} mask ${mask} gateway ${gateway}`),
      opt(`ip-host ${index} primary-dns ${primaryDns} second-dns ${secondaryDns}`),
    );
  }

  cmds.push(
    // El filtro va sobre el ip-host, no sobre el veip: es el ip-host quien
    // emite el Inform y tiene que salir etiquetado.
    req(`vlan-filter-mode iphost ${index} tag-filter vlan-filter untag-filter discard`),
    req(`vlan-filter iphost ${index} pri ${priority} vlan ${vlan}`),
    // Puerto por el que el ACS devuelve el Connection Request al CPE.
    opt(`veip 1 port udp 1232 host ${index}`),
  );

  return cmds;
}
