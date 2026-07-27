export type IpNetworkInfo = {
  gateway: string;
  prefix: number;
  network: string;
  broadcast: string;
  usableHosts: string[];
  totalUsable: number;
};

function parseIpv4(ip: string): number {
  const parts = ip.trim().split('.');
  if (parts.length !== 4) {
    throw new Error(`Invalid IPv4: ${ip}`);
  }
  let n = 0;
  for (const p of parts) {
    if (!/^\d+$/.test(p)) throw new Error(`Invalid IPv4: ${ip}`);
    const o = Number(p);
    if (o < 0 || o > 255) throw new Error(`Invalid IPv4: ${ip}`);
    n = (n << 8) + o;
  }
  return n >>> 0;
}

function toIpv4(n: number): string {
  return [
    (n >>> 24) & 255,
    (n >>> 16) & 255,
    (n >>> 8) & 255,
    n & 255,
  ].join('.');
}

export function computeIpNetwork(
  gateway: string,
  prefix: number,
): IpNetworkInfo {
  if (!Number.isInteger(prefix) || prefix < 8 || prefix > 30) {
    throw new Error('Prefix must be an integer between 8 and 30');
  }
  const gw = parseIpv4(gateway);
  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
  const network = (gw & mask) >>> 0;
  const broadcast = (network | (~mask >>> 0)) >>> 0;

  if (gw === network || gw === broadcast) {
    throw new Error('Gateway cannot be network or broadcast address');
  }
  if ((gw & mask) !== network) {
    throw new Error('Gateway is not inside the computed network');
  }

  const usableHosts: string[] = [];
  for (let i = network + 1; i < broadcast; i++) {
    if (i === gw) continue;
    usableHosts.push(toIpv4(i));
  }

  return {
    gateway: toIpv4(gw),
    prefix,
    network: toIpv4(network),
    broadcast: toIpv4(broadcast),
    usableHosts,
    totalUsable: usableHosts.length,
  };
}

/** First free IP in ascending order (usableHosts already sorted). */
export function firstFreeIp(
  usableHosts: string[],
  assigned: Set<string>,
): string | null {
  for (const ip of usableHosts) {
    if (!assigned.has(ip)) return ip;
  }
  return null;
}

export function isIpInUsable(ip: string, usableHosts: string[]): boolean {
  return usableHosts.includes(ip);
}
