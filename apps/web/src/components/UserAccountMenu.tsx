import { useEffect, useRef, useState } from 'react'
import { AccountSettingsModal } from './AccountSettingsModal'

export function UserAccountMenu({
  displayName,
  subtitle,
  canEditAccount,
  onLogout,
}: {
  displayName: string
  subtitle?: string
  canEditAccount: boolean
  onLogout: () => void | Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <>
      <div className="relative" ref={rootRef}>
        <button
          type="button"
          aria-expanded={open}
          aria-haspopup="menu"
          onClick={() => setOpen((v) => !v)}
          className="inline-flex h-8 max-w-[11rem] items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2.5 text-sm transition hover:border-[var(--accent)] hover:text-[var(--accent)] sm:max-w-[14rem]"
          title={displayName}
        >
          <span className="min-w-0 truncate font-medium">{displayName}</span>
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="shrink-0 opacity-60"
            aria-hidden
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>

        {open && (
          <div
            role="menu"
            className="absolute right-0 z-50 mt-1.5 min-w-[11rem] overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] py-1 shadow-lg"
          >
            {subtitle && (
              <p className="truncate border-b border-[var(--border)] px-3 py-1.5 text-[11px] text-[var(--text-muted)]">
                {subtitle}
              </p>
            )}
            {canEditAccount && (
              <button
                type="button"
                role="menuitem"
                className="flex w-full px-3 py-2 text-left text-sm transition hover:bg-[var(--bg)]"
                onClick={() => {
                  setOpen(false)
                  setSettingsOpen(true)
                }}
              >
                Ajustes
              </button>
            )}
            <button
              type="button"
              role="menuitem"
              className="flex w-full px-3 py-2 text-left text-sm text-[var(--danger)] transition hover:bg-[var(--bg)]"
              onClick={() => {
                setOpen(false)
                void onLogout()
              }}
            >
              Salir
            </button>
          </div>
        )}
      </div>

      <AccountSettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />
    </>
  )
}
