import { ModalPortal } from './ModalPortal'
type Props = {
  title: string
  subtitle?: string
  body: string
  loading?: boolean
  error?: string | null
  onClose: () => void
}

/** Strip OLT hostname prompts (ZXAN#, etc.) from displayed CLI text. */
function stripOltPrompts(text: string): string {
  return text
    .replace(/^[A-Za-z0-9_./()-]+(?:\([^)\n]*\))?[>#]\s*$/gm, '')
    .replace(/\s+[A-Za-z0-9_./()-]+(?:\([^)\n]*\))?[>#]\s*$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Modal monospace for SmartOLT-style CLI status / config / SW info. */
export function OnuCliReportModal({
  title,
  subtitle,
  body,
  loading,
  error,
  onClose,
}: Props) {
  const cleaned = stripOltPrompts(body)
  return (
    <ModalPortal><div className="fixed inset-0 z-[100] modal-backdrop flex items-stretch justify-center overflow-hidden bg-black/70 sm:items-center sm:p-4">
      <div className="flex h-[100dvh] max-h-[100dvh] w-full max-w-3xl flex-col overflow-hidden rounded-none border-0 sm:h-auto sm:max-h-[min(92dvh,920px)] sm:rounded-xl sm:border border-[var(--border)] bg-[var(--bg-elevated)] shadow-xl">
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-[var(--border)] px-5 py-3">
          <div className="min-w-0">
            <h3 className="text-lg font-semibold">{title}</h3>
            {subtitle ? (
              <p className="mt-0.5 truncate font-mono text-xs text-[var(--text-muted)]">
                {subtitle}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            className="rounded-md px-2 py-1 text-[var(--text-muted)] hover:bg-[var(--bg)]"
            onClick={onClose}
          >
            ✕
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
          {loading && (
            <p className="text-sm text-[var(--text-muted)]">Consultando OLT…</p>
          )}
          {error && <p className="text-sm text-[var(--danger)]">{error}</p>}
          {!loading && !error && (
            <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-[var(--text)] sm:text-xs">
              {cleaned || '(vacío)'}
            </pre>
          )}
        </div>
        <div className="flex shrink-0 justify-end border-t border-[var(--border)] px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm hover:bg-[var(--bg)]"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div></ModalPortal>
  )
}
