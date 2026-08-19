import { useMemo, useState } from 'react'
import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { apiFetch } from '../lib/api'
import type {
  OltUplinkRow,
  OltUplinksResponse,
  TopologyDevice,
} from '../lib/topology'
import { ModalPortal } from './ModalPortal'
import { TvServersPanel } from './TvServersPanel'

type IgmpWorkMode = 'snooping' | 'spr' | 'proxy' | 'router'

type TvVlanRow = {
  id: string | null
  vlanId: number
  description: string | null
  purpose?: 'tv'
  igmpWorkMode?: IgmpWorkMode | null
  igmpHostIp?: string | null
  igmpSourcePorts?: Record<string, string[]>
  oltIds: string[]
  olts: Array<{ id: string; name: string }>
  olt: string | null
}

type IptvOnuRow = {
  id: string
  sn: string | null
  name: string | null
  onuIf: string
  oltId: string
  oltName: string | null
  online: boolean
  status: string
  ethPorts: number[]
}

const IGMP_MODE_LABELS: Record<IgmpWorkMode, string> = {
  snooping: 'Snooping',
  spr: 'SPR',
  proxy: 'Proxy',
  router: 'Router',
}

/**
 * Ajustes → TV
 * Subtabs: Red (VLANs TV / IGMP) | Servidores (agente Go).
 */
export function TvSettingsTab({ canWrite }: { canWrite: boolean }) {
  const [sub, setSub] = useState<'red' | 'servidores'>('red')

  return (
    <div className="mt-2 w-full space-y-4">
      <div className="flex gap-1 border-b border-[var(--border)]">
        {(
          [
            { id: 'red', label: 'Red' },
            { id: 'servidores', label: 'Servidores' },
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setSub(t.id)}
            className={[
              'px-3 py-2 text-sm font-medium',
              sub === t.id
                ? 'border-b-2 border-[var(--accent)] text-[var(--text)]'
                : 'text-[var(--text-muted)] hover:text-[var(--text)]',
            ].join(' ')}
          >
            {t.label}
          </button>
        ))}
      </div>
      {sub === 'red' ? <TvRedPanel canWrite={canWrite} /> : null}
      {sub === 'servidores' ? <TvServersPanel canWrite={canWrite} /> : null}
    </div>
  )
}

