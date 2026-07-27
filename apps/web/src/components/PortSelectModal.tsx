import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'
import {
  deviceTypeLabel,
  type PortCandidateDevice,
} from '../lib/topology'

export function PortSelectModal({
  open,
  onClose,
  sourcePortId,
}: {
  open: boolean
  onClose: () => void
  sourcePortId: string | null
}) {
  const queryClient = useQueryClient()
  const [expanded, setExpanded] = useState<string | null>(null)

  const candidatesQuery = useQuery({
    queryKey: ['app', 'topology', 'candidates', sourcePortId],
    queryFn: () =>
      apiFetch<PortCandidateDevice[]>(
        `/app/topology/ports/${sourcePortId}/candidates`,
      ),
    enabled: open && !!sourcePortId,
  })

  useEffect(() => {
    if (!open) {
      setExpanded(null)
      return
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const linkMutation = useMutation({
    mutationFn: (portBId: string) =>
      apiFetch('/app/topology/links', {
        method: 'POST',
        body: JSON.stringify({ portAId: sourcePortId, portBId }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['app', 'topology'] })
      onClose()
    },
  })

  if (!open || !sourcePortId) return null

  const devices = candidatesQuery.data ?? []

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/60 p-4 sm:items-center">
      <div
        role="dialog"
        aria-modal="true"
        className="max-h-[min(92vh,100dvh)] overflow-y-auto w-full max-w-lg rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
          <h2 className="text-lg font-semibold">Seleccionar destino</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2 py-1 text-[var(--text-muted)] hover:bg-[var(--bg)]"
          >
            ✕
          </button>
        </div>

        <div className="max-h-[60vh] overflow-y-auto px-5 py-4">
          {candidatesQuery.isLoading && (
            <p className="text-sm text-[var(--text-muted)]">Cargando…</p>
          )}
          {candidatesQuery.error && (
            <p className="text-sm text-[var(--danger)]">
              {candidatesQuery.error.message}
            </p>
          )}
          {!candidatesQuery.isLoading && devices.length === 0 && (
            <p className="text-sm text-[var(--text-muted)]">
              No hay puertos libres en otros dispositivos.
            </p>
          )}
          <ul className="space-y-2">
            {devices.map((d) => (
              <li
                key={d.id}
                className="rounded-lg border border-[var(--border)]"
              >
                <button
                  type="button"
                  className="flex w-full items-center justify-between px-3 py-2.5 text-left text-sm hover:bg-[var(--bg)]"
                  onClick={() =>
                    setExpanded((prev) => (prev === d.id ? null : d.id))
                  }
                >
                  <span>
                    <span className="font-medium">{d.name}</span>
                    <span className="ml-2 text-[var(--text-muted)]">
                      {deviceTypeLabel[d.type]}
                    </span>
                  </span>
                  <span className="text-xs text-[var(--text-muted)]">
                    {d.ports.length} libre(s)
                  </span>
                </button>
                {expanded === d.id && (
                  <ul className="border-t border-[var(--border)] bg-[var(--bg)]">
                    {d.ports.map((p) => (
                      <li
                        key={p.id}
                        className="flex items-center justify-between gap-2 px-3 py-2 text-sm"
                      >
                        <span>
                          {p.name}
                          {p.ipAddress ? (
                            <span className="ml-2 font-mono text-xs text-[var(--text-muted)]">
                              {p.ipAddress}
                            </span>
                          ) : null}
                        </span>
                        <button
                          type="button"
                          disabled={linkMutation.isPending}
                          onClick={() => linkMutation.mutate(p.id)}
                          className="rounded-md bg-[var(--accent)] px-2.5 py-1 text-xs font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-60"
                        >
                          Conectar
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
          {linkMutation.error && (
            <p className="mt-3 text-sm text-[var(--danger)]">
              {linkMutation.error.message}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
