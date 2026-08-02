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
  /** Ruta TR-069 de la WANIPConnection. */
  conn: string;
  /** Ruta del WANConnectionDevice que la contiene. */
  connDevice: string;
  /** ExternalIPAddress, o null si el árbol aún no la publica. */
  externalIp: string | null;
  /** Name de la conexión, que en estos CPE delata su propósito. */
  name: string | null;
}

/**
 * La IP de gestión es la señal fiable. El nombre es la red de seguridad para
 * cuando el árbol del ACS está a medias y todavía no publica la IP: estos CPE
 * bautizan la conexión de gestión con «TR069» dentro (p. ej.
 * `2_TR069_R_VID_401`).
 */
export function isManagementConnection(
  candidate: Pick<WanConnectionCandidate, 'externalIp' | 'name'>,
  mgmtIp?: string | null,
): boolean {
  if (mgmtIp && candidate.externalIp && candidate.externalIp === mgmtIp) {
    return true;
  }
  return /TR.?069/i.test(candidate.name ?? '');
}

/**
 * Devuelve la conexión de servicio, o `isMgmt` si la única que hay es la de
 * gestión, para que quien llame avise en vez de escribir. Nunca inventa una ruta
 * cuando no hay candidatas: escribir en un nodo que el CPE no expone sólo genera
 * un fallo que el ACS reintenta indefinidamente.
 */
export function pickServiceWanConnection(
  candidates: WanConnectionCandidate[],
  mgmtIp?: string | null,
): { chosen: WanConnectionCandidate; isMgmt: boolean } | null {
  if (!candidates.length) return null;

  const service = candidates.find((c) => !isManagementConnection(c, mgmtIp));
  if (service) return { chosen: service, isMgmt: false };

  return { chosen: candidates[0], isMgmt: true };
}
