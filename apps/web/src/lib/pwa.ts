import type { PlatformBranding } from './branding'

const MANIFEST_LINK_ID = 'isp-pwa-manifest'
const THEME_META_ID = 'isp-pwa-theme-color'
const PWA_KIND_KEY = 'isp-pwa-kind'
const ADMIN_INSTALLED_KEY = 'isp-pwa-admin-installed'
const TECH_INSTALLED_KEY = 'isp-pwa-tech-installed'
const PUSH_PROMPT_PENDING_KEY = 'isp-push-prompt-pending'
const PUSH_PROMPT_DISMISS_KEY = 'isp-push-prompt-dismissed-at'

export type PwaKind = 'tech' | 'admin'

export function isPwaStandalone() {
  if (typeof window === 'undefined') return false
  const mq = window.matchMedia('(display-mode: standalone)').matches
  const iosStandalone =
    'standalone' in navigator &&
    Boolean((navigator as Navigator & { standalone?: boolean }).standalone)
  return mq || iosStandalone
}

/** @deprecated Prefer isPwaStandalone / isTechPwaSession */
export function isMobilePwaInstalled() {
  return isTechPwaSession()
}

export function isIosDevice() {
  if (typeof navigator === 'undefined') return false
  return /iphone|ipad|ipod/i.test(navigator.userAgent)
}

export function isAndroidDevice() {
  if (typeof navigator === 'undefined') return false
  return /android/i.test(navigator.userAgent)
}

function absoluteUrl(pathOrUrl: string, origin: string) {
  if (!pathOrUrl) return ''
  if (/^https?:\/\//i.test(pathOrUrl) || pathOrUrl.startsWith('data:')) {
    return pathOrUrl
  }
  if (pathOrUrl.startsWith('/')) return `${origin}${pathOrUrl}`
  return `${origin}/${pathOrUrl}`
}

function readKind(): PwaKind | null {
  try {
    const v = sessionStorage.getItem(PWA_KIND_KEY)
    if (v === 'tech' || v === 'admin') return v
  } catch {
    // ignore
  }
  return null
}

function writeKind(kind: PwaKind) {
  try {
    sessionStorage.setItem(PWA_KIND_KEY, kind)
  } catch {
    // ignore
  }
}

/** Marca la sesión PWA según query `source` o heurística de ruta. */
export function syncPwaKindFromLocation() {
  if (typeof window === 'undefined') return
  const params = new URLSearchParams(window.location.search)
  const source = params.get('source')
  if (source === 'pwa' || source === 'pwa-tech') {
    writeKind('tech')
    return
  }
  if (source === 'pwa-admin') {
    writeKind('admin')
    return
  }
  if (!isPwaStandalone()) return
  if (readKind()) return
  // Primera carga standalone sin source: inferir por ruta.
  if (window.location.pathname.startsWith('/movil')) {
    writeKind('tech')
  } else {
    writeKind('admin')
  }
}

export function isTechPwaSession() {
  if (typeof window === 'undefined') return false
  syncPwaKindFromLocation()
  if (!isPwaStandalone()) return false
  return readKind() === 'tech'
}

export function isAdminPwaSession() {
  if (typeof window === 'undefined') return false
  syncPwaKindFromLocation()
  if (!isPwaStandalone()) return false
  return readKind() === 'admin'
}

export function markPwaInstalled(kind: PwaKind) {
  try {
    localStorage.setItem(
      kind === 'admin' ? ADMIN_INSTALLED_KEY : TECH_INSTALLED_KEY,
      '1',
    )
    // Pedir permisos de notificación en la siguiente sesión autenticada.
    localStorage.setItem(PUSH_PROMPT_PENDING_KEY, '1')
  } catch {
    // ignore
  }
}

export function markPushPromptPending() {
  try {
    localStorage.setItem(PUSH_PROMPT_PENDING_KEY, '1')
  } catch {
    // ignore
  }
}

export function clearPushPromptPending() {
  try {
    localStorage.removeItem(PUSH_PROMPT_PENDING_KEY)
  } catch {
    // ignore
  }
}

export function isPushPromptPending() {
  try {
    return localStorage.getItem(PUSH_PROMPT_PENDING_KEY) === '1'
  } catch {
    return false
  }
}

export function wasPushPromptDismissedRecently(cooldownMs = 7 * 24 * 60 * 60 * 1000) {
  try {
    const raw = localStorage.getItem(PUSH_PROMPT_DISMISS_KEY)
    if (!raw) return false
    const ts = Number(raw)
    if (!Number.isFinite(ts)) return false
    return Date.now() - ts < cooldownMs
  } catch {
    return false
  }
}

export function dismissPushPrompt() {
  try {
    localStorage.setItem(PUSH_PROMPT_DISMISS_KEY, String(Date.now()))
    localStorage.removeItem(PUSH_PROMPT_PENDING_KEY)
  } catch {
    // ignore
  }
}

export function isAdminPwaInstalled() {
  if (isAdminPwaSession()) return true
  try {
    return localStorage.getItem(ADMIN_INSTALLED_KEY) === '1'
  } catch {
    return false
  }
}

