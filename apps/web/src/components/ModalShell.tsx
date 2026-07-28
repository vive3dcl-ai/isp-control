import { useEffect, type ReactNode } from 'react'
import { ModalPortal } from './ModalPortal'

/**
 * Contenedor estándar de modales — un solo scroll.
 * - Portal a document.body (por encima del header en móvil real).
 * - Backdrop fijo sin scroll (evita doble scroll).
 * - Móvil: panel a pantalla completa; se adapta al teclado (visualViewport).
 * - Desktop: panel centrado con max-height.
 * - Solo el body (modalBodyClass) hace scroll.
 */
export function ModalShell({
  open = true,
  onClose,
  children,
  zClass = 'z-[100]',
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
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.classList.add('modal-open')
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.classList.remove('modal-open')
      document.body.style.overflow = prev
    }
  }, [open])

  useEffect(() => {
    if (!open || !onClose) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <ModalPortal>
      <div
        className={[
          'modal-backdrop fixed inset-0 flex items-stretch justify-center overflow-hidden sm:items-center sm:p-4',
          zClass,
        ].join(' ')}
      >
        {onClose && (
          <button
            type="button"
            aria-label="Cerrar"
            className="absolute inset-0 cursor-default bg-black/60"
            onClick={onClose}
          />
        )}
        {!onClose && <div className="absolute inset-0 bg-black/60" aria-hidden />}
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={labelledBy}
          className={[
            'modal-panel relative z-10 flex h-full max-h-full w-full flex-col overflow-hidden border-[var(--border)] bg-[var(--bg-elevated)] text-[var(--text)] shadow-xl',
            'rounded-none border-0',
            'sm:h-auto sm:max-h-[min(92dvh,920px)] sm:rounded-xl sm:border',
            panelClassName,
          ].join(' ')}
        >
          {children}
        </div>
      </div>
    </ModalPortal>
  )
}

export const modalHeaderClass =
  'flex shrink-0 flex-wrap items-start justify-between gap-2 border-b border-[var(--border)] px-4 py-3 sm:px-5 sm:py-4'

export const modalBodyClass =
  'min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5'

export const modalFooterClass =
  'flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-[var(--border)] px-4 py-3 sm:px-5'
