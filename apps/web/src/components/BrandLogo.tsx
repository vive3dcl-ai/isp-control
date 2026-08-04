import { useBranding } from '../branding/BrandingContext'

/** Logo estático por defecto (PNG transparente, sin fondo). */
export const DEFAULT_BRAND_LOGO_URL = '/branding/isp-control-logo.png'

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
      className={`mx-auto block max-h-full w-auto max-w-full object-contain object-center ${className}`}
      style={{ height, maxHeight: height }}
    />
  )
}