function TvRedPanel({ canWrite }: { canWrite: boolean }) {
  const queryClient = useQueryClient()
  const [expanded, setExpanded] = useState<Record<number, boolean>>({})
  const [editing, setEditing] = useState<TvVlanRow | null>(null)
  /** oltId → ifName → checked */
  const [sourceSel, setSourceSel] = useState<
    Record<string, Record<string, boolean>>
  >({})
  const [error, setError] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  const vlansQuery = useQuery({
    queryKey: ['app', 'settings', 'vlans', 'tv'],
    queryFn: () =>
      apiFetch<{ vlans: TvVlanRow[] }>('/app/settings/vlans?purpose=tv'),
  })

  const topologyQuery = useQuery({
    queryKey: ['app', 'topology'],
    queryFn: () => apiFetch<{ devices: TopologyDevice[] }>('/app/topology'),
  })

  const olts = useMemo(
    () =>
      (topologyQuery.data?.devices ?? []).filter(
        (d) => d.type === 'olt' && d.isActive,
      ),
    [topologyQuery.data?.devices],
  )

  const oltById = useMemo(() => {
    const m = new Map<string, TopologyDevice>()
    for (const o of olts) m.set(o.id, o)
    return m
  }, [olts])

  const vlans = vlansQuery.data?.vlans ?? []
  const expandedVlanIds = useMemo(
    () => vlans.map((v) => v.vlanId).filter((id) => expanded[id]),
    [vlans, expanded],
  )

  const onuQueries = useQueries({
    queries: expandedVlanIds.map((vlanId) => ({
      queryKey: ['app', 'settings', 'vlans', 'tv', vlanId, 'iptv-onus'],
      queryFn: () =>
        apiFetch<{ vlanId: number; onus: IptvOnuRow[] }>(
          `/app/settings/vlans/by-vlan/${vlanId}/iptv-onus`,
        ),
      staleTime: 30_000,
    })),
  })

  const onusByVlan = useMemo(() => {
    const out: Record<
      number,
      { loading: boolean; error: string | null; onus: IptvOnuRow[] }
    > = {}
    expandedVlanIds.forEach((vlanId, i) => {
      const q = onuQueries[i]
      out[vlanId] = {
        loading: !!q?.isLoading || !!q?.isFetching,
        error: q?.error ? (q.error as Error).message : null,
        onus: q?.data?.onus ?? [],
      }
    })
    return out
  }, [expandedVlanIds, onuQueries])

  const editingOltIds = editing?.oltIds?.length
    ? editing.oltIds
    : editing?.olts?.map((o) => o.id) ?? []

  const uplinkQueries = useQueries({
    queries: editingOltIds.map((id) => ({
      queryKey: ['app', 'topology', 'devices', id, 'uplinks'],
      queryFn: () =>
        apiFetch<OltUplinksResponse>(`/app/topology/devices/${id}/uplinks`),
      enabled: !!editing,
      staleTime: 60_000,
    })),
  })

  const uplinkInfo = useMemo(() => {
    const out: Record<
      string,
      { loading: boolean; failed: boolean; uplinks: OltUplinkRow[] }
    > = {}
    editingOltIds.forEach((id, i) => {
      const q = uplinkQueries[i]
      out[id] = {
        loading: !!q?.isLoading,
        failed: !!q?.isError,
        uplinks: (q?.data?.uplinks ?? []).filter((u) => u.adminEnabled),
      }
    })
    return out
  }, [editingOltIds, uplinkQueries])

  function toggleExpand(vlanId: number) {
    setExpanded((prev) => ({ ...prev, [vlanId]: !prev[vlanId] }))
  }

  function openEdit(v: TvVlanRow) {
    setError(null)
    setMsg(null)
    setEditing(v)
    const ports = v.igmpSourcePorts ?? {}
    const next: Record<string, Record<string, boolean>> = {}
    for (const oltId of v.oltIds ?? []) {
      next[oltId] = {}
      for (const ifName of ports[oltId] ?? []) {
        next[oltId][ifName] = true
      }
    }
    setSourceSel(next)
  }

  function toggleSource(oltId: string, ifName: string) {
    setSourceSel((prev) => ({
      ...prev,
      [oltId]: {
        ...(prev[oltId] ?? {}),
        [ifName]: !(prev[oltId]?.[ifName] ?? false),
      },
    }))
  }

  const saveMut = useMutation({
    mutationFn: async () => {
      if (!editing?.id) throw new Error('VLAN sin id de catálogo')
      const igmpSourcePorts: Record<string, string[]> = {}
      for (const oltId of editing.oltIds ?? []) {
        const info = uplinkInfo[oltId]
        const selected = Object.entries(sourceSel[oltId] ?? {})
          .filter(([, on]) => on)
          .map(([ifName]) => ifName)
        if (info?.failed) {
          igmpSourcePorts[oltId] = editing.igmpSourcePorts?.[oltId] ?? []
          continue
        }
        const known = new Set((info?.uplinks ?? []).map((u) => u.ifName))
        const extras = selected.filter((n) => !known.has(n))
        const fromUi = (info?.uplinks ?? [])
          .filter((u) => sourceSel[oltId]?.[u.ifName])
          .map((u) => u.ifName)
        igmpSourcePorts[oltId] = [...fromUi, ...extras]
      }
      return apiFetch<TvVlanRow>(`/app/settings/vlans/${editing.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ igmpSourcePorts }),
      })
    },
    onSuccess: (row) => {
      void queryClient.invalidateQueries({
        queryKey: ['app', 'settings', 'vlans'],
      })
      setMsg(
        `VLAN ${row.vlanId}: source-port actualizado en las OLT asignadas.`,
      )
      setEditing(null)
    },
    onError: (e: Error) => setError(e.message),
  })

  return (
    <div className="w-full space-y-4">
      <p className="max-w-3xl text-sm text-[var(--text-muted)]">
        Multicast IPTV por VLAN TV. Despliega cada VLAN para ver las ONUs con
        eth ligado. El{' '}
        <span className="font-medium text-[var(--text)]">source-port</span> es
        el uplink del headend; el{' '}
        <span className="font-medium text-[var(--text)]">receive-port</span> se
        aplica solo en la OLT de esa ONU al asignar la VLAN en eth.
      </p>

      {msg && (
        <p className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--text)]">
          {msg}
        </p>
      )}
      {vlansQuery.error && (
        <p className="text-sm text-red-600">{vlansQuery.error.message}</p>
      )}
      {vlansQuery.isLoading && (
        <p className="text-sm text-[var(--text-muted)]">Cargando VLANs TV…</p>
      )}

      {!vlansQuery.isLoading && vlans.length === 0 && (
        <div className="rounded-lg border border-dashed border-[var(--border)] bg-[var(--bg)] px-4 py-8 text-center">
          <p className="text-sm font-medium text-[var(--text)]">
            No hay VLANs TV
          </p>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            Crea una VLAN con propósito TV en Ajustes → VLANs y asígnala a las
            OLT.
          </p>
        </div>
      )}

      {vlans.length > 0 && (
        <ul className="w-full divide-y divide-[var(--border)] rounded-lg border border-[var(--border)]">
          {vlans.map((v) => {
            const mode = v.igmpWorkMode
              ? IGMP_MODE_LABELS[v.igmpWorkMode]
              : '—'
            const sources = Object.entries(v.igmpSourcePorts ?? {})
              .filter(([, ports]) => ports.length > 0)
              .map(([oltId, ports]) => {
                const name =
                  v.olts.find((o) => o.id === oltId)?.name ||
                  oltById.get(oltId)?.name ||
                  oltId.slice(0, 8)
                return `${name}: ${ports.join(', ')}`
              })
            const isOpen = !!expanded[v.vlanId]
            const onuInfo = onusByVlan[v.vlanId]
            return (
              <li key={v.id ?? v.vlanId} className="px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    onClick={() => toggleExpand(v.vlanId)}
                    aria-expanded={isOpen}
                  >
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="text-[var(--text-muted)]" aria-hidden>
                        {isOpen ? '▾' : '▸'}
                      </span>
                      <span className="font-medium text-[var(--text)]">
                        VLAN {v.vlanId}
                      </span>
                      {v.description && (
                        <span className="text-sm text-[var(--text-muted)]">
                          {v.description}
                        </span>
                      )}
                      <span className="rounded bg-[var(--bg-elevated)] px-1.5 py-0.5 text-xs text-[var(--text-muted)]">
                        {mode}
                        {v.igmpWorkMode === 'proxy' && v.igmpHostIp
                          ? ` · ${v.igmpHostIp}`
                          : ''}
                      </span>
                    </div>
                    <p className="mt-1 pl-5 text-sm text-[var(--text-muted)]">
                      OLT: {v.olt || 'sin asignar'}
                    </p>
                    <p className="pl-5 text-sm text-[var(--text-muted)]">
                      Source-port:{' '}
                      {sources.length ? sources.join(' · ') : 'ninguno'}
                    </p>
                  </button>
                  {canWrite && v.id && (v.oltIds?.length ?? 0) > 0 && (
                    <button
                      type="button"
                      className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--text)] hover:bg-[var(--bg-elevated)]"
                      onClick={() => openEdit(v)}
                    >
                      Source-port
                    </button>
                  )}
                </div>

                {isOpen && (
                  <div className="mt-3 ml-5 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2">
                    <p className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">
                      ONUs ligadas
                    </p>
                    {onuInfo?.loading && (
                      <p className="mt-2 text-sm text-[var(--text-muted)]">
                        Cargando…
                      </p>
                    )}
                    {onuInfo?.error && (
                      <p className="mt-2 text-sm text-red-600">
                        {onuInfo.error}
                      </p>
                    )}
                    {!onuInfo?.loading &&
                      !onuInfo?.error &&
                      (onuInfo?.onus.length ?? 0) === 0 && (
                        <p className="mt-2 text-sm text-[var(--text-muted)]">
                          Ninguna ONU con eth en esta VLAN aún. Se listan al
                          asignar la VLAN TV en el puerto eth (o al abrir la
                          config TR-069 y leer OMCI).
                        </p>
                      )}
                    {(onuInfo?.onus.length ?? 0) > 0 && (
                      <ul className="mt-2 divide-y divide-[var(--border)]">
                        {onuInfo!.onus.map((o) => (
                          <li
                            key={o.id}
                            className="flex flex-wrap items-baseline justify-between gap-2 py-2 text-sm"
                          >
                            <div className="min-w-0">
                              <span className="font-medium text-[var(--text)]">
                                {o.name || o.sn || o.onuIf}
                              </span>
                              {o.sn && o.name && (
                                <span className="ml-2 text-[var(--text-muted)]">
                                  {o.sn}
                                </span>
                              )}
                              <p className="text-xs text-[var(--text-muted)]">
                                {o.oltName || 'OLT'} · {o.onuIf}
                                {o.ethPorts.length
                                  ? ` · eth_0/${o.ethPorts.join(', eth_0/')}`
                                  : ''}
                              </p>
                            </div>
                            <span
                              className={
                                o.online
                                  ? 'text-xs text-emerald-600'
                                  : 'text-xs text-[var(--text-muted)]'
                              }
                            >
                              {o.online ? 'Online' : o.status || 'Offline'}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {editing && (
        <ModalPortal>
          <div className="fixed inset-0 z-[100] modal-backdrop flex items-stretch justify-center overflow-hidden bg-black/50 sm:items-center sm:p-4">
            <div
              role="dialog"
              aria-modal="true"
              className="flex h-[100dvh] max-h-[100dvh] w-full max-w-lg flex-col overflow-hidden rounded-none border-0 bg-[var(--bg-elevated)] shadow-xl sm:h-auto sm:max-h-[min(92dvh,920px)] sm:rounded-xl sm:border border-[var(--border)]"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-5 text-[var(--text)]">
                <h2 className="text-lg font-semibold text-[var(--text)]">
                  Source-port · VLAN {editing.vlanId}
                </h2>
                <p className="mt-1 text-sm text-[var(--text-muted)]">
                  Uplinks por donde entra el multicast. Se aplica como{' '}
                  <code>igmp mvlan {editing.vlanId} source-port</code>.
                </p>

                <div className="mt-4 space-y-4">
                  {(editing.oltIds ?? []).map((oltId) => {
                    const oltName =
                      editing.olts.find((o) => o.id === oltId)?.name ||
                      oltById.get(oltId)?.name ||
                      oltId
                    const info = uplinkInfo[oltId]
                    const stored = editing.igmpSourcePorts?.[oltId] ?? []
                    return (
                      <div
                        key={oltId}
                        className="rounded-lg border border-[var(--border)] p-3"
                      >
                        <p className="text-sm font-medium text-[var(--text)]">
                          {oltName}
                        </p>
                        {info?.loading && (
                          <p className="mt-2 text-sm text-[var(--text-muted)]">
                            Leyendo uplinks…
                          </p>
                        )}
                        {info?.failed && (
                          <p className="mt-2 text-sm text-amber-700">
                            No se pudieron leer uplinks; se mantendrá la
                            selección guardada (
                            {stored.join(', ') || 'ninguno'}).
                          </p>
                        )}
                        {!info?.loading &&
                          !info?.failed &&
                          (info?.uplinks.length ?? 0) === 0 && (
                            <p className="mt-2 text-sm text-[var(--text-muted)]">
                              Sin uplinks habilitados. Sincroniza la OLT en
                              topología.
                            </p>
                          )}
                        <ul className="mt-2 space-y-1">
                          {(info?.uplinks ?? []).map((u) => (
                            <li key={u.ifName}>
                              <label className="flex cursor-pointer items-center gap-2 text-sm text-[var(--text)]">
                                <input
                                  type="checkbox"
                                  className="rounded border-[var(--border)]"
                                  checked={!!sourceSel[oltId]?.[u.ifName]}
                                  onChange={() =>
                                    toggleSource(oltId, u.ifName)
                                  }
                                  disabled={!canWrite || saveMut.isPending}
                                />
                                <span className="font-mono text-xs">
                                  {u.ifName}
                                </span>
                                {u.taggedVlansLabel && (
                                  <span className="text-xs text-[var(--text-muted)]">
                                    {u.taggedVlansLabel}
                                  </span>
                                )}
                              </label>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )
                  })}
                </div>

                {error && (
                  <p className="mt-3 text-sm text-red-600">{error}</p>
                )}
              </div>

              <div className="flex shrink-0 justify-end gap-2 border-t border-[var(--border)] px-5 py-3">
                <button
                  type="button"
                  className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm text-[var(--text)] hover:bg-[var(--bg)]"
                  onClick={() => {
                    setEditing(null)
                    setError(null)
                  }}
                  disabled={saveMut.isPending}
                >
                  Cancelar
                </button>
                {canWrite && (
                  <button
                    type="button"
                    className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                    disabled={saveMut.isPending}
                    onClick={() => saveMut.mutate()}
                  >
                    {saveMut.isPending ? 'Aplicando…' : 'Guardar y aplicar'}
                  </button>
                )}
              </div>
            </div>
          </div>
        </ModalPortal>
      )}
    </div>
  )
}
