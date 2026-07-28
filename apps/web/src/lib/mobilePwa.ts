import type { PlatformBranding } from './branding'

const MANIFEST_LINK_ID = 'isp-mobile-manifest'
const THEME_META_ID = 'isp-mobile-theme-color'

export function isMobilePwaInstalled() {
  if (typeof window === 'undefined') return false
  const mq = window.matchMedia('(display-mode: standalone)').matches
  const iosStandalone =
    'standalone' in navigator &&
    Boolean((navigator as Navigator & { standalone?: boolean }).standalone)
  return mq || iosStandalone
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

/** Manifest dinámico según branding + origen actual (dominio del panel). */
export function applyMobilePwaManifest(branding: PlatformBranding) {
  if (typeof window === 'undefined' || typeof document === 'undefined') return

  const origin = window.location.origin
  const name = `${branding.productName || 'ISP Control'} Móvil`
  const shortName = (branding.shortName || 'ISP').slice(0, 12)
  const iconSrc =
    absoluteUrl(branding.logoUrl || branding.faviconUrl || '/favicon.svg', origin) ||
    `${origin}/favicon.svg`

  const manifest = {
    id: `${origin}/movil`,
    name,
    short_name: shortName,
    description:
      branding.metaDescription ||
      'App de campo: instalar, calendario, mapa y postes.',
    start_url: `${origin}/movil?source=pwa`,
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
        type: iconSrc.includes('svg') ? 'image/svg+xml' : 'image/png',
        purpose: 'any',
      },
      {
        src: iconSrc,
        sizes: '512x512',
        type: iconSrc.includes('svg') ? 'image/svg+xml' : 'image/png',
        purpose: 'any maskable',
      },
    ],
  }

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
  theme.content = '#0c1219'

  upsertMeta('apple-mobile-web-app-capable', 'yes')
  upsertMeta('apple-mobile-web-app-status-bar-style', 'black-translucent')
  upsertMeta('apple-mobile-web-app-title', shortName)
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

function upsertMeta(name: string, content: string) {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)
  if (!el) {
    el = document.createElement('meta')
    el.name = name
    document.head.appendChild(el)
  }
  el.content = content
}

export async function registerMobileServiceWorker() {
  if (!('serviceWorker' in navigator)) return null
  try {
    const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' })
    await navigator.serviceWorker.ready
    return reg
  } catch {
    return null
  }
}
