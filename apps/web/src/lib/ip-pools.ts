export type IpPoolPurpose = 'internet' | 'management'

export type IpPool = {
  id: string
  oltId: string
  oltName: string | null
  routerId: string | null
  routerName: string | null
  vlanId: number
  purpose: IpPoolPurpose
  name: string | null
  gateway: string
  prefix: number
  /** Primary DNS — required for internet (WAN) pools. */
  dns1: string | null
  dns2: string | null
  network: string
  total: number
  assigned: number
  available: number
  mikrotikMessage?: string | null
  createdAt: string
  updatedAt: string
}

export type IpPoolsResponse = {
  pools: IpPool[]
}

export type IpPoolAddressRow = {
  ip: string
  status: 'available' | 'assigned'
  onuId: string | null
  onuIf: string | null
  sn: string | null
  onuName: string | null
}

export type IpPoolAddressesResponse = {
  poolId: string
  gateway: string
  prefix: number
  network: string
  broadcast: string
  total: number
  assigned: number
  available: number
  /** Wide pools are paged: the API caps how many hosts it enumerates. */
  offset: number
  limit: number
  returned: number
  truncated: boolean
  addresses: IpPoolAddressRow[]
}

export type CreateIpPoolBody = {
  oltId: string
  routerId: string
  vlanId: number
  purpose: IpPoolPurpose
  gateway: string
  prefix: number
  name?: string
  dns1?: string
  dns2?: string
}

/** Client-side preview (mirrors API ip-pool.util). */
export function previewNetwork(
  gateway: string,
  prefix: number,
): { network: string; totalUsable: number; error: string | null } {
  try {
    if (!Number.isInteger(prefix) || prefix < 8 || prefix > 30) {
      return { network: '', totalUsable: 0, error: 'Prefijo entre /8 y /30' }
    }
    const parts = gateway.trim().split('.')
    if (parts.length !== 4) {
      return { network: '', totalUsable: 0, error: 'Gateway IPv4 inválido' }
    }
    let gw = 0
    for (const p of parts) {
      const o = Number(p)
      if (!Number.isInteger(o) || o < 0 || o > 255) {
        return { network: '', totalUsable: 0, error: 'Gateway IPv4 inválido' }
      }
      gw = (gw << 8) + o
    }
    gw = gw >>> 0
    const mask = (~0 << (32 - prefix)) >>> 0
    const network = (gw & mask) >>> 0
    const broadcast = (network | (~mask >>> 0)) >>> 0
    if (gw === network || gw === broadcast) {
      return {
        network: '',
        totalUsable: 0,
        error: 'Gateway no puede ser red/broadcast',
      }
    }
    const total = Math.max(0, broadcast - network - 2) // minus net+bcast; gateway also excluded
    const toIp = (n: number) =>
      [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.')
    return {
      network: toIp(network),
      totalUsable: total,
      error: null,
    }
  } catch {
    return { network: '', totalUsable: 0, error: 'Red inválida' }
  }
}
