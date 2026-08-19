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
 * ¿Hay que (re)escribir las credenciales de petición de conexión?
 *
 * La clave no se puede leer del CPE, así que lo único fiable es el usuario: si
 * es el nuestro, la clave la pusimos nosotros y sirve. Cualquier otro valor
 * viene de fábrica o del sistema anterior — las ONUs migradas llegan con las de
 * SmartOLT (`RMS`) — y con ellas el ACS recibe 401 y todo se queda en cola.
 */
export function shouldWriteConnReqCredentials(
  currentUsername: string | null | undefined,
): boolean {
  return (currentUsername ?? '').trim() !== CONN_REQ_USERNAME;
}

/**
 * ¿Podemos confiar en que la clave de ConnectionRequest es la nuestra?
 *
 * El usuario solo no basta: Huawei (HG/EG8145X6 y otras) sale de fábrica con
 * `ConnectionRequestUsername=acs` y otra password. Si el probe de CR falló
 * (`reachable === false`), hay que reescribir la clave (SPV vía Inform).
 *
 * `reachable === undefined` → sin probe aún; se confía en el username (como
 * antes) para no reescribir en cada tick silencioso.
 */
export function connreqCredentialsTrusted(opts: {
  currentUsername: string | null | undefined;
  reachable?: boolean | null;
}): boolean {
  if (shouldWriteConnReqCredentials(opts.currentUsername)) return false;
  if (opts.reachable === false) return false;
  return true;
}

/**
 * Intervalo de Inform que dejamos en el CPE, en segundos.
 *
 * Es la red de seguridad: cuando la petición de conexión falla, todo lo que
 * mande el ACS espera al siguiente Inform. Las ONUs migradas llegan con 43200
 * (12 h), que convierte cualquier reintento en una avería de medio día.
 */
export const CONN_REQ_INFORM_INTERVAL_S = 300;

/** Sólo se acorta; si el CPE ya informa seguido, no se toca. */
export function shouldShortenInformInterval(
  current: number | null | undefined,
): boolean {
  if (current == null || !Number.isFinite(current)) return true;
  return current > CONN_REQ_INFORM_INTERVAL_S;
}

/**
 * Raíz del modelo de datos del CPE: los TR-098 cuelgan de
 * `InternetGatewayDevice`, los TR-181 de `Device`.
 *
 * Hay ONUs —las ZTE F6600P entre ellas— que dejan asomar un `InternetGatewayDevice`
 * vacío junto al árbol real, así que la presencia del nodo no basta: manda el que
 * publique ManagementServer, que es de donde cuelga todo lo que el ACS escribe.
 */
export function detectDataModelRoot(
  device: Record<string, unknown> | null | undefined,
): 'InternetGatewayDevice' | 'Device' {
  if (!device || typeof device !== 'object') return 'InternetGatewayDevice';

  const hasMgmt = (root: unknown) =>
    !!root &&
    typeof root === 'object' &&
    !!(root as Record<string, unknown>).ManagementServer;

  const igd = device.InternetGatewayDevice;
  const dev = device.Device;
  if (hasMgmt(igd)) return 'InternetGatewayDevice';
  if (hasMgmt(dev)) return 'Device';
  if (!igd && dev) return 'Device';
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
