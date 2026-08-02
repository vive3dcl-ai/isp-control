import { createHash, randomBytes } from 'node:crypto';

/**
 * Petición de conexión al CPE (TR-069 §3.2.2) autenticada por digest.
 *
 * Cuando el ACS no conoce la contraseña del CPE recibe 401 y todo lo que mande
 * espera al Inform periódico, que en las ONUs migradas viene en 12 horas. Las
 * que llegan de otro sistema conservan sus credenciales de fábrica, así que se
 * les llama con ellas una vez: el CPE abre sesión, aplica lo encolado —incluidas
 * las credenciales nuestras— y a partir de ahí ya se le manda por el camino
 * normal.
 *
 * Digest se implementa aquí porque `fetch` sólo trae autenticación básica y
 * ningún CPE la acepta para esto.
 */

export interface DigestChallenge {
  realm: string;
  nonce: string;
  qop?: string;
  opaque?: string;
}

/** Lee el reto del `WWW-Authenticate`; devuelve null si no es digest usable. */
export function parseDigestChallenge(
  header: string | null | undefined,
): DigestChallenge | null {
  if (!header || !/^\s*digest\s/i.test(header)) return null;
  const field = (name: string) =>
    new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|([^,\\s]+))`, 'i').exec(
      header,
    )?.slice(1).find((v) => v != null);

  const nonce = field('nonce');
  if (!nonce) return null;
  return {
    realm: field('realm') ?? '',
    nonce,
    qop: field('qop'),
    opaque: field('opaque'),
  };
}

const md5 = (value: string) =>
  createHash('md5').update(value).digest('hex');

/** Cabecera `Authorization` para un GET, con y sin `qop`. */
export function buildDigestAuthorization(params: {
  challenge: DigestChallenge;
  uri: string;
  username: string;
  password: string;
  cnonce: string;
  nc?: string;
}): string {
  const { challenge, uri, username, password, cnonce } = params;
  const nc = params.nc ?? '00000001';
  const { realm, nonce, qop, opaque } = challenge;

  const ha1 = md5(`${username}:${realm}:${password}`);
  const ha2 = md5(`GET:${uri}`);
  // Con qop el CPE espera que el cliente aporte su propio nonce y un contador.
  const response = qop
    ? md5(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`)
    : md5(`${ha1}:${nonce}:${ha2}`);

  const parts = [
    `username="${username}"`,
    `realm="${realm}"`,
    `nonce="${nonce}"`,
    `uri="${uri}"`,
    `response="${response}"`,
  ];
  if (qop) parts.push(`qop=${qop}`, `nc=${nc}`, `cnonce="${cnonce}"`);
  if (opaque) parts.push(`opaque="${opaque}"`);
  return `Digest ${parts.join(', ')}`;
}

/**
 * Credenciales con las que probar. En estos equipos la contraseña de fábrica
 * repite el usuario (`RMS`/`RMS` en FiberHome, `smartolt`/`smartolt` en las que
 * gestionaba SmartOLT), así que se prueba eso antes que la lista fija.
 */
export function factoryConnReqCandidates(
  currentUsername: string | null | undefined,
  ourPassword: string,
): Array<{ username: string; password: string }> {
  const seen = new Set<string>();
  const out: Array<{ username: string; password: string }> = [];
  const add = (username: string, password: string) => {
    const key = `${username}\u0000${password}`;
    if (!username || seen.has(key)) return;
    seen.add(key);
    out.push({ username, password });
  };

  const current = (currentUsername ?? '').trim();
  add(current, current);
  add(current, '');
  add('RMS', 'RMS');
  add('smartolt', 'smartolt');
  add('admin', 'admin');
  // Por si ya se le pusieron las nuestras y sólo falta despertarlo.
  add('acs', ourPassword);
  return out;
}

/** Nonce de cliente. Aparte para poder fijarlo en las pruebas. */
export function newCnonce(): string {
  return randomBytes(8).toString('hex');
}
