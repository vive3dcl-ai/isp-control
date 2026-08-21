import { useAsistenteChatOptional } from './AsistenteChatContext'

/**
 * Botón del Asistente en el header. Si está minimizado, muestra un chip
 * compacto con pulso; al click abre o expande el panel.
 */
export function AsistenteHeaderButton() {
  const asistente = useAsistenteChatOptional()
  if (!asistente) return null
  if (asistente.moduleLoading || !asistente.moduleEnabled) return null

  const { mode, setOpen, expand, messages, sending } = asistente
  const active = mode === 'open' || mode === 'minimized'
  const unreadHint = mode === 'minimized' && messages.length > 0

  return (
    <button
      type="button"
      id="asistente-header-anchor"
      onClick={() => {
        if (mode === 'minimized') expand()
        else if (mode === 'open') setOpen(false)
        else setOpen(true)
      }}
      className={[
        'asistente-header-btn relative hidden h-9 items-center gap-1.5 rounded-full border px-3 text-sm font-medium transition sm:inline-flex',
        active
          ? 'border-[var(--accent)] bg-[var(--accent)]/15 text-[var(--accent)]'
          : 'border-[var(--border)] text-[var(--text-muted)] hover:border-[var(--accent)]/50 hover:bg-[var(--bg-elevated)] hover:text-[var(--text)]',
        mode === 'minimized' ? 'asistente-header-btn--minimized' : '',
      ].join(' ')}
      aria-label={
        mode === 'minimized'
          ? 'Expandir Asistente'
          : mode === 'open'
            ? 'Cerrar Asistente'
            : 'Abrir Asistente'
      }
      aria-expanded={mode === 'open'}
    >
      <span
        aria-hidden
        className={sending ? 'asistente-sparkle-spin' : undefined}
      >
        ✦
      </span>
      <span>Asistente</span>
      {unreadHint && (
        <span
          className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-[var(--accent)]"
          aria-hidden
        />
      )}
    </button>
  )
}
