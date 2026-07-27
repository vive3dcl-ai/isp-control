import type { ReactNode } from 'react'

/**
 * Contenedor estándar de modales responsive.
 * - En móvil: ancla arriba y permite scroll del backdrop.
 * - El panel limita altura a la viewport y el cuerpo hace scroll.
 */
export function ModalShell({
  open = true,
  onClose,
  children,
  zClass = 'z-50',
  panelClassName = 'max-w-2xl',
  labelledBy,
}: {
  open?: boolean
  onClose?: () => void
  children: ReactNode
  zClass?: string
  /** Clases extra del panel (p. ej. max-w-6xl). */
  panelClassName?: string
  labelledBy?: string
}) {
  if (!open) return null

  return (
    <div
      className={[
        'fixed inset-0 flex items-start justify-center overflow-y-auto bg-black/60 p-3 sm:items-center sm:p-4',
        zClass,
      ].join(' ')}
    >
      {onClose && (
        <button
          type="button"
          aria-label="Cerrar"
          className="fixed inset-0 cursor-default"
          onClick={onClose}
        />
      )}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        className={[
          'relative my-2 flex max-h-[min(92vh,100dvh)] w-full flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] text-[var(--text)] shadow-xl',
          panelClassName,
        ].join(' ')}
      >
        {children}
      </div>
    </div>
  )
}

export const modalHeaderClass =
  'flex shrink-0 flex-wrap items-start justify-between gap-2 border-b border-[var(--border)] px-4 py-3 sm:px-5 sm:py-4'

export const modalBodyClass =
  'min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5'

export const modalFooterClass =
  'flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-[var(--border)] px-4 py-3 sm:px-5'
