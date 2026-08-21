export type NotificationNavMeta = {
  onuId?: string
  oltId?: string
  sn?: string
  deviceId?: string
  deviceType?: string
  nodeId?: string
  kind?: string
}

function metaString(
  meta: Record<string, unknown> | null | undefined,
  key: keyof NotificationNavMeta,
): string {
  const v = meta?.[key]
  return typeof v === 'string' && v.trim() ? v.trim() : ''
}

/** Ruta tenant con query params para abrir la entidad al llegar. */
export function buildNotificationHref(
  type: string,
  link: string,
  meta?: Record<string, unknown> | null,
): string {
  if (type === 'network_alarm') {
    const onuId = metaString(meta, 'onuId')
    if (onuId) {
      return `/app/settings?tab=onus&onuId=${encodeURIComponent(onuId)}`
    }
    return '/app/settings?tab=onus'
  }
  if (type === 'device_down') {
    const deviceId = metaString(meta, 'deviceId')
    if (deviceId) {
      return `/app/topology?deviceId=${encodeURIComponent(deviceId)}`
    }
    return '/app/topology'
  }
  return link?.trim() || '#'
}

export function buildOnuAlertHref(onuId: string): string {
  return `/app/settings?tab=onus&onuId=${encodeURIComponent(onuId)}`
}

export function buildDeviceAlertHref(deviceId: string): string {
  return `/app/topology?deviceId=${encodeURIComponent(deviceId)}`
}
