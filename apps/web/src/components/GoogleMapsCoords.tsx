import { useState } from 'react'
import { formatCoords, googleMapsUrl } from '../lib/maps'

function CopyIcon({ className = 'h-3.5 w-3.5' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      className={className}
      aria-hidden
    >
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
      <path d="M10.5 5.5V4a1.5 1.5 0 0 0-1.5-1.5H4A1.5 1.5 0 0 0 2.5 4v5A1.5 1.5 0 0 0 4 10.5h1.5" />
    </svg>
  )
}

/**
 * Muestra lat/lng en vista (no edición) con icono para copiar el enlace
 * de Google Maps y botón Abrir.
 *
 * - `stacked` (default): coords + icono, debajo botón Abrir a ancho completo
 * - `inline`: fila compacta (listas / modales)
 */
export function GoogleMapsCoords({
  lat,
  lng,
  className = '',
  layout = 'stacked',
}: {
  lat: number
  lng: number
  className?: string
  layout?: 'stacked' | 'inline'
}) {
  const [copied, setCopied] = useState(false)
  const url = googleMapsUrl(lat, lng)
  const label = formatCoords(lat, lng)

  async function copyLink() {
    try {
      await navigator.clipboard?.writeText(url)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      /* ignore */
    }
  }

  const copyBtn = (
    <button
      type="button"
      onClick={() => void copyLink()}
      title={copied ? 'Copiado' : 'Copiar enlace de Google Maps'}
      aria-label={copied ? 'Copiado' : 'Copiar enlace de Google Maps'}
      className={`rounded p-1 hover:bg-[var(--bg)] hover:text-[var(--accent)] ${
        copied ? 'text-emerald-400' : ''
      }`}
    >
      <CopyIcon />
    </button>
  )

  if (layout === 'inline') {
    return (
      <div
        className={`flex flex-wrap items-center gap-2 text-xs text-[var(--text-muted)] ${className}`}
      >
        <span className="font-mono">{label}</span>
        {copyBtn}
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="rounded-md border border-[var(--border)] px-2 py-1 text-[11px] font-medium hover:border-[var(--accent)] hover:text-[var(--accent)]"
        >
          Abrir
        </a>
      </div>
    )
  }

  return (
    <div className={`space-y-2 ${className}`}>
      <div className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
        <span className="font-mono">{label}</span>
        {copyBtn}
      </div>
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="inline-flex w-full items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm font-medium hover:border-[var(--accent)] hover:text-[var(--accent)]"
      >
        Abrir en Maps
      </a>
    </div>
  )
}
