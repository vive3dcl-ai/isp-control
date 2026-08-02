/**
 * IPv4 pool math.
 *
 * Host lists are never materialized wholesale: the DTO accepts prefixes down to
 * /8, and enumerating one entry per host there means ~16.7M strings, which
 * exhausts the heap and turns a plain GET into a 500. Sizes and membership are
 * arithmetic; enumeration is explicit and bounded.
 */

export type IpNetworkInfo = {
  gateway: string;
  prefix: number;
  network: string;
  broadcast: string;
  /** Hosts excluding network, broadcast and the gateway itself. */
  totalUsable: number;
};

/** Hard ceiling for a single enumeration request. */
export const MAX_ENUMERATED_HOSTS = 4096;

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
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join(
    '.',
  );
}

function bounds(info: IpNetworkInfo) {
  return {
    network: parseIpv4(info.network),
    broadcast: parseIpv4(info.broadcast),
    gateway: parseIpv4(info.gateway),
  };
}

export function computeIpNetwork(
  gateway: string,
  prefix: number,
): IpNetworkInfo {
  if (!Number.isInteger(prefix) || prefix < 8 || prefix > 30) {
    throw new Error('Prefix must be an integer between 8 and 30');
  }
  const gw = parseIpv4(gateway);
  const mask = (~0 << (32 - prefix)) >>> 0;
  const network = (gw & mask) >>> 0;
  const broadcast = (network | (~mask >>> 0)) >>> 0;

  if (gw === network || gw === broadcast) {
    throw new Error('Gateway cannot be network or broadcast address');
  }

  return {
    gateway: toIpv4(gw),
    prefix,
    network: toIpv4(network),
    broadcast: toIpv4(broadcast),
    totalUsable: Math.max(0, broadcast - network - 2),
  };
}

/**
 * Ascending slice of usable hosts. `limit` is clamped to MAX_ENUMERATED_HOSTS so
 * a wide pool can be paged instead of loaded whole.
 */
export function enumerateUsableHosts(
  info: IpNetworkInfo,
  opts?: { offset?: number; limit?: number },
): string[] {
  const { network, broadcast, gateway } = bounds(info);
  const offset = Math.max(0, Math.trunc(opts?.offset ?? 0));
  const limit = Math.min(
    MAX_ENUMERATED_HOSTS,
    Math.max(0, Math.trunc(opts?.limit ?? MAX_ENUMERATED_HOSTS)),
  );

  const out: string[] = [];
  let index = 0;
  for (let i = network + 1; i < broadcast && out.length < limit; i++) {
    if (i === gateway) continue;
    if (index++ < offset) continue;
    out.push(toIpv4(i));
  }
  return out;
}

/** Is `ip` a usable host of this network (not network/broadcast/gateway)? */
export function isIpInUsable(ip: string, info: IpNetworkInfo): boolean {
  let value: number;
  try {
    value = parseIpv4(ip);
  } catch {
    return false;
  }
  const { network, broadcast, gateway } = bounds(info);
  return value > network && value < broadcast && value !== gateway;
}

/**
 * Lowest usable IP not present in `assigned`. Scans arithmetically, so it costs
 * one step per already-taken address rather than one per address in the network.
 */
export function firstFreeIp(
  info: IpNetworkInfo,
  assigned: Set<string>,
): string | null {
  const { network, broadcast, gateway } = bounds(info);
  for (let i = network + 1; i < broadcast; i++) {
    if (i === gateway) continue;
    const ip = toIpv4(i);
    if (!assigned.has(ip)) return ip;
  }
  return null;
}
