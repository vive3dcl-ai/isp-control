/**
 * Elección de la conexión WAN sobre la que escribir el servicio.
 *
 * Estas ONUs traen dos: la de servicio (VLAN de cliente) y la de gestión (VLAN
 * de mgmt), que es por donde viaja el TR-069. Escribir la IP de servicio encima
 * de la de gestión deja al equipo incomunicado y sin forma de recuperarlo en
 * remoto, así que la elección tiene que ser deliberada y no «la primera que
 * aparezca».
 */

export interface WanConnectionCandidate {
  /** Ruta TR-069 de la conexión (WANIPConnection o IP.Interface). */
  conn: string;
  /** Ruta del objeto contenedor que hay que refrescar. */
  connDevice: string;
  /** ExternalIPAddress, o null si el árbol aún no la publica. */
  externalIp: string | null;
  /** Name de la conexión, que en estos CPE delata su propósito. */
  name: string | null;
  /** Lista de servicios del CPE (`INTERNET`, `TR069_VoIP`…), si la publica. */
  serviceList?: string | null;
  /** VLAN ya resuelta, cuando el árbol permite deducirla. */
  vlanId?: number | null;
}

/**
 * La IP de gestión es la señal fiable. Después va la lista de servicios, y sólo
 * si no hay ninguna se recurre al nombre: los CPE TR-098 bautizan la conexión
 * de gestión con «TR069» dentro (p. ej. `2_TR069_R_VID_401`), pero en TR-181 el
 * nombre es genérico (`DEV.IP.IF4`) y la WAN de servicio también anuncia TR069
 * entre sus servicios, así que ahí el nombre engañaría.
 */
export function isManagementConnection(
  candidate: Pick<
    WanConnectionCandidate,
    'externalIp' | 'name' | 'serviceList'
  >,
  mgmtIp?: string | null,
): boolean {
  if (mgmtIp && candidate.externalIp && candidate.externalIp === mgmtIp) {
    return true;
  }
  const services = candidate.serviceList?.trim();
  if (services) {
    return /TR.?069/i.test(services) && !/INTERNET/i.test(services);
  }
  return /TR.?069/i.test(candidate.name ?? '');
}

/**
 * Devuelve la conexión de servicio, o `isMgmt` si la única que hay es la de
 * gestión, para que quien llame avise en vez de escribir. Nunca inventa una ruta
 * cuando no hay candidatas: escribir en un nodo que el CPE no expone sólo genera
 * un fallo que el ACS reintenta indefinidamente.
 *
 * Entre varias de servicio se prefiere la que ya lleva la IP o la VLAN
 * esperadas. Las ONUs migradas conservan la WAN del sistema anterior, y quedarse
 * con «la primera» significaría leer o escribir la que hoy da servicio.
 */
export function pickServiceWanConnection(
  candidates: WanConnectionCandidate[],
  mgmtIp?: string | null,
  expected?: { ip?: string | null; vlanId?: number | null },
): { chosen: WanConnectionCandidate; isMgmt: boolean } | null {
  if (!candidates.length) return null;

  const service = candidates.filter((c) => !isManagementConnection(c, mgmtIp));
  if (!service.length) return { chosen: candidates[0], isMgmt: true };

  const byIp = expected?.ip
    ? service.find((c) => c.externalIp === expected.ip)
    : undefined;
  if (byIp) return { chosen: byIp, isMgmt: false };

  const byVlan =
    expected?.vlanId != null
      ? service.find((c) => c.vlanId === expected.vlanId)
      : undefined;
  if (byVlan) return { chosen: byVlan, isMgmt: false };

  return { chosen: service[0], isMgmt: false };
}
