import { useBranding } from '../branding/BrandingContext'

/** Logo de plataforma o badge con shortName. */
export function BrandMark({
  size = 32,
  className = '',
}: {
  size?: number
  className?: string
}) {
  const b = useBranding()
  if (b.logoUrl) {
    return (
      <img
        src={b.logoUrl}
        alt={b.productName}
        className={`object-contain ${className}`}
        style={{ width: size, height: size }}
      />
    )
  }
  return (
    <span
      className={`inline-flex items-center justify-center rounded-md bg-[var(--accent)] font-bold text-white ${className}`}
      style={{ width: size, height: size, fontSize: Math.max(10, size * 0.32) }}
    >
      {(b.shortName || b.productName).slice(0, 4)}
    </span>
  )
}
