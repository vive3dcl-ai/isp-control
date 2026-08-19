/**
 * IPv4 helpers for TV multicast segment allocation (udp://x.x.x.x:port).
 */

export function ipv4ToInt(ip: string): number | null {
  const parts = ip.trim().split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d+$/.test(p)) return null;
    const o = Number(p);
    if (o < 0 || o > 255) return null;
    n = (n << 8) + o;
  }
  return n >>> 0;
}

export function intToIpv4(n: number): string {
  const x = n >>> 0;
  return [
    (x >>> 24) & 255,
    (x >>> 16) & 255,
    (x >>> 8) & 255,
    x & 255,
  ].join('.');
}

export type MulticastRange = {
  cidr: string;
  network: number;
  prefix: number;
  /** Inclusive first usable host */
  firstHost: number;
  /** Inclusive last usable host */
  lastHost: number;
  port: number;
};

export function parseMulticastCidr(
  cidrRaw: string,
  port: number,
): MulticastRange {
  const cidr = cidrRaw.trim();
  const m = /^(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})$/.exec(cidr);
  if (!m) {
    throw new Error('CIDR inválido (ej. 239.1.1.0/24)');
  }
  const networkIp = m[1]!;
  const prefix = Number(m[2]);
  if (prefix < 8 || prefix > 30) {
    throw new Error('Prefijo multicast debe estar entre /8 y /30');
  }
  if (!Number.isFinite(port) || port < 1 || port > 65535) {
    throw new Error('Puerto multicast inválido');
  }
  const network = ipv4ToInt(networkIp);
  if (network == null) throw new Error('IP de red inválida');
  // First octet should be 224-239 for multicast
  const firstOctet = (network >>> 24) & 255;
  if (firstOctet < 224 || firstOctet > 239) {
    throw new Error('El segmento debe ser multicast (224.0.0.0 – 239.255.255.255)');
  }
  const hostBits = 32 - prefix;
  const size = 2 ** hostBits;
  const mask = hostBits === 32 ? 0 : (~(size - 1)) >>> 0;
  const net = (network & mask) >>> 0;
  const firstHost = size <= 2 ? net : (net + 1) >>> 0;
  const lastHost = size <= 2 ? net : (net + size - 2) >>> 0;
  return {
    cidr: `${intToIpv4(net)}/${prefix}`,
    network: net,
    prefix,
    firstHost,
    lastHost,
    port,
  };
}

/** Parse udp://239.x.x.x:port → { ip, port } */
export function parseUdpOutput(
  output: string,
): { ip: string; port: number } | null {
  const m = /^udp:\/\/(\d{1,3}(?:\.\d{1,3}){3}):(\d{1,5})\s*$/i.exec(
    output.trim(),
  );
  if (!m) return null;
  const ip = m[1]!;
  const port = Number(m[2]);
  if (ipv4ToInt(ip) == null || port < 1 || port > 65535) return null;
  return { ip, port };
}

export function formatUdpOutput(ip: string, port: number): string {
  return `udp://${ip}:${port}`;
}

/**
 * Next free host in range, preferring sequential after the highest used
 * address in-range with the same port. Falls back to first free hole.
 */
export function allocateNextMulticastIp(
  range: MulticastRange,
  usedOutputs: string[],
): string {
  const used = new Set<number>();
  let maxUsed = range.firstHost - 1;
  for (const out of usedOutputs) {
    const parsed = parseUdpOutput(out);
    if (!parsed || parsed.port !== range.port) continue;
    const n = ipv4ToInt(parsed.ip);
    if (n == null || n < range.firstHost || n > range.lastHost) continue;
    used.add(n);
    if (n > maxUsed) maxUsed = n;
  }
  const candidate = (maxUsed + 1) >>> 0;
  if (
    candidate >= range.firstHost &&
    candidate <= range.lastHost &&
    !used.has(candidate)
  ) {
    return formatUdpOutput(intToIpv4(candidate), range.port);
  }
  for (let n = range.firstHost; n <= range.lastHost; n++) {
    if (!used.has(n)) {
      return formatUdpOutput(intToIpv4(n), range.port);
    }
  }
  throw new Error(
    `Segmento ${range.cidr} agotado (puerto ${range.port})`,
  );
}
