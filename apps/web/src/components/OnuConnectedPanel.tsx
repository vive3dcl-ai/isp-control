import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'
import {
  formatSignal,
  signalBand,
  type ConnectedOnu,
  type ConnectedOnusResponse,
} from '../lib/onu-connected'
import { OnuDetailModal } from './OnuDetailModal'

const PAGE_SIZE = 50

const selectClass =
  'rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-sm outline-none ring-[var(--accent)] focus:ring-2'

function StatusIcon({ onu }: { onu: ConnectedOnu }) {
  if (onu.online) {
    return (
      <span
        className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400"
        title={onu.phaseState || 'Online'}
      >
        <span className="h-2.5 w-2.5 rounded-full bg-current" />
      </span>
    )
  }
  if (onu.status === 'los') {
    return (
      <span
        className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-red-500/20 text-red-400"
        title={onu.phaseState || 'LOS'}
      >
        <svg
          viewBox="0 0 16 16"
          className="h-3.5 w-3.5"
          fill="currentColor"
          aria-hidden
        >
          <path d="M8 1 1 14h14L8 1zm0 4.5a.75.75 0 0 1 .75.75v3a.75.75 0 0 1-1.5 0v-3A.75.75 0 0 1 8 5.5zm0 6a.9.9 0 1 1 0 1.8.9.9 0 0 1 0-1.8z" />
        </svg>
      </span>
    )
  }
  return (
    <span
      className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-[var(--text-muted)]/20 text-[var(--text-muted)]"
      title={onu.phaseState || 'Offline'}
    >
      <span className="h-2.5 w-2.5 rounded-full border-2 border-current" />
    </span>
  )
}

/** Signal strength bars (1–3) — CSS only, no unicode glyphs. */
function SignalBars({
  level,
  active,
}: {
  level: 1 | 2 | 3
  active?: boolean
}) {
  return (
    <span
      className={[
        'inline-flex h-4 items-end gap-0.5',
        active ? 'opacity-100' : 'opacity-70',
      ].join(' ')}
      aria-hidden
    >
      {[1, 2, 3].map((n) => (
        <span
          key={n}
          className={[
            'w-1 rounded-sm bg-current',
            n === 1 ? 'h-1.5' : n === 2 ? 'h-2.5' : 'h-3.5',
            n <= level ? 'opacity-100' : 'opacity-25',
          ].join(' ')}
        />
      ))}
    </span>
  )
}

function SignalCell({ dbm }: { dbm: number | null }) {
  const band = signalBand(dbm)
  const color =
    band === 'good'
      ? 'text-emerald-400'
      : band === 'fair'
        ? 'text-amber-400'
        : band === 'poor'
          ? 'text-red-400'
          : 'text-[var(--text-muted)]'
  return <span className={color}>{formatSignal(dbm)}</span>
}

