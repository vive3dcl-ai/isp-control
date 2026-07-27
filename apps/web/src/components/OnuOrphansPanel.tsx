import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'
import type { UncfgOnu, UncfgResponse } from '../lib/onu-connected'
import { OnuAuthorizeModal } from './OnuAuthorizeModal'
import { OnuDeniedModal } from './OnuDeniedModal'
import { useNotify } from './NotifyProvider'

const selectClass =
  'rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-sm outline-none ring-[var(--accent)] focus:ring-2'

export function OnuOrphansPanel({ canWrite }: { canWrite: boolean }) {
  const queryClient = useQueryClient()
  const { confirm } = useNotify()
  const [oltId, setOltId] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [selected, setSelected] = useState<UncfgOnu | null>(null)
  const [showDenied, setShowDenied] = useState(false)

  const uncfgQuery = useQuery({
    queryKey: ['app', 'onus', 'uncfg', oltId || 'all'],
    queryFn: () =>
      apiFetch<UncfgResponse>('/app/onus/uncfg', {
        method: 'POST',
        body: JSON.stringify(oltId ? { oltId } : {}),
      }),
    staleTime: 15_000,
    enabled: canWrite,
  })

  const refreshMutation = useMutation({
    mutationFn: () =>
      apiFetch<UncfgResponse>('/app/onus/uncfg', {
        method: 'POST',
        body: JSON.stringify(oltId ? { oltId } : {}),
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(['app', 'onus', 'uncfg', oltId || 'all'], data)
      setMsg(
        data.total === 0
          ? 'Sin ONUs huérfanas en la OLT'
          : `${data.total} ONU(s) esperando autorización`,
      )
    },
    onError: (e: Error) => setMsg(e.message),
  })

  const denyMutation = useMutation({
    mutationFn: (o: UncfgOnu) =>
      apiFetch<{ ok: boolean; message: string }>('/app/onus/deny', {
        method: 'POST',
        body: JSON.stringify({
          sn: o.sn,
          oltId: o.oltId,
          oltIf: o.oltIf,
          oltName: o.oltName,
          board: o.board,
          port: o.port,
          ponType: o.ponType,
        }),
      }),
    onSuccess: (r, o) => {
      setMsg(r.message || `SN ${o.sn} denegado`)
      void queryClient.invalidateQueries({ queryKey: ['app', 'onus', 'uncfg'] })
      void queryClient.invalidateQueries({ queryKey: ['app', 'onus', 'denied'] })
    },
    onError: (e: Error) => setMsg(e.message),
  })

  const data = uncfgQuery.data
  const onus = data?.onus ?? []
  const olts = data?.olts ?? []
  const errors = data?.errors ?? []
  const deniedCount = data?.deniedCount ?? 0
  const loading = uncfgQuery.isLoading || refreshMutation.isPending

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs text-[var(--text-muted)]">
            OLT
            <select
              className={`${selectClass} mt-1 block min-w-[180px]`}
              value={oltId}
              onChange={(e) => setOltId(e.target.value)}
            >
              <option value="">Todas</option>
              {olts.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={loading || !canWrite}
            title={
              canWrite
                ? 'Consultar ONUs uncfg en la OLT'
                : 'Requiere permisos de escritura'
            }
            onClick={() => void refreshMutation.mutateAsync()}
            className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-60"
          >
            {loading ? 'Consultando…' : 'Refrescar'}
          </button>
        </div>
        <button
          type="button"
          onClick={() => setShowDenied(true)}
          className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm font-medium hover:bg-[var(--bg)]"
        >
          Bloqueadas
          {deniedCount > 0 ? (
            <span className="ml-1.5 rounded bg-red-600/20 px-1.5 text-xs text-red-400">
              {deniedCount}
            </span>
          ) : null}
        </button>
      </div>

      <p className="text-sm text-[var(--text-muted)]">
        ONUs detectadas en la OLT que aún no están autorizadas (
        <span className="font-mono text-xs">show … onu uncfg</span>). Denegar
        las oculta aquí (Bloqueadas). Las que ya están en Conectadas no
        aparecen — Disable/Enable se gestiona solo desde el detalle.
      </p>

      {msg && (
        <p
          className={
            msg.toLowerCase().includes('fallo') ||
            msg.toLowerCase().includes('error')
              ? 'text-sm text-[var(--danger)]'
              : 'text-sm text-emerald-500'
          }
        >
          {msg}
        </p>
      )}
      {uncfgQuery.error && (
        <p className="text-sm text-[var(--danger)]">
          {(uncfgQuery.error as Error).message}
        </p>
      )}
      {errors.length > 0 && (
        <ul className="space-y-1 text-sm text-amber-500">
          {errors.map((e) => (
            <li key={e.oltId}>
              {e.oltName}: {e.error}
            </li>
          ))}
        </ul>
      )}

      <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="border-b border-[var(--border)] bg-[var(--bg)] text-xs text-[var(--text-muted)]">
            <tr>
              <th className="px-3 py-2 font-medium">OLT</th>
              <th className="px-3 py-2 font-medium">Puerto PON</th>
              <th className="px-3 py-2 font-medium">Board/Port</th>
              <th className="px-3 py-2 font-medium">SN</th>
              <th className="px-3 py-2 font-medium">Estado</th>
              <th className="px-3 py-2 font-medium">ONU ID sug.</th>
              <th className="px-3 py-2 font-medium">Acción</th>
            </tr>
          </thead>
          <tbody>
            {loading && onus.length === 0 ? (
              <tr>
                <td
                  colSpan={7}
                  className="px-3 py-8 text-center text-[var(--text-muted)]"
                >
                  Consultando OLT…
                </td>
              </tr>
            ) : onus.length === 0 ? (
              <tr>
                <td
                  colSpan={7}
                  className="px-3 py-8 text-center text-[var(--text-muted)]"
                >
                  No hay ONUs huérfanas. Pulsa Refrescar para consultar la OLT.
                </td>
              </tr>
            ) : (
              onus.map((o) => (
                <tr
                  key={`${o.oltId}:${o.oltIf}:${o.sn}`}
                  className="border-t border-[var(--border)]"
                >
                  <td className="px-3 py-2">{o.oltName}</td>
                  <td className="px-3 py-2 font-mono text-xs">{o.oltIf}</td>
                  <td className="px-3 py-2 text-[var(--text-muted)]">
                    {o.board}/{o.port}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{o.sn}</td>
                  <td className="px-3 py-2">{o.state ?? '—'}</td>
                  <td className="px-3 py-2">
                    {o.suggestedOnuId ?? '—'}
                  </td>
                  <td className="px-3 py-2">
                    {canWrite ? (
                      <div className="flex flex-wrap gap-1.5">
                        <button
                          type="button"
                          onClick={() => setSelected(o)}
                          className="rounded-md bg-[var(--accent)] px-2.5 py-1 text-xs font-medium text-white hover:bg-[var(--accent-hover)]"
                        >
                          Autorizar
                        </button>
                        <button
                          type="button"
                          disabled={denyMutation.isPending}
                          onClick={() => {
                            void confirm(
                              `¿Denegar SN ${o.sn}?\n\nNo se autorizará y desaparecerá de Huérfanas. Puedes verla en Bloqueadas y quitarla después.`,
                              {
                                title: 'Denegar ONU',
                                danger: true,
                                confirmLabel: 'Denegar',
                              },
                            ).then((ok) => {
                              if (ok) denyMutation.mutate(o)
                            })
                          }}
                          className="rounded-md border border-red-500/40 px-2.5 py-1 text-xs font-medium text-red-400 hover:bg-red-500/10 disabled:opacity-60"
                        >
                          Denegar
                        </button>
                      </div>
                    ) : (
                      <span className="text-xs text-[var(--text-muted)]">—</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {data?.probedAt ? (
        <p className="text-xs text-[var(--text-muted)]">
          Última consulta: {new Date(data.probedAt).toLocaleString()}
        </p>
      ) : null}

      {selected && (
        <OnuAuthorizeModal
          orphan={selected}
          onClose={() => setSelected(null)}
          onAuthorized={() => {
            setMsg(`ONU ${selected.sn} autorizada`)
            setSelected(null)
            void queryClient.invalidateQueries({
              queryKey: ['app', 'onus', 'uncfg'],
            })
            void queryClient.invalidateQueries({
              queryKey: ['app', 'onus'],
            })
          }}
        />
      )}

      {showDenied && (
        <OnuDeniedModal onClose={() => setShowDenied(false)} />
      )}
    </div>
  )
}
