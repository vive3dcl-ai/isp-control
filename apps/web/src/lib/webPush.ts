import { apiFetch } from './api'

type PushAudienceVariant = 'admin' | 'tenant'

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const output = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i)
  return output
}

function prefixFor(variant: PushAudienceVariant) {
  return variant === 'admin' ? '/admin' : '/app'
}

export function pushSupported() {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  )
}

export function pushPermission(): NotificationPermission | 'unsupported' {
  if (!pushSupported()) return 'unsupported'
  return Notification.permission
}

async function ensureServiceWorker() {
  const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' })
  await navigator.serviceWorker.ready
  return reg
}

/** Suscribe el dispositivo si ya hay permiso; no pide permiso. */
export async function syncPushSubscription(
  variant: PushAudienceVariant,
): Promise<{ ok: boolean; reason?: string }> {
  if (!pushSupported()) return { ok: false, reason: 'unsupported' }
  if (Notification.permission !== 'granted') {
    return { ok: false, reason: 'permission' }
  }

  const meta = await apiFetch<{ enabled: boolean; publicKey: string | null }>(
    `${prefixFor(variant)}/push/vapid-public-key`,
  )
  if (!meta.enabled || !meta.publicKey) {
    return { ok: false, reason: 'disabled' }
  }

  const reg = await ensureServiceWorker()
  let sub = await reg.pushManager.getSubscription()
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(meta.publicKey),
    })
  }

  const json = sub.toJSON()
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
    return { ok: false, reason: 'invalid' }
  }

  await apiFetch(`${prefixFor(variant)}/push/subscribe`, {
    method: 'POST',
    body: JSON.stringify({
      endpoint: json.endpoint,
      keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
      userAgent: navigator.userAgent,
    }),
  })

  return { ok: true }
}

/** Pide permiso al usuario y suscribe. */
export async function enablePushNotifications(
  variant: PushAudienceVariant,
): Promise<{ ok: boolean; reason?: string }> {
  if (!pushSupported()) return { ok: false, reason: 'unsupported' }

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    return { ok: false, reason: 'denied' }
  }

  return syncPushSubscription(variant)
}

export async function disablePushNotifications(
  variant: PushAudienceVariant,
): Promise<void> {
  if (!pushSupported()) return
  const reg = await navigator.serviceWorker.getRegistration('/')
  const sub = await reg?.pushManager.getSubscription()
  if (!sub) return
  const endpoint = sub.endpoint
  try {
    await apiFetch(`${prefixFor(variant)}/push/subscribe`, {
      method: 'DELETE',
      body: JSON.stringify({ endpoint }),
    })
  } catch {
    // ignore
  }
  await sub.unsubscribe()
}
