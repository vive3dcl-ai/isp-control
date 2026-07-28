import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'
import type { DeniedOnusResponse } from '../lib/onu-connected'
import { useNotify } from './NotifyProvider'
import { ModalPortal } from './ModalPortal'

type Props = {
  onClose: () => void
}

export function OnuDeniedModal({ onClose }: Props) {
  const queryClient = useQueryClient()
  const { confirm } = useNotify()

  const deniedQuery = useQuery({
    queryKey: ['app', 'onus', 'denied'],
    queryFn: () => apiFetch<DeniedOnusResponse>('/app/onus/denied'),
  })

  const undenyMutation = useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ ok: boolean; message: string; sn: string }>(
        `/app/onus/denied/${id}`,
        { method: 'DELETE' },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['app', 'onus', 'denied'] })
      void queryClient.invalidateQueries({ queryKey: ['app', 'onus', 'uncfg'] })
    },
  })

  const rows = deniedQuery.data?.denied ?? []

  return (
    <ModalPortal><div className="fixed inset-0 z-[90] modal-backdrop flex items-stretch justify-center overflow-hidden bg-black/60 sm:items-center sm:p-4">
      <div className="flex h-[100dvh] max-h-[100dvh] w-full max-w-3xl flex-col overflow-hidden rounded-none border-0 sm:h-auto sm:max-h-[min(92dvh,920px)] sm:rounded-xl sm:border border-[var(--border)] bg-[var(--bg-elevated)] shadow-xl">
        <div className="flex shrink-0 items-start justify-between gap-2 border-b border-[var(--border)] px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <h3 className="text-lg font-semibold">ONUs bloqueadas</h3>
            <p className="mt-0.5 text-xs text-[var(--text-muted)]">
              SN denegados a mano desde Huérfanas. No se mezclan con Disable en
              Conectadas. Al quitarlos, vuelven a Huérfanas si siguen en uncfg.
            </p>
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
          {deniedQuery.isLoading && (
            <p className="text-sm text-[var(--text-muted)]">Cargando…</p>
          )}
          {deniedQuery.error && (
            <p className="text-sm text-[var(--danger)]">
              {(deniedQuery.error as Error).message}
            </p>
          )}
          {undenyMutation.error && (
            <p className="mb-2 text-sm text-[var(--danger)]">
              {(undenyMutation.error as Error).message}
            </p>
          )}

          {!deniedQuery.isLoading && rows.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">
              No hay SN bloqueados.
            </p>
          ) : rows.length > 0 ? (
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-[var(--text-muted)]">
                <tr>
                  <th className="py-1.5 font-medium">SN</th>
                  <th className="py-1.5 font-medium">OLT</th>
                  <th className="py-1.5 font-medium">PON</th>
                  <th className="py-1.5 font-medium">Motivo</th>
                  <th className="py-1.5 font-medium">Denegada</th>
                  <th className="py-1.5 font-medium">Acción</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-[var(--border)]">
                    <td className="py-2 font-mono text-xs">{r.sn}</td>
                    <td className="py-2">{r.oltName ?? '—'}</td>
                    <td className="py-2 font-mono text-xs">
                      {r.oltIf ?? '—'}
                    </td>
                    <td className="max-w-[14rem] py-2 text-xs text-[var(--text-muted)]">
                      {r.note || 'Denegada manual'}
                    </td>
                    <td className="py-2 text-xs text-[var(--text-muted)]">
                      {new Date(r.deniedAt).toLocaleString()}
                    </td>
                    <td className="py-2">
                      <button
                        type="button"
                        disabled={undenyMutation.isPending}
                        onClick={() => {
                          void confirm(
                            `¿Quitar ${r.sn} de bloqueadas?\n\nVolverá a Huérfanas si la OLT la reporta en uncfg.`,
                            {
                              title: 'Quitar de bloqueadas',
                              confirmLabel: 'Quitar',
                            },
                          ).then((ok) => {
                            if (ok) undenyMutation.mutate(r.id)
                          })
                        }}
                        className="rounded-md border border-[var(--border)] px-2 py-1 text-xs hover:bg-[var(--bg)] disabled:opacity-60"
                      >
                        Quitar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
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
