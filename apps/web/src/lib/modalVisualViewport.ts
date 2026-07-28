/**
 * Sincroniza CSS vars del visualViewport para que las modales
 * se encojan cuando aparece el teclado en móvil (iOS/Android).
 */
let listeners = 0

function syncVisualViewportVars() {
  const vv = window.visualViewport
  const root = document.documentElement
  if (!vv) {
    root.style.setProperty('--vv-height', `${window.innerHeight}px`)
    root.style.setProperty('--vv-width', `${window.innerWidth}px`)
    root.style.setProperty('--vv-top', '0px')
    root.style.setProperty('--vv-left', '0px')
    return
  }
  root.style.setProperty('--vv-height', `${vv.height}px`)
  root.style.setProperty('--vv-width', `${vv.width}px`)
  root.style.setProperty('--vv-top', `${vv.offsetTop}px`)
  root.style.setProperty('--vv-left', `${vv.offsetLeft}px`)
}

function onFocusIn(e: FocusEvent) {
  const el = e.target
  if (!(el instanceof HTMLElement)) return
  if (!el.closest('.modal-backdrop')) return
  if (
    el.tagName !== 'INPUT' &&
    el.tagName !== 'TEXTAREA' &&
    el.tagName !== 'SELECT' &&
    !el.isContentEditable
  ) {
    return
  }
  // Esperar animación del teclado y luego centrar el campo
  window.setTimeout(() => {
    el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' })
  }, 280)
}

export function acquireModalVisualViewport() {
  if (typeof window === 'undefined') return () => {}
  listeners += 1
  if (listeners === 1) {
    syncVisualViewportVars()
    const vv = window.visualViewport
    vv?.addEventListener('resize', syncVisualViewportVars)
    vv?.addEventListener('scroll', syncVisualViewportVars)
    window.addEventListener('resize', syncVisualViewportVars)
    document.addEventListener('focusin', onFocusIn)
  }
  return () => {
    listeners = Math.max(0, listeners - 1)
    if (listeners === 0) {
      const vv = window.visualViewport
      vv?.removeEventListener('resize', syncVisualViewportVars)
      vv?.removeEventListener('scroll', syncVisualViewportVars)
      window.removeEventListener('resize', syncVisualViewportVars)
      document.removeEventListener('focusin', onFocusIn)
      const root = document.documentElement
      root.style.removeProperty('--vv-height')
      root.style.removeProperty('--vv-width')
      root.style.removeProperty('--vv-top')
      root.style.removeProperty('--vv-left')
    }
  }
}