function iconFor(branding: PlatformBranding, origin: string) {
  const iconSrc =
    absoluteUrl(branding.faviconUrl || branding.logoUrl || '/favicon.png', origin) ||
    `${origin}/favicon.png`
  const iconType = iconSrc.includes('data:image/svg') || iconSrc.includes('.svg')
    ? 'image/svg+xml'
    : iconSrc.includes('.webp')
      ? 'image/webp'
      : iconSrc.includes('.jpg') || iconSrc.includes('.jpeg')
        ? 'image/jpeg'
        : 'image/png'
  return { iconSrc, iconType }
}

function upsertMeta(name: string, content: string) {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)
  if (!el) {
    el = document.createElement('meta')
    el.name = name
    document.head.appendChild(el)
  }
  el.content = content
}

function applyManifestDocument(
  branding: PlatformBranding,
  manifest: Record<string, unknown>,
  themeColor: string,
) {
  const { iconSrc } = iconFor(branding, window.location.origin)
  const blob = new Blob([JSON.stringify(manifest)], {
    type: 'application/manifest+json',
  })
  const url = URL.createObjectURL(blob)

  let link = document.getElementById(MANIFEST_LINK_ID) as HTMLLinkElement | null
  if (!link) {
    link = document.createElement('link')
    link.id = MANIFEST_LINK_ID
    link.rel = 'manifest'
    document.head.appendChild(link)
  } else if (link.href.startsWith('blob:')) {
    URL.revokeObjectURL(link.href)
  }
  link.href = url

  let theme = document.getElementById(THEME_META_ID) as HTMLMetaElement | null
  if (!theme) {
    theme = document.createElement('meta')
    theme.id = THEME_META_ID
    theme.name = 'theme-color'
    document.head.appendChild(theme)
  }
  theme.content = themeColor

  upsertMeta('apple-mobile-web-app-capable', 'yes')
  upsertMeta('apple-mobile-web-app-status-bar-style', 'black-translucent')
  upsertMeta(
    'apple-mobile-web-app-title',
    String(manifest.short_name || branding.shortName || 'ISP').slice(0, 12),
  )
  upsertMeta('mobile-web-app-capable', 'yes')

  let appleIcon = document.querySelector<HTMLLinkElement>(
    'link[rel="apple-touch-icon"]',
  )
  if (!appleIcon) {
    appleIcon = document.createElement('link')
    appleIcon.rel = 'apple-touch-icon'
    document.head.appendChild(appleIcon)
  }
  appleIcon.href = iconSrc
}

/** PWA técnicos: solo /movil. */
export function applyTechPwaManifest(branding: PlatformBranding) {
  if (typeof window === 'undefined' || typeof document === 'undefined') return

  const origin = window.location.origin
  const { iconSrc, iconType } = iconFor(branding, origin)
  const short =
    `${branding.shortName || branding.productName || 'ISP'} Téc`.slice(0, 12)

  applyManifestDocument(
    branding,
    {
      id: `${origin}/movil`,
      name: 'Técnico ISP',
      short_name: short,
      description:
        branding.metaDescription ||
        'App de campo: instalar, calendario, mapa y postes.',
      start_url: `${origin}/movil?source=pwa-tech`,
      scope: `${origin}/movil`,
      display: 'standalone',
      orientation: 'portrait-primary',
      background_color: '#0c1219',
      theme_color: '#0c1219',
      lang: 'es',
      dir: 'ltr',
      icons: [
        {
          src: iconSrc,
          sizes: '192x192',
          type: iconType,
          purpose: 'any',
        },
        {
          src: iconSrc,
          sizes: '512x512',
          type: iconType,
          purpose: 'any maskable',
        },
      ],
    },
    '#0c1219',
  )
}

/** @deprecated Prefer applyTechPwaManifest */
export function applyMobilePwaManifest(branding: PlatformBranding) {
  applyTechPwaManifest(branding)
}

/** PWA administración: panel completo (/login, /app, /admin). */
export function applyAdminPwaManifest(branding: PlatformBranding) {
  if (typeof window === 'undefined' || typeof document === 'undefined') return

  const origin = window.location.origin
  const { iconSrc, iconType } = iconFor(branding, origin)
  const short = `Admin ${branding.shortName || 'ISP'}`.slice(0, 12)

  applyManifestDocument(
    branding,
    {
      id: `${origin}/admin-app`,
      name: 'Administración ISP',
      short_name: short,
      description:
        branding.metaDescription ||
        'Panel completo: clientes, red, facturación y operaciones.',
      start_url: `${origin}/login?source=pwa-admin`,
      scope: `${origin}/`,
      display: 'standalone',
      orientation: 'any',
      background_color: '#0c1219',
      theme_color: '#0c1219',
      lang: 'es',
      dir: 'ltr',
      icons: [
        {
          src: iconSrc,
          sizes: '192x192',
          type: iconType,
          purpose: 'any',
        },
        {
          src: iconSrc,
          sizes: '512x512',
          type: iconType,
          purpose: 'any maskable',
        },
      ],
    },
    '#0c1219',
  )
}

export async function registerAppServiceWorker() {
  if (!('serviceWorker' in navigator)) return null
  try {
    const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' })
    await navigator.serviceWorker.ready
    return reg
  } catch {
    return null
  }
}

/** @deprecated Prefer registerAppServiceWorker */
export async function registerMobileServiceWorker() {
  return registerAppServiceWorker()
}
