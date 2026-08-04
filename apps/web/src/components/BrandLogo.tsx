import { useBranding } from '../branding/BrandingContext'

/** Logo estático por defecto (wordmark horizontal). */
export const DEFAULT_BRAND_LOGO_URL = '/branding/isp-control-logo.jpg'

/**
 * Wordmark del producto para headers / login.
 * Usa logo de plataforma si está configurado; si no, el logo oficial.
 */
export function BrandLogo({
  height = 36,
  className = '',
}: {
  height?: number
  className?: string
}) {
  const b = useBranding()
  const src = (b.logoUrl || '').trim() || DEFAULT_BRAND_LOGO_URL
  return (
    <img
      src={src}
      alt={b.productName}
      className={`block object-contain object-left ${className}`}
      style={{ height, width: 'auto', maxWidth: '100%' }}
    />
  )
}
