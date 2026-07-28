import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { acquireModalVisualViewport } from '../lib/modalVisualViewport'

/**
 * Cada portal toma un z-index creciente.
 * Así una modal abierta encima de otra siempre queda al frente,
 * aunque su className tenga un z-* más bajo.
 */
const openLayers: number[] = []

function allocLayerZ(): number {
  const top = openLayers.length ? openLayers[openLayers.length - 1]! : 100
  const z = top + 10
  openLayers.push(z)
  return z
}

function releaseLayerZ(z: number) {
  const i = openLayers.lastIndexOf(z)
  if (i >= 0) openLayers.splice(i, 1)
}

/**
 * Monta el contenido en document.body para que las modales
 * queden por encima del header/sidebar en móviles reales
 * (evita stacking context del shell).
 * También activa el ajuste al teclado vía visualViewport.
 */
export function ModalPortal({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false)
  const zRef = useRef<number | null>(null)
  if (zRef.current === null) {
    zRef.current = allocLayerZ()
  }

  useEffect(() => {
    setMounted(true)
    const z = zRef.current!
    return () => releaseLayerZ(z)
  }, [])
  useEffect(() => acquireModalVisualViewport(), [])

  if (!mounted) return null

  return createPortal(
    <div
      className="isp-modal-layer"
      style={{ zIndex: zRef.current }}
      data-modal-layer={zRef.current ?? undefined}
    >
      {children}
    </div>,
    document.body,
  )
}
