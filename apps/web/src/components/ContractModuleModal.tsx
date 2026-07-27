import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'
import {
  formatDate,
  formatUsd,
  type ModuleContractQuote,
} from '../lib/platform'

export function ContractModuleModal({
  open,
  moduleId,
  moduleName,
  canWrite,
  onClose,
}: {
  open: boolean
  moduleId: string
  moduleName: string
  canWrite: boolean
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [mode, setMode] = useState<'one_time' | 'recurring'>('one_time')
  const [msg, setMsg] = useState<string | null>(null)

  const quoteQuery = useQuery({
    queryKey: ['app', 'settings', 'modules', moduleId, 'contract-quote', mode],
    queryFn: () =>
      apiFetch<ModuleContractQuote>(
        `/app/settings/modules/${moduleId}/contract-quote?mode=${mode}`,
      ),
    enabled: open && !!moduleId,
    retry: false,
  })

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  useEffect(() => {
    if (open) setMsg(null)
  }, [open, mode])

  const mutation = useMutation({
    mutationFn: () =>
      apiFetch(`/app/settings/modules/${moduleId}/contract`, {
        method: 'POST',
        body: JSON.stringify({ mode }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ['app', 'settings', 'modules'],
      })
      void queryClient.invalidateQueries({
        queryKey: ['app', 'settings', 'subscription'],
      })
      onClose()
    },
    onError: (err: Error) => setMsg(err.message),
  })

  if (!open) return null

  const quote = quoteQuery.data

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 sm:items-center">
      <div
        role="dialog"
        aria-modal="true"
        className="max-h-[min(92vh,100dvh)] overflow-y-auto w-full max-w-md rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold">Contratar módulo</h2>
            <p className="text-sm text-[var(--text-muted)]">{moduleName}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2 py-1 text-[var(--text-muted)] hover:bg-[var(--bg)]"
          >
            ✕
          </button>
        </div>

        <div className="space-y-3 px-5 py-4">
          <p className="text-sm text-[var(--text-muted)]">
            Elige cómo activar el módulo. El cobro queda registrado (Checkout
            Pro de plataforma se engancha después).
          </p>

          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-[var(--border)] p-3">
            <input
              type="radio"
              name="mode"
              checked={mode === 'one_time'}
              onChange={() => setMode('one_time')}
              className="mt-1"
            />
            <span>
              <span className="block text-sm font-medium">Pago único</span>
              <span className="text-xs text-[var(--text-muted)]">
                Prepago de 1 mes, ciclo independiente de tu plan. Aviso al
                admin 5 y 2 días antes de vencer.
              </span>
            </span>
          </label>

          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-[var(--border)] p-3">
            <input
              type="radio"
              name="mode"
              checked={mode === 'recurring'}
              onChange={() => setMode('recurring')}
              className="mt-1"
            />
            <span>
              <span className="block text-sm font-medium">Agregar al plan</span>
              <span className="text-xs text-[var(--text-muted)]">
                Se cobra ahora lo que falta hasta el fin de tu ciclo de
                suscripción; en la renovación se suma al cobro del plan.
              </span>
            </span>
          </label>

          {quoteQuery.isLoading && (
            <p className="text-sm text-[var(--text-muted)]">Calculando…</p>
          )}
          {quoteQuery.error && (
            <p className="text-sm text-[var(--danger)]">
              {(quoteQuery.error as Error).message}
            </p>
          )}

          {quote && (
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-3 text-sm text-emerald-100">
              <p className="font-medium">{quote.chargeLabel}</p>
              <p className="mt-1 text-lg font-semibold">
                {formatUsd(quote.chargeUsd)}
              </p>
              <p className="mt-1 text-xs opacity-80">
                Lista: {formatUsd(quote.monthlyPriceUsd)}/mes
              </p>
              {quote.expiresAt && (
                <p className="mt-1 text-xs opacity-80">
                  Vence: {formatDate(quote.expiresAt)}
                </p>
              )}
              <p className="mt-2 text-xs opacity-90">{quote.note}</p>
            </div>
          )}

          {(msg || mutation.error) && (
            <p className="text-sm text-[var(--danger)]">
              {msg || (mutation.error as Error)?.message}
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-[var(--border)] px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm"
          >
            Cancelar
          </button>
          {canWrite && (
            <button
              type="button"
              disabled={mutation.isPending || !quote || !!quoteQuery.error}
              onClick={() => mutation.mutate()}
              className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-60"
            >
              {mutation.isPending ? 'Contratando…' : 'Confirmar'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
