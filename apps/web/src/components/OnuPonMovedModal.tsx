import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'
import type { PonMovedOnu } from '../lib/onu-connected'
import { useNotify } from './NotifyProvider'
import { ModalPortal } from './ModalPortal'
import {
  DesktopTableWrap,
  MobileList,
  MobileListCard,
  MobileListMeta,
} from './MobileList'

type Props = {
  rows: PonMovedOnu[]
  loading?: boolean
  canWrite?: boolean
  onClose: () => void
  onReleased?: (sn: string) => void
}

function ponLabel(board: string, port: string, fallback: string) {
  const b = board?.trim()
  const p = port?.trim()
  if (b && p) return `${b}/${p}`
  return fallback || '—'
}

export function OnuPonMovedModal({
  rows,
  loading,
  canWrite = true,
  onClose,
  onReleased,
}: Props) {
  const queryClient = useQueryClient()
  const { confirm } = useNotify()

  const releaseMutation = useMutation({
    mutationFn: (row: PonMovedOnu) =>
      apiFetch<{ ok?: boolean; message?: string }>('/app/onus/delete', {
        method: 'POST',
        body: JSON.stringify({
          oltId: row.inventoryOltId,
          onuIf: row.inventoryOnuIf,
        }),
      }),
    onSuccess: (r, row) => {
      onReleased?.(row.sn)
      void queryClient.invalidateQueries({ queryKey: ['app', 'onus'] })
      void queryClient.invalidateQueries({ queryKey: ['app', 'onus', 'uncfg'] })
      void queryClient.invalidateQueries({ queryKey: ['app', 'clients'] })
      if (r.message) {
        // parent muestra el mensaje vía onReleased / refresh
      }
    },
  })

  function releaseButton(r: PonMovedOnu) {
    return (
      <button
        type="button"
        disabled={releaseMutation.isPending || !canWrite}
        title={
          canWrite
            ? 'Eliminar ficha antigua y liberar a Huérfanas'
            : 'Requiere permisos de escritura'
        }
        className="rounded-md border border-red-500/40 px-2 py-1 text-xs font-medium text-red-400 hover:bg-red-500/10 disabled:opacity-60"
        onClick={() => {
          void confirm(
            `¿Eliminar ${r.sn} de Conectadas?\n\nSe borra la auth en ${r.inventoryOnuIf} (${r.inventoryOltName}) y la ficha. El SN debería aparecer en Huérfanas en ${r.uncfgOltIf}.`,
            {
              title: 'Liberar a huérfanas',
              confirmLabel: 'Eliminar',
            },
          ).then((ok) => {
            if (ok) releaseMutation.mutate(r)
          })
        }}
      >
        Eliminar
      </button>
    )
  }

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-[110] modal-backdrop flex items-stretch justify-center overflow-hidden bg-black/60 sm:items-center sm:p-4">
        <div className="flex h-[100dvh] max-h-[100dvh] w-full max-w-4xl flex-col overflow-hidden rounded-none border-0 sm:h-auto sm:max-h-[min(92dvh,920px)] sm:rounded-xl sm:border border-[var(--border)] bg-[var(--bg-elevated)] shadow-xl">
          <div className="flex shrink-0 items-start justify-between gap-2 border-b border-[var(--border)] px-4 py-3 sm:px-5">
            <div className="min-w-0">
              <h3 className="text-lg font-semibold">ONUs con PON cambiado</h3>
              <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                SN que la OLT reporta en uncfg en un puerto distinto al de
                Conectadas. Eliminar borra la ficha antigua (y la auth en el PON
                viejo) para que vuelva a Huérfanas y puedas autorizarla en el
                nuevo puerto. El servicio CRM queda sin ONU hasta reasignar.
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
            {loading && (
              <p className="text-sm text-[var(--text-muted)]">Consultando…</p>
            )}
            {releaseMutation.error && (
              <p className="mb-2 text-sm text-[var(--danger)]">
                {(releaseMutation.error as Error).message}
              </p>
            )}

            {!loading && rows.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)]">
                No hay ONUs con cambio de PON detectado. Refresca Huérfanas para
                volver a consultar la OLT.
              </p>
            ) : rows.length > 0 ? (
              <>
                <MobileList>
                  {rows.map((r) => (
                    <MobileListCard key={`${r.sn}-${r.inventoryOnuId}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-mono text-xs font-semibold">
                            {r.sn}
                          </p>
                          {r.inventoryName ? (
                            <p className="text-[11px] text-[var(--text-muted)]">
                              {r.inventoryName}
                            </p>
                          ) : null}
                        </div>
                        {releaseButton(r)}
                      </div>
                      <MobileListMeta>
                        <span>
                          Viejo: {r.inventoryOltName} · {r.inventoryOnuIf} · PON{' '}
                          {ponLabel(
                            r.inventoryBoard,
                            r.inventoryPort,
                            r.inventoryOnuIf,
                          )}
                        </span>
                        <span>·</span>
                        <span>
                          Nuevo: {r.uncfgOltName} · {r.uncfgOltIf} · PON{' '}
                          {ponLabel(r.uncfgBoard, r.uncfgPort, r.uncfgOltIf)}
                          {r.uncfgState ? ` · ${r.uncfgState}` : ''}
                        </span>
                        <span>·</span>
                        <span>
                          {r.inventoryAdminState || '—'}
                          {r.inventoryOnline ? ' · online' : ' · offline'}
                        </span>
                      </MobileListMeta>
                    </MobileListCard>
                  ))}
                </MobileList>

                <DesktopTableWrap bordered={false}>
                  <table className="w-full min-w-[720px] text-left text-sm">
                    <thead className="text-xs text-[var(--text-muted)]">
                      <tr>
                        <th className="py-1.5 font-medium">SN</th>
                        <th className="py-1.5 font-medium">Conectadas (viejo)</th>
                        <th className="py-1.5 font-medium">Uncfg (nuevo)</th>
                        <th className="py-1.5 font-medium">Estado ficha</th>
                        <th className="py-1.5 font-medium">Acción</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr
                          key={`${r.sn}-${r.inventoryOnuId}`}
                          className="border-t border-[var(--border)]"
                        >
                          <td className="py-2 align-top">
                            <div className="font-mono text-xs">{r.sn}</div>
                            {r.inventoryName ? (
                              <div className="text-[11px] text-[var(--text-muted)]">
                                {r.inventoryName}
                              </div>
                            ) : null}
                          </td>
                          <td className="py-2 align-top text-xs">
                            <div>{r.inventoryOltName}</div>
                            <div className="font-mono text-[var(--text-muted)]">
                              {r.inventoryOnuIf}
                            </div>
                            <div className="text-[var(--text-muted)]">
                              PON{' '}
                              {ponLabel(
                                r.inventoryBoard,
                                r.inventoryPort,
                                r.inventoryOnuIf,
                              )}
                            </div>
                          </td>
                          <td className="py-2 align-top text-xs">
                            <div>{r.uncfgOltName}</div>
                            <div className="font-mono text-[var(--text-muted)]">
                              {r.uncfgOltIf}
                            </div>
                            <div className="text-[var(--text-muted)]">
                              PON{' '}
                              {ponLabel(r.uncfgBoard, r.uncfgPort, r.uncfgOltIf)}
                              {r.uncfgState ? ` · ${r.uncfgState}` : ''}
                            </div>
                          </td>
                          <td className="py-2 align-top text-xs text-[var(--text-muted)]">
                            {r.inventoryAdminState || '—'}
                            {r.inventoryOnline ? ' · online' : ' · offline'}
                          </td>
                          <td className="py-2 align-top">{releaseButton(r)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </DesktopTableWrap>
              </>
            ) : null}
          </div>

          <div className="flex shrink-0 justify-end border-t border-[var(--border)] px-4 py-3 sm:px-5">
            <button
              type="button"
              className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm hover:bg-[var(--bg)]"
              onClick={onClose}
            >
              Cerrar
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  )
}
