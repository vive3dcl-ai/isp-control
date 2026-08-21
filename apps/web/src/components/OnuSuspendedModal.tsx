import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'
import type { SuspendedOnusResponse } from '../lib/onu-connected'
import {
  DesktopTableWrap,
  MobileList,
  MobileListCard,
  MobileListEmpty,
  MobileListMeta,
} from './MobileList'
import { useNotify } from './NotifyProvider'
import { ModalPortal } from './ModalPortal'

type Props = {
  onClose: () => void
}

export function OnuSuspendedModal({ onClose }: Props) {
  const queryClient = useQueryClient()
  const { confirm } = useNotify()

  const query = useQuery({
    queryKey: ['app', 'onus', 'suspended'],
    queryFn: () => apiFetch<SuspendedOnusResponse>('/app/onus/suspended'),
  })

  const enableMutation = useMutation({
    mutationFn: (row: SuspendedOnusResponse['suspended'][number]) =>
      apiFetch<{ message?: string }>('/app/onus/enable', {
        method: 'POST',
        body: JSON.stringify({ oltId: row.oltId, onuIf: row.onuIf }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['app', 'onus'] })
      void queryClient.invalidateQueries({
        queryKey: ['app', 'onus', 'suspended'],
      })
      void queryClient.invalidateQueries({ queryKey: ['app', 'onus', 'uncfg'] })
      void queryClient.invalidateQueries({ queryKey: ['app', 'clients'] })
      void queryClient.invalidateQueries({ queryKey: ['app', 'dashboard'] })
    },
  })

  const rows = query.data?.suspended ?? []

  function askEnable(r: SuspendedOnusResponse['suspended'][number]) {
    void confirm(
      `¿Rehabilitar ${r.sn || r.onuIf}?\n\nSe quita el admin disable en la OLT.`,
      {
        title: 'Rehabilitar ONU',
        confirmLabel: 'Rehabilitar',
      },
    ).then((ok) => {
      if (ok) enableMutation.mutate(r)
    })
  }

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-[110] modal-backdrop flex items-stretch justify-center overflow-hidden bg-black/60 sm:items-center sm:p-4">
        <div className="flex h-[100dvh] max-h-[100dvh] w-full max-w-3xl flex-col overflow-hidden rounded-none border-0 sm:h-auto sm:max-h-[min(92dvh,920px)] sm:rounded-xl sm:border border-[var(--border)] bg-[var(--bg-elevated)] shadow-xl">
          <div className="modal-safe-header flex shrink-0 items-start justify-between gap-2 border-b border-[var(--border)] px-4 py-3 sm:px-5">
            <div className="min-w-0">
              <h3 className="text-lg font-semibold">ONUs suspendidas</h3>
              <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                Admin disable en la OLT. Si la ONU tiene cliente CRM, rehabilitar
                reactiva todos sus servicios.
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

          <div className="min-h-0 flex-1 overflow-auto px-4 py-4 sm:px-5">
            {query.isLoading && (
              <p className="text-sm text-[var(--text-muted)]">Cargando…</p>
            )}
            {query.error && (
              <p className="text-sm text-[var(--danger)]">
                {(query.error as Error).message}
              </p>
            )}
            {enableMutation.error && (
              <p className="mb-2 text-sm text-[var(--danger)]">
                {(enableMutation.error as Error).message}
              </p>
            )}

            {!query.isLoading && rows.length === 0 ? (
              <MobileListEmpty>No hay ONUs suspendidas.</MobileListEmpty>
            ) : rows.length > 0 ? (
              <>
                <MobileList>
                  {rows.map((r) => (
                    <MobileListCard key={r.id}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate font-mono text-sm font-semibold">
                            {r.sn || '—'}
                          </p>
                          {r.name ? (
                            <p className="truncate text-xs text-[var(--text-muted)]">
                              {r.name}
                            </p>
                          ) : null}
                          <p className="truncate text-xs text-[var(--text-muted)]">
                            {r.oltName} · {r.onuIf}
                          </p>
                        </div>
                        <button
                          type="button"
                          disabled={enableMutation.isPending}
                          onClick={() => askEnable(r)}
                          className="shrink-0 rounded-md border border-[var(--border)] px-2 py-1 text-xs hover:bg-[var(--bg)] disabled:opacity-60"
                        >
                          Rehabilitar
                        </button>
                      </div>
                      <MobileListMeta>
                        <span>{r.adminState || 'disable'}</span>
                        <span>·</span>
                        <span>{r.online ? 'online' : 'offline'}</span>
                      </MobileListMeta>
                    </MobileListCard>
                  ))}
                </MobileList>

                <DesktopTableWrap bordered={false}>
                  <table className="w-full text-left text-sm">
                    <thead className="text-xs text-[var(--text-muted)]">
                      <tr>
                        <th className="py-1.5 font-medium">SN</th>
                        <th className="py-1.5 font-medium">OLT</th>
                        <th className="py-1.5 font-medium">Interfaz</th>
                        <th className="py-1.5 font-medium">Estado</th>
                        <th className="py-1.5 font-medium">Acción</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr
                          key={r.id}
                          className="border-t border-[var(--border)]"
                        >
                          <td className="py-2 font-mono text-xs">
                            {r.sn || '—'}
                            {r.name ? (
                              <div className="font-sans text-[10px] text-[var(--text-muted)]">
                                {r.name}
                              </div>
                            ) : null}
                          </td>
                          <td className="py-2">{r.oltName}</td>
                          <td className="py-2 font-mono text-xs">{r.onuIf}</td>
                          <td className="py-2 text-xs text-[var(--text-muted)]">
                            {r.adminState || 'disable'}
                            {r.online ? ' · online' : ' · offline'}
                          </td>
                          <td className="py-2">
                            <button
                              type="button"
                              disabled={enableMutation.isPending}
                              onClick={() => askEnable(r)}
                              className="rounded-md border border-[var(--border)] px-2 py-1 text-xs hover:bg-[var(--bg)] disabled:opacity-60"
                            >
                              Rehabilitar
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </DesktopTableWrap>
              </>
            ) : null}
          </div>

          <div className="modal-safe-footer flex shrink-0 justify-end border-t border-[var(--border)] px-5 py-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm hover:bg-[var(--bg)]"
            >
              Cerrar
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  )
}
