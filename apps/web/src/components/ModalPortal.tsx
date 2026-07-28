import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { acquireModalVisualViewport } from '../lib/modalVisualViewport'

/**
 * Monta el contenido en document.body para que las modales
 * queden por encima del header/sidebar en móviles reales
 * (evita stacking context del shell).
 * También activa el ajuste al teclado vía visualViewport.
 */
export function ModalPortal({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  useEffect(() => acquireModalVisualViewport(), [])
  if (!mounted) return null
  return createPortal(children, document.body)
}
