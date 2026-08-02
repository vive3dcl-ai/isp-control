import { createHash } from 'node:crypto';

/**
 * Credenciales de petición de conexión (TR-069 §3.2.2).
 *
 * Para que el ACS pueda decirle a un CPE «conéctate ahora» tiene que
 * autenticarse por digest contra su ConnectionRequestURL. La contraseña es de
 * sólo escritura en el CPE: nunca se puede leer, así que si el ACS no la fijó
 * él mismo no hay forma de conocerla y el CPE contesta 401. El resultado es que
 * toda orden queda encolada hasta el siguiente Inform periódico, que en algunos
 * modelos es más de una hora.
 *
 * Por eso se derivan del número de serie en lugar de sortearlas: si se pierde
 * la base del ACS se pueden recalcular sin tener que tocar los equipos.
 */

/** Sal fija del producto: sólo hace que la clave no sea el hash pelado del SN. */
const SALT = 'isp-control/tr069-connreq/v1';

export const CONN_REQ_USERNAME = 'acs';

/**
 * Contraseña de 16 caracteres: hay CPEs que rechazan más largo y otros que
 * exigen empezar por letra, así que se fuerzan ambas cosas.
 */
export function connReqPassword(serial: string): string {
  const hash = createHash('sha256')
    .update(`${SALT}:${serial.trim().toUpperCase()}`)
    .digest('hex');
  return `A${hash.slice(0, 15)}`;
}

export function connReqCredentials(serial: string): {
  username: string;
  password: string;
} {
  return { username: CONN_REQ_USERNAME, password: connReqPassword(serial) };
}

/**
 * Raíz del modelo de datos del CPE: los TR-098 cuelgan de
 * `InternetGatewayDevice`, los TR-181 de `Device`.
 */
export function detectDataModelRoot(
  device: Record<string, unknown> | null | undefined,
): 'InternetGatewayDevice' | 'Device' {
  if (device && typeof device === 'object' && 'Device' in device) {
    const igd = (device as Record<string, unknown>).InternetGatewayDevice;
    if (!igd) return 'Device';
  }
  return 'InternetGatewayDevice';
}

/**
 * Pares para SetParameterValues. Van juntos a propósito: fijar sólo la clave
 * dejaría al CPE esperando un usuario que el ACS no manda.
 */
export function buildConnReqParameterValues(
  serial: string,
  root: 'InternetGatewayDevice' | 'Device' = 'InternetGatewayDevice',
): Array<[string, string, string]> {
  const { username, password } = connReqCredentials(serial);
  const base = `${root}.ManagementServer`;
  return [
    [`${base}.ConnectionRequestUsername`, username, 'xsd:string'],
    [`${base}.ConnectionRequestPassword`, password, 'xsd:string'],
  ];
}