export function OnuConnectedPanel({ canWrite }: { canWrite: boolean }) {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [oltId, setOltId] = useState('')
  const [board, setBoard] = useState('')
  const [port, setPort] = useState('')
  const [onuType, setOnuType] = useState('')
  const [ponType, setPonType] = useState('')
  const [statusFilter, setStatusFilter] = useState<
    '' | 'online' | 'offline' | 'los'
  >('')
  const [signalFilter, setSignalFilter] = useState<
    '' | 'good' | 'fair' | 'poor'
  >('')
  const [modeFilter, setModeFilter] = useState<'' | 'bridge' | 'router'>('')
  const [page, setPage] = useState(0)
  const [selected, setSelected] = useState<{
    oltId: string
    onuIf: string
  } | null>(null)
  const [syncBanner, setSyncBanner] = useState<string | null>(null)

  const listQuery = useQuery({
    queryKey: ['app', 'onus', 'connected'],
    queryFn: () => apiFetch<ConnectedOnusResponse>('/app/onus'),
    staleTime: 20_000,
    refetchInterval: 60_000,
  })

  const syncMutation = useMutation({
    mutationFn: async () => {
      const targets =
        oltId
          ? [oltId]
          : (listQuery.data?.olts ?? []).map((o) => o.id)
      if (targets.length === 0) {
        throw new Error('No hay OLT para sincronizar')
      }
      const results = []
      for (const id of targets) {
        results.push(
          await apiFetch<{
            added: number
            updated: number
            missing: number
            oltName: string
            source?: string
          }>('/app/onus/sync', {
            method: 'POST',
            body: JSON.stringify({ oltId: id }),
          }),
        )
      }
      return results
    },
    onSuccess: (results) => {
      void queryClient.invalidateQueries({ queryKey: ['app', 'onus'] })
      setSyncBanner(
        results
          .map(
            (r) =>
              `${r.oltName}: +${r.added} / ~${r.updated} / offline ${r.missing}`,
          )
          .join(' · '),
      )
    },
  })

  useEffect(() => {
    if (!syncBanner) return
    const t = window.setTimeout(() => setSyncBanner(null), 5_000)
    return () => window.clearTimeout(t)
  }, [syncBanner])

  const onus = listQuery.data?.onus ?? []

  const boards = useMemo(
    () =>
      [...new Set(onus.map((o) => o.board).filter(Boolean))].sort(
        (a, b) => Number(a) - Number(b) || a.localeCompare(b),
      ),
    [onus],
  )
  const ports = useMemo(
    () =>
      [...new Set(onus.map((o) => o.port).filter(Boolean))].sort(
        (a, b) => Number(a) - Number(b) || a.localeCompare(b),
      ),
    [onus],
  )
  const types = useMemo(
    () =>
      [
        ...new Set(
          onus.map((o) => o.onuType).filter((t): t is string => Boolean(t)),
        ),
      ].sort(),
    [onus],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return onus.filter((o) => {
      if (oltId && o.oltId !== oltId) return false
      if (board && o.board !== board) return false
      if (port && o.port !== port) return false
      if (onuType && o.onuType !== onuType) return false
      if (ponType && o.ponType !== ponType) return false
      if (statusFilter === 'online' && !o.online) return false
      if (statusFilter === 'offline' && (o.online || o.status === 'los'))
        return false
      if (statusFilter === 'los' && o.status !== 'los') return false
      if (signalFilter) {
        const band = signalBand(o.signalDbm)
        if (band !== signalFilter) return false
      }
      if (modeFilter && o.mode !== modeFilter) return false
      if (q) {
        const hay = [
          o.sn,
          o.name,
          o.onuIf,
          o.description,
          o.oltName,
          o.onuType,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [
    onus,
    search,
    oltId,
    board,
    port,
    onuType,
    ponType,
    statusFilter,
    signalFilter,
    modeFilter,
  ])

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const pageSafe = Math.min(page, pageCount - 1)
  const pageRows = filtered.slice(
    pageSafe * PAGE_SIZE,
    pageSafe * PAGE_SIZE + PAGE_SIZE,
  )

  function toggleStatus(v: typeof statusFilter) {
    setStatusFilter((cur) => (cur === v ? '' : v))
    setPage(0)
  }
  function toggleSignal(v: typeof signalFilter) {
    setSignalFilter((cur) => (cur === v ? '' : v))
    setPage(0)
  }
  function toggleMode(v: typeof modeFilter) {
    setModeFilter((cur) => (cur === v ? '' : v))
    setPage(0)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-0 flex-1 basis-full text-xs text-[var(--text-muted)] sm:basis-auto sm:min-w-[160px]">
          Buscar
          <input
            className={`${selectClass} mt-1 w-full`}
            placeholder="SN, nombre, interfaz…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setPage(0)
            }}
          />
        </label>
        <label className="min-w-0 flex-1 text-xs text-[var(--text-muted)] sm:flex-none">
          OLT
          <select
            className={`${selectClass} mt-1 block w-full min-w-0 sm:min-w-[140px]`}
            value={oltId}
            onChange={(e) => {
              setOltId(e.target.value)
              setPage(0)
            }}
          >
            <option value="">Cualquiera</option>
            {(listQuery.data?.olts ?? []).map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-[var(--text-muted)]">
          Board
          <select
            className={`${selectClass} mt-1 block min-w-[80px]`}
            value={board}
            onChange={(e) => {
              setBoard(e.target.value)
              setPage(0)
            }}
          >
            <option value="">Cualquiera</option>
            {boards.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-[var(--text-muted)]">
          Puerto
          <select
            className={`${selectClass} mt-1 block min-w-[80px]`}
            value={port}
            onChange={(e) => {
              setPort(e.target.value)
              setPage(0)
            }}
          >
            <option value="">Cualquiera</option>
            {ports.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-[var(--text-muted)]">
          Tipo ONU
          <select
            className={`${selectClass} mt-1 block min-w-[120px]`}
            value={onuType}
            onChange={(e) => {
              setOnuType(e.target.value)
              setPage(0)
            }}
          >
            <option value="">Cualquiera</option>
            {types.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-[var(--text-muted)]">
          PON
          <select
            className={`${selectClass} mt-1 block min-w-[90px]`}
            value={ponType}
            onChange={(e) => {
              setPonType(e.target.value)
              setPage(0)
            }}
          >
            <option value="">Cualquiera</option>
            <option value="gpon">GPON</option>
            <option value="epon">EPON</option>
          </select>
        </label>
        <div className="flex flex-col gap-1 text-xs text-[var(--text-muted)]">
          Estado
          <div className="flex gap-1">
            <button
              type="button"
              title="Online"
              onClick={() => toggleStatus('online')}
              className={[
                'inline-flex items-center justify-center rounded-md px-2 py-1.5',
                statusFilter === 'online'
                  ? 'bg-emerald-600 text-white'
                  : 'border border-[var(--border)] text-emerald-400',
              ].join(' ')}
            >
              <span className="h-2.5 w-2.5 rounded-full bg-current" />
            </button>
            <button
              type="button"
              title="LOS / alerta"
              onClick={() => toggleStatus('los')}
              className={[
                'inline-flex items-center justify-center rounded-md px-2 py-1.5',
                statusFilter === 'los'
                  ? 'bg-red-600 text-white'
                  : 'border border-[var(--border)] text-red-400',
              ].join(' ')}
            >
              <svg
                viewBox="0 0 16 16"
                className="h-3.5 w-3.5"
                fill="currentColor"
                aria-hidden
              >
                <path d="M8 1 1 14h14L8 1zm0 4.5a.75.75 0 0 1 .75.75v3a.75.75 0 0 1-1.5 0v-3A.75.75 0 0 1 8 5.5zm0 6a.9.9 0 1 1 0 1.8.9.9 0 0 1 0-1.8z" />
              </svg>
            </button>
            <button
              type="button"
              title="Offline"
              onClick={() => toggleStatus('offline')}
              className={[
                'inline-flex items-center justify-center rounded-md px-2 py-1.5',
                statusFilter === 'offline'
                  ? 'bg-[var(--text-muted)] text-white'
                  : 'border border-[var(--border)] text-[var(--text-muted)]',
              ].join(' ')}
            >
              <span className="h-2.5 w-2.5 rounded-full border-2 border-current" />
            </button>
          </div>
        </div>
        <div className="flex flex-col gap-1 text-xs text-[var(--text-muted)]">
          Señal
          <div className="flex gap-1">
            {(
              [
                ['good', 'Buena', 'bg-emerald-600', 'text-emerald-400', 3],
                ['fair', 'Media', 'bg-amber-500', 'text-amber-400', 2],
                ['poor', 'Mala', 'bg-red-600', 'text-red-400', 1],
              ] as const
            ).map(([k, label, activeCls, idleCls, level]) => (
              <button
                key={k}
                type="button"
                title={label}
                onClick={() => toggleSignal(k)}
                className={[
                  'inline-flex items-center justify-center rounded-md px-2 py-1.5',
                  signalFilter === k
                    ? `${activeCls} text-white`
                    : `border border-[var(--border)] ${idleCls}`,
                ].join(' ')}
              >
                <SignalBars level={level} active={signalFilter === k} />
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-1 text-xs text-[var(--text-muted)]">
          Modo
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => toggleMode('bridge')}
              className={[
                'rounded-md px-2 py-1.5 text-xs font-semibold',
                modeFilter === 'bridge'
                  ? 'bg-[var(--accent)] text-white'
                  : 'border border-[var(--border)]',
              ].join(' ')}
            >
              B
            </button>
            <button
              type="button"
              onClick={() => toggleMode('router')}
              className={[
                'rounded-md px-2 py-1.5 text-xs font-semibold',
                modeFilter === 'router'
                  ? 'bg-[var(--accent)] text-white'
                  : 'border border-[var(--border)]',
              ].join(' ')}
            >
              R
            </button>
          </div>
        </div>
        <button
          type="button"
          disabled={listQuery.isFetching}
          onClick={() => void listQuery.refetch()}
          className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm hover:bg-[var(--bg)] disabled:opacity-60"
        >
          {listQuery.isFetching ? 'Cargando…' : 'Refrescar'}
        </button>
        {canWrite && (
          <button
            type="button"
            disabled={syncMutation.isPending}
            onClick={() => void syncMutation.mutateAsync()}
            className="rounded-lg bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-60"
            title={
              oltId
                ? 'Reconciliar inventario vía SNMP (CLI si falla)'
                : 'Reconciliar todas las OLTs vía SNMP (CLI si falla)'
            }
          >
            {syncMutation.isPending ? 'Sincronizando…' : 'Sincronizar'}
          </button>
        )}
      </div>

      {syncMutation.error && (
        <p className="text-sm text-[var(--danger)]">
          {(syncMutation.error as Error).message}
        </p>
      )}
      {syncBanner && (
        <p className="text-sm text-emerald-500">{syncBanner}</p>
      )}

      {listQuery.error && (
        <p className="text-sm text-[var(--danger)]">
          {(listQuery.error as Error).message}
        </p>
      )}
      {(listQuery.data?.errors?.length ?? 0) > 0 && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
          {(listQuery.data?.errors ?? []).map((e) => (
            <p key={e.oltId}>
              {e.oltName}: {e.error}
            </p>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <div className="flex gap-1">
          {Array.from({ length: pageCount }, (_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setPage(i)}
              className={[
                'min-w-8 rounded-md px-2 py-1',
                i === pageSafe
                  ? 'bg-[var(--accent)] text-white'
                  : 'border border-[var(--border)]',
              ].join(' ')}
            >
              {i + 1}
            </button>
          ))}
        </div>
        <span className="text-[var(--text-muted)]">
          {filtered.length === 0
            ? '0 ONUs'
            : `${pageSafe * PAGE_SIZE + 1}–${Math.min(
                (pageSafe + 1) * PAGE_SIZE,
                filtered.length,
              )} de ${filtered.length} · ${listQuery.data?.online ?? 0} online`}
        </span>
      </div>

      <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
        <table className="w-full min-w-[1100px] text-left text-sm">
          <thead>
            <tr className="border-b border-[var(--border)] bg-[var(--bg-elevated)] text-[var(--text-muted)]">
              <th className="px-2 py-2 font-medium">Estado</th>
              <th className="px-2 py-2 font-medium">Ver</th>
              <th className="px-2 py-2 font-medium">Nombre</th>
              <th className="px-2 py-2 font-medium">SN</th>
              <th className="px-2 py-2 font-medium">ONU</th>
              <th className="px-2 py-2 font-medium">Zona</th>
              <th className="px-2 py-2 font-medium">ODB</th>
              <th className="px-2 py-2 font-medium">Señal</th>
              <th className="px-2 py-2 font-medium">B/R</th>
              <th className="px-2 py-2 font-medium">VLAN</th>
              <th className="px-2 py-2 font-medium">VoIP</th>
              <th className="px-2 py-2 font-medium">TV</th>
              <th className="px-2 py-2 font-medium">Tipo</th>
              <th className="px-2 py-2 font-medium">Auth</th>
            </tr>
          </thead>
          <tbody>
            {listQuery.isLoading && (
              <tr>
                <td
                  colSpan={14}
                  className="px-3 py-8 text-center text-[var(--text-muted)]"
                >
                  Consultando OLTs (puede tardar)…
                </td>
              </tr>
            )}
            {!listQuery.isLoading && pageRows.length === 0 && (
              <tr>
                <td
                  colSpan={14}
                  className="px-3 py-8 text-center text-[var(--text-muted)]"
                >
                  {listQuery.data?.message ||
                    (listQuery.data?.olts?.length
                      ? 'No hay ONUs importadas. Prueba la conexión de una OLT para importarlas.'
                      : 'No hay ONUs. Conecta una OLT ZTE en Topología o revisa credenciales.')}
                </td>
              </tr>
            )}
            {pageRows.map((o) => (
              <tr
                key={o.id}
                className="border-b border-[var(--border)] last:border-0"
              >
                <td className="px-2 py-2">
                  <StatusIcon onu={o} />
                </td>
                <td className="px-2 py-2">
                  <button
                    type="button"
                    className="rounded-md bg-[var(--accent)] px-2.5 py-1 text-xs font-medium text-white hover:bg-[var(--accent-hover)]"
                    onClick={() =>
                      setSelected({ oltId: o.oltId, onuIf: o.onuIf })
                    }
                  >
                    Ver
                  </button>
                </td>
                <td className="px-2 py-2 max-w-[160px] truncate">
                  {o.name || (
                    <span className="text-[var(--text-muted)]">—</span>
                  )}
                </td>
                <td className="px-2 py-2 font-mono text-xs">
                  {o.sn || '—'}
                </td>
                <td className="px-2 py-2 text-xs">
                  <span className="text-[var(--text-muted)]">{o.oltName}</span>
                  <br />
                  {o.onuIf}
                </td>
                <td className="px-2 py-2 text-[var(--text-muted)]">
                  {o.zone ?? '—'}
                </td>
                <td className="px-2 py-2 text-[var(--text-muted)]">
                  {o.odb ?? '—'}
                </td>
                <td className="px-2 py-2">
                  <SignalCell dbm={o.signalDbm} />
                </td>
                <td className="px-2 py-2">
                  {o.mode === 'router' ? (
                    <span className="rounded bg-[var(--accent)]/20 px-1.5 py-0.5 text-xs text-[var(--accent)]">
                      Router
                    </span>
                  ) : o.mode === 'bridge' ? (
                    <span className="rounded bg-[var(--bg)] px-1.5 py-0.5 text-xs">
                      Bridge
                    </span>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="px-2 py-2">{o.vlan ?? '—'}</td>
                <td className="px-2 py-2 text-[var(--text-muted)]">
                  {o.voip ?? '—'}
                </td>
                <td className="px-2 py-2 text-[var(--text-muted)]">
                  {o.tv ?? '—'}
                </td>
                <td className="px-2 py-2">{o.onuType ?? '—'}</td>
                <td className="px-2 py-2 text-[var(--text-muted)]">
                  {o.authDate ?? '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selected && (
        <OnuDetailModal
          oltId={selected.oltId}
          onuIf={selected.onuIf}
          canWrite={canWrite}
          onClose={() => setSelected(null)}
          onRebooted={() => {
            void queryClient.invalidateQueries({
              queryKey: ['app', 'onus', 'connected'],
            })
          }}
        />
      )}
    </div>
  )
}
