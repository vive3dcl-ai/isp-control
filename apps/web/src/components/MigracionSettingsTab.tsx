import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'
import type { TopologyDevice } from '../lib/topology'
import type { IpPoolsResponse } from '../lib/ip-pools'
import type { Tr069ProfilesResponse } from '../lib/tr069'
import {
  filterBySourceVlan,
  matchesSearch,
  scanMigrationOlts,
  type MigrationCandidate,
  type MigrationSegmentConfig,
} from '../lib/onu-migration'
import { MigrationWizardModal } from './MigrationWizardModal'

/** Subset of the VLAN catalog (Ajustes → VLANs) needed to label the segment. */
type CatalogVlan = {
  vlanId: number
  description: string | null
  oltIds: string[]
}

type SourceVlanOption = {
  vlanId: number
  description: string | null
  candidates: number
  /** Present in the VLAN catalog, not just detected on an ONU. */
  inCatalog: boolean
}

export function MigracionSettingsTab({ canWrite }: { canWrite: boolean }) {
  const queryClient = useQueryClient()
  const [oltId, setOltId] = useState('')
  const [sourceVlan, setSourceVlan] = useState<string>('')
  const [search, setSearch] = useState('')
  const [mgmtVlanPick, setMgmtVlanPick] = useState('')
  const [wanVlanPick, setWanVlanPick] = useState('')
  const [tr069ProfilePick, setTr069ProfilePick] = useState('')
  const [migratedIfs, setMigratedIfs] = useState<Set<string>>(new Set())
  const [wizardOpen, setWizardOpen] = useState(false)
  const [current, setCurrent] = useState<MigrationCandidate | null>(null)

  const topologyQuery = useQuery({
    queryKey: ['app', 'topology'],
    queryFn: () =>
      apiFetch<{ devices: TopologyDevice[] }>('/app/topology'),
  })

  const olts = useMemo(
    () =>
      (topologyQuery.data?.devices ?? []).filter(
        (d) => d.type === 'olt' && d.isActive,
      ),
    [topologyQuery.data?.devices],
  )

  const selectedOlt = olts.find((o) => o.id === oltId)

  const inventoryQuery = useQuery({
    queryKey: ['app', 'onus', 'migration', 'scan', oltId],
    queryFn: () => scanMigrationOlts(oltId),
    enabled: !!oltId && canWrite,
  })

  const scan = inventoryQuery.data ?? null

  const mgmtPoolsQuery = useQuery({
    queryKey: ['app', 'settings', 'ip-pools', 'management', oltId],
    queryFn: () =>
      apiFetch<IpPoolsResponse>(
        `/app/settings/ip-pools?purpose=management&oltId=${encodeURIComponent(oltId)}`,
      ),
    enabled: !!oltId,
  })
  const wanPoolsQuery = useQuery({
    queryKey: ['app', 'settings', 'ip-pools', 'internet', oltId],
    queryFn: () =>
      apiFetch<IpPoolsResponse>(
        `/app/settings/ip-pools?purpose=internet&oltId=${encodeURIComponent(oltId)}`,
      ),
    enabled: !!oltId,
  })
  const tr069Query = useQuery({
    queryKey: ['app', 'settings', 'tr069', 'profiles'],
    queryFn: () =>
      apiFetch<Tr069ProfilesResponse>('/app/settings/tr069/profiles'),
    enabled: !!oltId,
  })
  const catalogVlansQuery = useQuery({
    queryKey: ['app', 'settings', 'vlans'],
    queryFn: () =>
      apiFetch<{ vlans: CatalogVlan[] }>('/app/settings/vlans'),
  })

  const mgmtPools = mgmtPoolsQuery.data?.pools ?? []
  const wanPools = wanPoolsQuery.data?.pools ?? []
  const tr069Profiles = useMemo(() => {
    const all = tr069Query.data?.profiles ?? []
    if (!oltId) return all
    return all.filter((p) => !p.oltIds?.length || p.oltIds.includes(oltId))
  }, [tr069Query.data?.profiles, oltId])

  const sourceVlanNum = sourceVlan ? Number(sourceVlan) : null

  const segmentCandidates = useMemo(
    () => filterBySourceVlan(scan?.candidates ?? [], sourceVlanNum),
    [scan, sourceVlanNum],
  )

  const pending = useMemo(
    () => segmentCandidates.filter((c) => !migratedIfs.has(c.onuIf)),
    [segmentCandidates, migratedIfs],
  )

  const segmentTotal = segmentCandidates.length
  const segmentDone = segmentTotal - pending.length

  /** Search only narrows the table; progress stays on the whole segment. */
  const visibleCandidates = useMemo(
    () => segmentCandidates.filter((c) => matchesSearch(c, search)),
    [segmentCandidates, search],
  )

  const sourceVlanOptions = useMemo<SourceVlanOption[]>(() => {
    const counts = new Map<number, number>()
    for (const c of scan?.candidates ?? []) {
      const ids = new Set<number>(c.vlans ?? [])
      if (c.vlan != null) ids.add(c.vlan)
      for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1)
    }

    const byId = new Map<number, SourceVlanOption>()
    for (const v of scan?.sourceVlans ?? []) {
      byId.set(v, {
        vlanId: v,
        description: null,
        candidates: counts.get(v) ?? 0,
        inCatalog: false,
      })
    }
    // The scan only reports VLANs it saw on candidate ONUs, so VLANs created in
    // the system are missing until an ONU actually uses them. Merge the catalog
    // in (skipping VLANs pushed only to other OLTs) so they can be picked.
    for (const v of catalogVlansQuery.data?.vlans ?? []) {
      if (oltId && v.oltIds?.length && !v.oltIds.includes(oltId)) continue
      const prev = byId.get(v.vlanId)
      byId.set(v.vlanId, {
        vlanId: v.vlanId,
        description: v.description ?? prev?.description ?? null,
        candidates: prev?.candidates ?? counts.get(v.vlanId) ?? 0,
        inCatalog: true,
      })
    }
    return [...byId.values()].sort((a, b) => a.vlanId - b.vlanId)
  }, [scan, catalogVlansQuery.data?.vlans, oltId])

  const busy = inventoryQuery.isFetching

  const canStart =
    canWrite &&
    !!oltId &&
    !!mgmtVlanPick &&
    !!wanVlanPick &&
    pending.length > 0 &&
    !busy

  const segmentConfig: MigrationSegmentConfig | null =
    selectedOlt && mgmtVlanPick && wanVlanPick
      ? {
          oltId,
          oltName: selectedOlt.name,
          sourceVlan: sourceVlanNum,
          mgmtVlanId: Number(mgmtVlanPick),
          wanVlanId: Number(wanVlanPick),
          tr069ProfileId: tr069ProfilePick || null,
        }
      : null

  function startWizard(c?: MigrationCandidate) {
    const next = c ?? pending[0]
    if (!next || !segmentConfig) return
    setCurrent(next)
    setWizardOpen(true)
  }

  function handleMigrated(onuIf: string) {
    const nextSet = new Set(migratedIfs).add(onuIf)
    setMigratedIfs(nextSet)
    void queryClient.invalidateQueries({
      queryKey: ['app', 'onus', 'migration', 'scan', oltId],
    })
    const nextPending = filterBySourceVlan(
      scan?.candidates ?? [],
      sourceVlanNum,
    ).filter((c) => !nextSet.has(c.onuIf))
    if (nextPending.length > 0 && segmentConfig) {
      setCurrent(nextPending[0])
      setWizardOpen(true)
    } else {
      setWizardOpen(false)
      setCurrent(null)
    }
  }

  const pct =
    segmentTotal > 0 ? Math.round((segmentDone / segmentTotal) * 100) : 0

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-base font-semibold">Migración de ONUs</h2>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          Al elegir la OLT se listan las ONUs del inventario sin
          cliente/servicio. Elige VLAN destino y migra una a una.
        </p>
      </div>

      {!canWrite && (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
          Necesitas permiso de escritura CRM/topología para migrar.
        </p>
      )}

      <div className="grid gap-3 rounded-xl border border-[var(--border)] bg-[var(--bg)]/40 p-4 sm:grid-cols-2 lg:grid-cols-3">
        <label className="block text-sm">
          <span className="mb-1 block text-[var(--text-muted)]">OLT</span>
          <select
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2"
            value={oltId}
            disabled={!canWrite}
            onChange={(e) => {
              setOltId(e.target.value)
              setMigratedIfs(new Set())
              setMgmtVlanPick('')
              setWanVlanPick('')
              setTr069ProfilePick('')
              setSourceVlan('')
              setSearch('')
            }}
          >
            <option value="">Seleccionar…</option>
            {olts.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-sm">
          <span className="mb-1 block text-[var(--text-muted)]">
            VLAN origen (segmento)
          </span>
          <select
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2"
            value={sourceVlan}
            disabled={!oltId}
            onChange={(e) => {
              setSourceVlan(e.target.value)
              setMigratedIfs(new Set())
            }}
          >
            <option value="">Todas las candidatas</option>
            {sourceVlanOptions.map((v) => (
              <option key={v.vlanId} value={String(v.vlanId)}>
                VLAN {v.vlanId}
                {v.description ? ` — ${v.description}` : ''}
                {v.candidates > 0
                  ? ` · ${v.candidates} candidata${v.candidates === 1 ? '' : 's'}`
                  : ' · sin candidatas'}
                {v.inCatalog ? '' : ' · fuera del catálogo'}
              </option>
            ))}
          </select>
          {sourceVlanOptions.length === 0 && !!oltId && (
            <span className="mt-1 block text-xs text-[var(--text-muted)]">
              Sin VLANs detectadas ni en el catálogo. Créalas en Ajustes →
              VLANs.
            </span>
          )}
        </label>

        <label className="block text-sm">
          <span className="mb-1 block text-[var(--text-muted)]">
            VLAN mgmt destino
          </span>
          <select
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2"
            value={mgmtVlanPick}
            disabled={!oltId}
            onChange={(e) => setMgmtVlanPick(e.target.value)}
          >
            <option value="">Seleccionar…</option>
            {mgmtPools.map((p) => (
              <option key={p.id} value={String(p.vlanId)}>
                VLAN {p.vlanId}
                {p.name ? ` · ${p.name}` : ''} ({p.available} libres)
              </option>
            ))}
          </select>
        </label>

        <label className="block text-sm">
          <span className="mb-1 block text-[var(--text-muted)]">
            VLAN WAN destino
          </span>
          <select
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2"
            value={wanVlanPick}
            disabled={!oltId}
            onChange={(e) => setWanVlanPick(e.target.value)}
          >
            <option value="">Seleccionar…</option>
            {wanPools.map((p) => (
              <option key={p.id} value={String(p.vlanId)}>
                VLAN {p.vlanId}
                {p.name ? ` · ${p.name}` : ''} ({p.available} libres)
              </option>
            ))}
          </select>
        </label>

        <label className="block text-sm">
          <span className="mb-1 block text-[var(--text-muted)]">
            Perfil TR069
          </span>
          <select
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2"
            value={tr069ProfilePick}
            disabled={!mgmtVlanPick}
            onChange={(e) => setTr069ProfilePick(e.target.value)}
          >
            <option value="">
              {mgmtVlanPick ? 'Opcional…' : 'Elegir administración primero'}
            </option>
            {tr069Profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {inventoryQuery.isError && (
        <p className="text-sm text-[var(--danger)]">
          {(inventoryQuery.error as Error).message}
        </p>
      )}

      {oltId && inventoryQuery.isLoading && (
        <p className="text-sm text-[var(--text-muted)]">
          Cargando inventario…
        </p>
      )}

      {scan && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm text-[var(--text-muted)]">
              OLT <strong className="text-[var(--text)]">{scan.oltName}</strong>
              : {scan.totalCandidates} sin cliente/servicio · segmento{' '}
              {pending.length} pendientes
            </div>
            <button
              type="button"
              disabled={!canStart}
              onClick={() => startWizard()}
              className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              Migrar siguiente
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm outline-none ring-[var(--accent)] focus:ring-2"
              placeholder="Buscar cliente, SN, ONU, VLAN…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search.trim() && (
              <>
                <span className="shrink-0 text-xs text-[var(--text-muted)]">
                  {visibleCandidates.length} de {segmentTotal}
                </span>
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  className="shrink-0 rounded-lg border border-[var(--border)] px-2 py-1 text-xs hover:border-[var(--accent)] hover:text-[var(--accent)]"
                >
                  Limpiar
                </button>
              </>
            )}
          </div>

          <div>
            <div className="mb-1 flex justify-between text-[11px] text-[var(--text-muted)]">
              <span>
                Progreso segmento {segmentDone}/{segmentTotal}
              </span>
              <span>{pct}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-[var(--bg)]">
              <div
                className="h-full rounded-full bg-emerald-500 transition-all"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>

          <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-[var(--border)] bg-[var(--bg)]/60 text-[11px] uppercase tracking-wide text-[var(--text-muted)]">
                <tr>
                  <th className="px-3 py-2">ONU</th>
                  <th className="px-3 py-2">SN</th>
                  <th className="px-3 py-2">Nombre / desc</th>
                  <th className="px-3 py-2">VLANs</th>
                  <th className="px-3 py-2">Cliente sugerido</th>
                  <th className="px-3 py-2">Estado</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {visibleCandidates.map(
                  (c) => {
                    const done = migratedIfs.has(c.onuIf)
                    return (
                      <tr
                        key={c.onuIf}
                        className="border-b border-[var(--border)] last:border-0"
                      >
                        <td className="px-3 py-2 font-mono text-xs">
                          {c.onuIf}
                        </td>
                        <td className="px-3 py-2 font-mono text-xs">
                          {c.sn || '—'}
                        </td>
                        <td className="px-3 py-2">
                          <div className="max-w-[14rem] truncate">
                            {c.name || '—'}
                          </div>
                          <div className="max-w-[14rem] truncate text-xs text-[var(--text-muted)]">
                            {c.description || ''}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-xs">
                          {(c.vlans.length
                            ? c.vlans
                            : c.vlan != null
                              ? [c.vlan]
                              : []
                          ).join(', ') || '—'}
                        </td>
                        <td className="px-3 py-2">
                          {c.suggestedClientName ? (
                            <div>
                              <div className="max-w-[14rem] truncate">
                                {c.suggestedFirstName ||
                                  c.suggestedClientName}
                                {c.suggestedLastName
                                  ? ` ${c.suggestedLastName}`
                                  : ''}
                              </div>
                              {c.suggestedServiceName ? (
                                <div className="text-[10px] text-[var(--text-muted)]">
                                  svc: {c.suggestedServiceName}
                                </div>
                              ) : null}
                            </div>
                          ) : (
                            <span className="text-[var(--text-muted)]">
                              —
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-xs">
                          {done ? (
                            <span className="text-emerald-400">Migrada</span>
                          ) : c.online ? (
                            <span className="text-emerald-400">Online</span>
                          ) : (
                            <span className="text-amber-300">Offline</span>
                          )}
                          {!c.inDb && !done && (
                            <span className="ml-1 text-[var(--text-muted)]">
                              (sin DB)
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {!done && canWrite && (
                            <button
                              type="button"
                              disabled={!mgmtVlanPick || !wanVlanPick}
                              onClick={() => startWizard(c)}
                              className="rounded-md border border-[var(--border)] px-2 py-1 text-xs hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-40"
                            >
                              Migrar
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  },
                )}
                {visibleCandidates.length === 0 && (
                  <tr>
                    <td
                      colSpan={7}
                      className="px-3 py-6 text-center text-[var(--text-muted)]"
                    >
                      {search.trim()
                        ? `Ninguna candidata coincide con «${search.trim()}».`
                        : 'No hay candidatas en este segmento.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {pct === 100 && segmentTotal > 0 && (
            <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">
              Segmento completo (100%). Elige otra VLAN origen.
            </p>
          )}
        </div>
      )}

      {segmentConfig && (
        <MigrationWizardModal
          open={wizardOpen}
          candidate={current}
          segment={segmentConfig}
          segmentDone={segmentDone}
          segmentTotal={segmentTotal}
          remaining={pending.length}
          onClose={() => {
            setWizardOpen(false)
            setCurrent(null)
          }}
          onMigrated={handleMigrated}
          onPause={() => {
            setWizardOpen(false)
            setCurrent(null)
          }}
        />
      )}
    </div>
  )
}
