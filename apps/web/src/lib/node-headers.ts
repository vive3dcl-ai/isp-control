/** Cabeceras de fibra (ODF) instaladas en nodos físicos. */

export const NODE_HEADER_PORT_COUNTS = [4, 8, 16, 32, 64, 128] as const
export type NodeHeaderPortCount = (typeof NODE_HEADER_PORT_COUNTS)[number]

export type NodeHeaderPort = {
  index: number
  /** Nombre opcional; si falta se muestra el del puerto activo enlazado. */
  name: string
  description: string
  /** Activo de topología (OLT / router) al que conecta el puerto. */
  deviceId: string | null
  /** network_ports.id cuando el activo es router/switch. */
  devicePortId: string | null
  /** Nombre visible del puerto activo (gpon_olt-1/2/3, ether5…). */
  devicePortName: string | null
  /** Pelo del tendido del mapa que alimenta este puerto. */
  cableId: string | null
  tubeId: string | null
  fiberId: string | null
}

export type NodeHeader = {
  id: string
  nodeId: string
  name: string
  description: string
  portCount: number
  ports: NodeHeaderPort[]
  createdAt: string
  updatedAt: string
}

/** Nombre a mostrar del puerto: propio → puerto activo → número. */
export function headerPortLabel(p: NodeHeaderPort): string {
  return p.name || p.devicePortName || `Puerto ${p.index}`
}

/**
 * Etiqueta del enlace de red: «Activo / puerto».
 * Si falta el nombre del activo, muestra solo el puerto.
 */
export function headerPortAssetLabel(
  p: NodeHeaderPort,
  deviceName?: string | null,
): string | null {
  const port = p.devicePortName?.trim() || null
  const device = deviceName?.trim() || null
  if (device && port) return `${device} / ${port}`
  if (port) return port
  if (device) return device
  return null
}

/** Tooltip sin repetir el nombre del puerto activo. */
export function headerPortTooltip(
  p: NodeHeaderPort,
  opts?: {
    deviceName?: string | null
    fiberHint?: string | null
  },
): string {
  const parts: string[] = [`Puerto ${p.index}`]
  const custom = p.name.trim()
  const asset = headerPortAssetLabel(p, opts?.deviceName)
  // Solo muestra nombre propio si aporta algo distinto al enlace activo.
  if (custom && custom !== p.devicePortName?.trim()) {
    parts.push(custom)
  }
  if (asset) parts.push(asset)
  if (opts?.fiberHint) parts.push(opts.fiberHint)
  return parts.join(' · ')
}

/** Puerto con algún enlace (activo de red o pelo del mapa). */
export function headerPortLinked(p: NodeHeaderPort): boolean {
  return !!(p.deviceId || p.devicePortName || p.fiberId)
}

export function emptyHeaderPort(index: number): NodeHeaderPort {
  return {
    index,
    name: '',
    description: '',
    deviceId: null,
    devicePortId: null,
    devicePortName: null,
    cableId: null,
    tubeId: null,
    fiberId: null,
  }
}
