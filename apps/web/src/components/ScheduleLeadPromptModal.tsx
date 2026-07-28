import { clientDisplayName, type Client } from '../lib/crm'
import { ModalPortal } from './ModalPortal'


export function ScheduleLeadPromptModal({
  open,
  client,
  onDecline,
  onAccept,
}: {
  open: boolean
  client: Client | null
  onDecline: () => void
  onAccept: () => void
}) {
  if (!open || !client) return null

  return (
    <ModalPortal><div className="fixed inset-0 z-[55] modal-backdrop flex items-stretch justify-center overflow-hidden bg-black/60 sm:items-center sm:p-4">
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-md rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-5 shadow-xl"
      >
        <h2 className="text-lg font-semibold">¿Agendar instalación?</h2>
        <p className="mt-2 text-sm text-[var(--text-muted)]">
          Creaste el lead{' '}
          <span className="font-medium text-[var(--text)]">
            {clientDisplayName(client)}
          </span>
          . ¿Querés agendar la visita de instalación ahora?
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onDecline}
            className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm"
          >
            Ahora no
          </button>
          <button
            type="button"
            onClick={onAccept}
            className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)]"
          >
            Agendar
          </button>
        </div>
      </div>
    </div></ModalPortal>
  )
}
