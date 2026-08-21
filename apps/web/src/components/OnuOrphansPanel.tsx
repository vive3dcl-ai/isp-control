import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'
import type { UncfgOnu, UncfgResponse } from '../lib/onu-connected'
import { OnuAuthorizeModal } from './OnuAuthorizeModal'
import { OnuDeniedModal } from './OnuDeniedModal'
import { OnuPonMovedModal } from './OnuPonMovedModal'
import {
  DesktopTableWrap,
  MobileList,
  MobileListCard,
  MobileListEmpty,
  MobileListMeta,
} from './MobileList'
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
  const [showPonMoved, setShowPonMoved] = useState(false)

  const uncfgQuery = useQuery({
    queryKey: ['app', 'onus', 'uncfg', oltId || 'all'],
    queryFn: () =>
      apiFetch<UncfgResponse>('/app/onus/uncfg', {
        method: 'POST',
        body: JSON.stringify(oltId ? { oltId } : {}),
      }),
    staleTime: 15_000,
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
  const ponMoved = data?.ponMoved ?? []
  const ponMovedCount = data?.ponMovedCount ?? ponMoved.length
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
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setShowPonMoved(true)}
            className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm font-medium hover:bg-[var(--bg)]"
          >
            PON cambiado
            {ponMovedCount > 0 ? (
              <span className="ml-1.5 rounded bg-amber-600/20 px-1.5 text-xs text-amber-400">
                {ponMovedCount}
              </span>
            ) : null}
          </button>
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
      </div>

      <p className="text-sm text-[var(--text-muted)]">
        ONUs en la OLT pendientes de autorización (
        <span className="font-mono text-xs">show … onu uncfg</span>). El modelo
        sale del ACS cuando la ONU ya Informó (ProductClass). Orden: más
        reciente → más antigua. Denegar las oculta en Bloqueadas. Si el SN ya
        está en Conectadas pero en otro PON, aparece en PON cambiado. Las
        deshabilitadas en la OLT se quedan en Conectadas (estado Suspendida), no
        aquí.
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

      <MobileList>
        {loading && onus.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">Consultando OLT…</p>
        ) : onus.length === 0 ? (
          <MobileListEmpty>
            No hay ONUs huérfanas. Pulsa Refrescar para consultar la OLT.
          </MobileListEmpty>
        ) : (
          onus.map((o) => (
            <MobileListCard key={`${o.oltId}:${o.oltIf}:${o.sn}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-mono text-sm font-semibold">
                    {o.sn}
                  </p>
                  <p className="truncate text-xs text-[var(--text-muted)]">
                    {o.oltName} · {o.oltIf}
                  </p>
                </div>
                <span className="shrink-0 text-xs text-[var(--text-muted)]">
                  {o.model ||
                    (o.vendor && o.vendor !== 'unknown'
                      ? `${o.vendor}`
                      : '—')}
                </span>
              </div>
              <MobileListMeta>
                <span>{o.state ?? '—'}</span>
                {o.suggestedOnuId != null && (
                  <>
                    <span>·</span>
                    <span>ID sug. {o.suggestedOnuId}</span>
                  </>
                )}
                {o.inConnected ? (
                  <>
                    <span>·</span>
                    <span className="text-amber-400">en inventario</span>
                  </>
                ) : null}
                {o.firstSeenAt ? (
                  <>
                    <span>·</span>
                    <span>{new Date(o.firstSeenAt).toLocaleString()}</span>
                  </>
                ) : null}
              </MobileListMeta>
              {canWrite ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
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
              ) : null}
            </MobileListCard>
          ))
        )}
      </MobileList>

      <DesktopTableWrap>
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead className="border-b border-[var(--border)] bg-[var(--bg)] text-xs text-[var(--text-muted)]">
            <tr>
              <th className="px-3 py-2 font-medium">Conexión</th>
              <th className="px-3 py-2 font-medium">OLT</th>
              <th className="px-3 py-2 font-medium">Puerto PON</th>
              <th className="px-3 py-2 font-medium">SN</th>
              <th className="px-3 py-2 font-medium">Modelo</th>
              <th className="px-3 py-2 font-medium">Script</th>
              <th className="px-3 py-2 font-medium">Estado</th>
              <th className="px-3 py-2 font-medium">ONU ID sug.</th>
              <th className="px-3 py-2 font-medium">Acción</th>
            </tr>
          </thead>
          <tbody>
            {loading && onus.length === 0 ? (
              <tr>
                <td
                  colSpan={9}
                  className="px-3 py-8 text-center text-[var(--text-muted)]"
                >
                  Consultando OLT…
                </td>
              </tr>
            ) : onus.length === 0 ? (
              <tr>
                <td
                  colSpan={9}
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
                  <td className="px-3 py-2 whitespace-nowrap text-xs text-[var(--text-muted)]">
                    {o.firstSeenAt
                      ? new Date(o.firstSeenAt).toLocaleString()
                      : '—'}
                  </td>
                  <td className="px-3 py-2">{o.oltName}</td>
                  <td className="px-3 py-2 font-mono text-xs">{o.oltIf}</td>
                  <td className="px-3 py-2 font-mono text-xs">{o.sn}</td>
                  <td className="px-3 py-2">
                    {o.model ? (
                      <span
                        className="font-medium"
                        title={
                          o.modelSource === 'acs'
                            ? 'Modelo desde ACS'
                            : o.modelSource === 'sighting'
                              ? 'Modelo recordado de un Inform previo'
                              : o.modelSource === 'inventory'
                                ? 'Modelo del inventario (Conectadas)'
                                : undefined
                        }
                      >
                        {o.model}
                      </span>
                    ) : (
                      <span className="text-[var(--text-muted)]">
                        {o.vendor && o.vendor !== 'unknown'
                          ? `${o.vendor} (sin ACS)`
                          : '—'}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 font-mono text-[10px] text-[var(--text-muted)]">
                    {o.driverId ?? '—'}
                  </td>
                  <td className="px-3 py-2">
                    {o.state ?? '—'}
                    {o.inConnected ? (
                      <span className="ml-1 text-[10px] text-amber-400">
                        (también en inventario)
                      </span>
                    ) : null}
                  </td>
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
      </DesktopTableWrap>

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

      {showPonMoved && (
        <OnuPonMovedModal
          rows={ponMoved}
          loading={loading && !data}
          canWrite={canWrite}
          onClose={() => setShowPonMoved(false)}
          onReleased={(sn) => {
            setMsg(
              `SN ${sn} eliminado de Conectadas — debería aparecer en Huérfanas al refrescar`,
            )
            void refreshMutation.mutateAsync()
          }}
        />
      )}
    </div>
  )
}
