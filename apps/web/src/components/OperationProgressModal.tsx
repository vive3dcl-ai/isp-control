import type { ReactNode } from 'react'
import { ModalPortal } from './ModalPortal'


export type ProgressStepStatus =
  | 'pending'
  | 'running'
  | 'done'
  | 'error'
  | 'skipped'

export type ProgressStep = {
  id: string
  label: string
  status: ProgressStepStatus
  detail?: string | null
}

function StepIcon({ status }: { status: ProgressStepStatus }) {
  if (status === 'done') {
    return (
      <span
        className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-600/20 text-xs text-emerald-400"
        aria-hidden
      >
        ✓
      </span>
    )
  }
  if (status === 'error') {
    return (
      <span
        className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--danger)]/20 text-xs text-[var(--danger)]"
        aria-hidden
      >
        !
      </span>
    )
  }
  if (status === 'running') {
    return (
      <span
        className="h-5 w-5 animate-spin rounded-full border-2 border-[var(--accent)] border-t-transparent"
        aria-hidden
      />
    )
  }
  return (
    <span
      className="flex h-5 w-5 items-center justify-center rounded-full border border-[var(--border)] text-[10px] text-[var(--text-muted)]"
      aria-hidden
    >
      ·
    </span>
  )
}

/**
 * Modal de progreso paso a paso.
 * Reintentar solo vuelve a ejecutar pasos en error / pending (los `done` no se repiten).
 */
export function OperationProgressModal({
  open,
  title,
  steps,
  running,
  failed,
  allDone,
  onRetry,
  onClose,
  children,
}: {
  open: boolean
  title: string
  steps: ProgressStep[]
  running: boolean
  failed: boolean
  allDone: boolean
  onRetry?: () => void
  onClose: () => void
  children?: ReactNode
}) {
  if (!open) return null

  const doneCount = steps.filter((s) => s.status === 'done').length

  return (
    <ModalPortal><div className="fixed inset-0 z-[120] modal-backdrop flex items-stretch justify-center overflow-hidden bg-black/60 sm:items-center sm:p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="progress-modal-title"
        className="h-[100dvh] max-h-[100dvh] overflow-y-auto overscroll-contain w-full max-w-md rounded-none border-0 sm:h-auto sm:max-h-[min(92dvh,920px)] sm:rounded-xl sm:border border-[var(--border)] bg-[var(--bg-elevated)] text-[var(--text)] shadow-xl"
      >
        <div className="border-b border-[var(--border)] px-5 py-4">
          <h3 id="progress-modal-title" className="text-lg font-semibold">
            {title}
          </h3>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            {allDone
              ? 'Todo listo'
              : failed
                ? 'Hay errores — puedes reintentar solo lo pendiente'
                : running
                  ? `Progreso ${doneCount}/${steps.length}`
                  : `Pasos ${doneCount}/${steps.length}`}
          </p>
        </div>

        <ul className="max-h-[50vh] space-y-2 overflow-y-auto px-5 py-4">
          {steps.map((s) => (
            <li key={s.id} className="flex gap-3 text-sm">
              <StepIcon status={s.status} />
              <div className="min-w-0 flex-1">
                <p
                  className={
                    s.status === 'error'
                      ? 'text-[var(--danger)]'
                      : s.status === 'done'
                        ? 'text-[var(--text)]'
                        : s.status === 'running'
                          ? 'text-[var(--accent)]'
                          : 'text-[var(--text-muted)]'
                  }
                >
                  {s.label}
                </p>
                {s.detail && (
                  <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                    {s.detail}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ul>

        {children}

        <div className="flex flex-wrap justify-end gap-2 border-t border-[var(--border)] px-5 py-3">
          {failed && onRetry && (
            <button
              type="button"
              disabled={running}
              onClick={onRetry}
              className="rounded-lg border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-sm font-medium text-amber-200 hover:bg-amber-500/20 disabled:opacity-50"
            >
              Reintentar pendientes
            </button>
          )}
          <button
            type="button"
            disabled={running}
            onClick={onClose}
            className={[
              'rounded-lg px-3 py-2 text-sm font-medium',
              allDone
                ? 'bg-emerald-600 text-white hover:bg-emerald-500'
                : 'border border-[var(--border)]',
              running ? 'opacity-50' : '',
            ].join(' ')}
          >
            {allDone ? 'Listo' : running ? 'Trabajando…' : 'Cerrar'}
          </button>
        </div>
      </div>
    </div></ModalPortal>
  )
}

/** Run steps sequentially; skips any already `done`. */
export async function runProgressSteps(
  steps: ProgressStep[],
  setSteps: (next: ProgressStep[]) => void,
  runners: Record<string, () => Promise<string | void>>,
): Promise<{ ok: boolean; steps: ProgressStep[] }> {
  let current = [...steps]
  const patch = (id: string, partial: Partial<ProgressStep>) => {
    current = current.map((s) => (s.id === id ? { ...s, ...partial } : s))
    setSteps(current)
  }

  for (const step of current) {
    if (step.status === 'done') continue
    const run = runners[step.id]
    if (!run) {
      patch(step.id, { status: 'skipped', detail: 'Sin acción' })
      continue
    }
    patch(step.id, { status: 'running', detail: null })
    try {
      const detail = await run()
      patch(step.id, {
        status: 'done',
        detail: detail || 'OK',
      })
    } catch (e) {
      patch(step.id, {
        status: 'error',
        detail: e instanceof Error ? e.message : String(e),
      })
      return { ok: false, steps: current }
    }
  }

  return { ok: true, steps: current }
}
