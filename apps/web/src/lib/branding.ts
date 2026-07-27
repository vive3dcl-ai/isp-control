export type PlatformBranding = {
  productName: string
  shortName: string
  pageTitle: string
  metaDescription: string
  metaKeywords: string
  logoUrl: string
  faviconUrl: string
  ogImageUrl: string
  footerText: string
  footerCopyright: string
  loginTagline: string
  raw?: {
    productName: string
    shortName: string
    pageTitle: string
    metaDescription: string
    metaKeywords: string
    logoUrl: string
    faviconUrl: string
    ogImageUrl: string
    footerText: string
    footerCopyright: string
    loginTagline: string
  }
}

export const DEFAULT_PLATFORM_BRANDING: PlatformBranding = {
  productName: 'ISP Control',
  shortName: 'ISP',
  pageTitle: 'ISP Control',
  metaDescription:
    'Plataforma multi-tenant para ISP: CRM, red, facturación y operaciones.',
  metaKeywords: 'ISP, CRM, fibra, OLT, facturación',
  logoUrl: '',
  faviconUrl: '',
  ogImageUrl: '',
  footerText: 'ISP Control · multi-tenant',
  footerCopyright: '© ISP Control',
  loginTagline: 'Acceso unificado para administradores y empresas',
}

function upsertMeta(
  attr: 'name' | 'property',
  key: string,
  content: string,
) {
  if (!content) return
  let el = document.head.querySelector<HTMLMetaElement>(
    `meta[${attr}="${key}"]`,
  )
  if (!el) {
    el = document.createElement('meta')
    el.setAttribute(attr, key)
    document.head.appendChild(el)
  }
  el.content = content
}

function upsertLink(rel: string, href: string, type?: string) {
  if (!href) return
  let el = document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`)
  if (!el) {
    el = document.createElement('link')
    el.rel = rel
    document.head.appendChild(el)
  }
  el.href = href
  if (type) el.type = type
}

/** Aplica título, meta SEO, favicon y Open Graph al documento. */
export function applyPlatformBrandingToDocument(b: PlatformBranding) {
  document.title = b.pageTitle || b.productName
  upsertMeta('name', 'description', b.metaDescription)
  upsertMeta('name', 'keywords', b.metaKeywords)
  upsertMeta('property', 'og:title', b.pageTitle || b.productName)
  upsertMeta('property', 'og:description', b.metaDescription)
  upsertMeta('property', 'og:type', 'website')
  if (b.ogImageUrl) {
    upsertMeta('property', 'og:image', b.ogImageUrl)
  }
  if (b.faviconUrl) {
    const isSvg = b.faviconUrl.includes('image/svg') || b.faviconUrl.endsWith('.svg')
    upsertLink('icon', b.faviconUrl, isSvg ? 'image/svg+xml' : undefined)
  }
}
