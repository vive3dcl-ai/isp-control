import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'
import type {
  AuthorizeOnuResponse,
  ConnectedOnu,
  ConnectedOnusResponse,
  UncfgOnu,
  UncfgResponse,
} from '../lib/onu-connected'
import {
  onuDescriptionForService,
  oltOnuName,
} from '../lib/onu-connected'
import type { IpPoolsResponse } from '../lib/ip-pools'
import type { Tr069ProfilesResponse } from '../lib/tr069'
import type { ClientService } from '../lib/crm'
import {
  OperationProgressModal,
  runProgressSteps,
  type ProgressStep,
} from './OperationProgressModal'
import { ModalPortal } from './ModalPortal'

const inputClass =
  'w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm outline-none ring-[var(--accent)] focus:ring-2'

function namesMatch(a: string | null | undefined, b: string) {
  if (!a) return false
  return a.replace(/\s+/g, ' ').trim().toLowerCase() === b.toLowerCase()
}

export function ChangeServiceOnuModal({
  open,
  onClose,
  clientId,
  clientName,
  service,
  currentOnu,
}: {
  open: boolean
  onClose: () => void
  clientId: string
  clientName: string
  service: ClientService
  currentOnu: ConnectedOnu | null
}) {
  const queryClient = useQueryClient()
  const targetName = oltOnuName(clientName, service.name)

  const [oltFilter, setOltFilter] = useState('')
  const [search, setSearch] = useState('')
  const [orphan, setOrphan] = useState<UncfgOnu | null>(null)
  const [onuNumber, setOnuNumber] = useState('')
  const [mgmtVlanPick, setMgmtVlanPick] = useState('')
  const [wanVlanPick, setWanVlanPick] = useState('')
  const [tr069ProfilePick, setTr069ProfilePick] = useState('')
  const [error, setError] = useState<string | null>(null)

  const [progressOpen, setProgressOpen] = useState(false)
  const [progressSteps, setProgressSteps] = useState<ProgressStep[]>([])
  const [progressRunning, setProgressRunning] = useState(false)
  const [progressFailed, setProgressFailed] = useState(false)
  const [progressDone, setProgressDone] = useState(false)
  const runnersRef = useRef<Record<string, () => Promise<string | void>>>({})
  const ctxRef = useRef<{ onuDbId?: string }>({})

  useEffect(() => {
    if (!open) return
    setOltFilter(currentOnu?.oltId ?? '')
    setSearch('')
    setOrphan(null)
    setOnuNumber('')
    setMgmtVlanPick(
      currentOnu?.mgmtVlanId != null ? String(currentOnu.mgmtVlanId) : '',
    )
    setWanVlanPick(
      currentOnu?.wanVlanId != null ? String(currentOnu.wanVlanId) : '',
    )
    setTr069ProfilePick(currentOnu?.tr069ProfileId ?? '')
    setError(null)
    setProgressOpen(false)
    setProgressFailed(false)
    setProgressDone(false)
    ctxRef.current = {}
  }, [open, currentOnu])

  const connectedQuery = useQuery({
    queryKey: ['app', 'onus'],
    queryFn: () => apiFetch<ConnectedOnusResponse>('/app/onus'),
    enabled: open,
    staleTime: 15_000,
  })

  const uncfgQuery = useQuery({
    queryKey: ['app', 'onus', 'uncfg', oltFilter],
    queryFn: () =>
      apiFetch<UncfgResponse>('/app/onus/uncfg', {
        method: 'POST',
        body: JSON.stringify(oltFilter ? { oltId: oltFilter } : {}),
      }),
    enabled: open,
    staleTime: 30_000,
  })

  const mgmtPoolsQuery = useQuery({
    queryKey: ['app', 'settings', 'ip-pools', 'management', orphan?.oltId],
    queryFn: () =>
      apiFetch<IpPoolsResponse>(
        `/app/settings/ip-pools?purpose=management&oltId=${encodeURIComponent(orphan!.oltId)}`,
      ),
    enabled: open && !!orphan,
  })

  const wanPoolsQuery = useQuery({
    queryKey: ['app', 'settings', 'ip-pools', 'internet', orphan?.oltId],
    queryFn: () =>
      apiFetch<IpPoolsResponse>(
        `/app/settings/ip-pools?purpose=internet&oltId=${encodeURIComponent(orphan!.oltId)}`,
      ),
    enabled: open && !!orphan,
  })

  const tr069ProfilesQuery = useQuery({
    queryKey: ['app', 'settings', 'tr069', 'profiles'],
    queryFn: () =>
      apiFetch<Tr069ProfilesResponse>('/app/settings/tr069/profiles'),
    enabled: open && !!orphan,
    staleTime: 60_000,
  })

  const mgmtPools = mgmtPoolsQuery.data?.pools ?? []
  const wanPools = wanPoolsQuery.data?.pools ?? []
  const tr069Profiles = useMemo(() => {
    const all = tr069ProfilesQuery.data?.profiles ?? []
    const oltId = orphan?.oltId
    if (!oltId) return all
    const attached = all.filter((p) => p.oltIds?.includes(oltId))
    return attached.length ? attached : all
  }, [tr069ProfilesQuery.data?.profiles, orphan?.oltId])

  useEffect(() => {
    if (!orphan) return
    if (!mgmtVlanPick && mgmtPools.length === 1) {
      setMgmtVlanPick(String(mgmtPools[0].vlanId))
    }
  }, [orphan, mgmtPools, mgmtVlanPick])

  useEffect(() => {
    if (!orphan || tr069ProfilePick) return
    if (tr069Profiles.length === 1) {
      setTr069ProfilePick(tr069Profiles[0].id)
    }
  }, [orphan, tr069Profiles, tr069ProfilePick])

  const orphans = useMemo(() => {
    const all = uncfgQuery.data?.onus ?? []
    const q = search.trim().toLowerCase()
    if (!q) return all
    return all.filter((o) =>
      [o.sn, o.oltIf, o.oltName, o.state ?? '', o.ponType]
        .join(' ')
        .toLowerCase()
        .includes(q),
    )
  }, [uncfgQuery.data?.onus, search])

  /** ONUs conectadas que hay que liberar (mismo nombre o la enlazada). */
  const toRelease = useMemo(() => {
    const list = connectedQuery.data?.onus ?? []
    const byName = list.filter((o) => namesMatch(o.name, targetName))
    const linked = currentOnu
      ? list.find((o) => o.id === currentOnu.id) ?? currentOnu
      : null
    const map = new Map<string, ConnectedOnu>()
    for (const o of byName) map.set(o.id, o)
    if (linked) map.set(linked.id, linked)
    return [...map.values()]
  }, [connectedQuery.data?.onus, currentOnu, targetName])

  function pickOrphan(o: UncfgOnu) {
    setOrphan(o)
    setOnuNumber(o.suggestedOnuId != null ? String(o.suggestedOnuId) : '1')
  }

  function startSwap() {
    if (!orphan) {
      setError('Selecciona una ONU huérfana.')
      return
    }
    if (!/^\d+$/.test(onuNumber.trim())) {
      setError('El ONU ID debe ser un número.')
      return
    }
    if (mgmtVlanPick && tr069Profiles.length > 0 && !tr069ProfilePick) {
      setError('Selecciona el perfil TR069.')
      return
    }
    setError(null)

    const mgmtVlan = mgmtVlanPick ? Number(mgmtVlanPick) : null
    const wanVlan = wanVlanPick ? Number(wanVlanPick) : null
    const hasNetwork = mgmtVlan != null || wanVlan != null
    const vlanBody: {
      mgmtVlanId?: number
      wanVlanId?: number
      tr069ProfileId?: string
    } = {}
    if (mgmtVlan != null) vlanBody.mgmtVlanId = mgmtVlan
    if (wanVlan != null) vlanBody.wanVlanId = wanVlan
    if (mgmtVlan != null && tr069ProfilePick) {
      vlanBody.tr069ProfileId = tr069ProfilePick
    }

    const releaseTargets = [...toRelease]
    const steps: ProgressStep[] = [
      ...(releaseTargets.length
        ? ([
            {
              id: 'release',
              label: `Liberar ONU(s) con nombre «${targetName}» (vuelven a huérfanas)`,
              status: 'pending',
            },
          ] satisfies ProgressStep[])
        : []),
      {
        id: 'authorize',
        label: `Autorizar nueva ONU como «${targetName}»`,
        status: 'pending',
      },
      ...(hasNetwork
        ? ([
            {
              id: 'olt',
              label: 'Configurar VLANs en la OLT',
              status: 'pending',
            },
            {
              id: 'assign',
              label: 'Asignar IPs de los pools',
              status: 'pending',
            },
            {
              id: 'apply',
              label: 'Aplicar configuración a la ONU',
              status: 'pending',
            },
            {
              id: 'verify',
              label: 'Esperando ONU online y verificando configuración',
              status: 'pending',
            },
          ] satisfies ProgressStep[])
        : []),
      {
        id: 'link',
        label: 'Enlazar ONU al servicio',
        status: 'pending',
      },
    ]

    const requireOnuDbId = () => {
      const id = ctxRef.current.onuDbId
      if (!id) throw new Error('No se obtuvo el ID de la ONU autorizada')
      return id
    }

    const runners: Record<string, () => Promise<string | void>> = {
      release: async () => {
        const notes: string[] = []
        for (const o of releaseTargets) {
          await apiFetch('/app/onus/delete', {
            method: 'POST',
            body: JSON.stringify({ oltId: o.oltId, onuIf: o.onuIf }),
          })
          notes.push(`${o.sn || o.onuIf}`)
        }
        // Desenlazar mientras tanto para no dejar un id huérfano en el servicio.
        await apiFetch(`/app/client-services/${service.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ onuId: null }),
        })
        return notes.length
          ? `Liberadas: ${notes.join(', ')}`
          : 'Sin ONUs que liberar'
      },
      authorize: async () => {
        const r = await apiFetch<AuthorizeOnuResponse>('/app/onus/authorize', {
          method: 'POST',
          body: JSON.stringify({
            oltId: orphan.oltId,
            oltIf: orphan.oltIf,
            onuId: onuNumber.trim(),
            sn: orphan.sn,
            onuType: null,
            name: targetName,
            description: onuDescriptionForService({
              latitude: service.latitude,
              longitude: service.longitude,
              street: service.street,
              city: service.city,
              zipCode: service.zipCode,
            }),
          }),
        })
        ctxRef.current.onuDbId = r.onu?.id
        return r.message || 'ONU autorizada'
      },
      olt: async () => {
        const r = await apiFetch<{ message?: string }>(
          `/app/onus/${requireOnuDbId()}/network-vlans/olt`,
          { method: 'POST', body: JSON.stringify(vlanBody) },
        )
        return r.message || 'OLT OK'
      },
      assign: async () => {
        const r = await apiFetch<{ message?: string }>(
          `/app/onus/${requireOnuDbId()}/network-vlans/assign`,
          { method: 'POST', body: JSON.stringify(vlanBody) },
        )
        return r.message || 'IPs asignadas'
      },
      apply: async () => {
        let lastErr: unknown = null
        for (let attempt = 1; attempt <= 2; attempt++) {
          try {
            const r = await apiFetch<{ message?: string }>(
              `/app/onus/${requireOnuDbId()}/network-vlans/apply`,
              { method: 'POST', body: JSON.stringify(vlanBody) },
            )
            return `${r.message || 'ONU OK'}${attempt > 1 ? ` (intento ${attempt})` : ''}`
          } catch (e) {
            lastErr = e
          }
        }
        throw new Error(
          lastErr instanceof Error ? lastErr.message : String(lastErr),
        )
      },
      verify: async () => {
        const r = await apiFetch<{
          ok: boolean
          message?: string
          mgmtVlanId?: number | null
          wanVlanId?: number | null
        }>(`/app/onus/${requireOnuDbId()}/network-vlans/verify`, {
          method: 'POST',
        })
        if (mgmtVlan != null && r.mgmtVlanId !== mgmtVlan) {
          throw new Error(
            `Mgmt quedó en VLAN ${r.mgmtVlanId ?? '—'}, se esperaba ${mgmtVlan}`,
          )
        }
        if (wanVlan != null && r.wanVlanId !== wanVlan) {
          throw new Error(
            `WAN quedó en VLAN ${r.wanVlanId ?? '—'}, se esperaba ${wanVlan}`,
          )
        }
        return r.message || 'Verificado'
      },
      link: async () => {
        await apiFetch(`/app/client-services/${service.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ onuId: requireOnuDbId() }),
        })
        return 'Servicio actualizado'
      },
    }

    runnersRef.current = runners
    setProgressSteps(steps)
    setProgressOpen(true)
    void executeProgress(steps)
  }

  async function executeProgress(steps: ProgressStep[]) {
    setProgressRunning(true)
    setProgressFailed(false)
    setProgressDone(false)
    const result = await runProgressSteps(
      steps,
      setProgressSteps,
      runnersRef.current,
    )
    setProgressRunning(false)
    if (result.ok) {
      setProgressDone(true)
      void queryClient.invalidateQueries({
        queryKey: ['app', 'clients', clientId],
      })
      void queryClient.invalidateQueries({ queryKey: ['app', 'onus'] })
      void queryClient.invalidateQueries({
        queryKey: ['app', 'settings', 'ip-pools'],
      })
    } else {
      setProgressFailed(true)
    }
  }

  if (!open) return null

  return (
    <>
      <ModalPortal><div className="fixed inset-0 z-[110] modal-backdrop flex items-stretch justify-center overflow-hidden bg-black/60 sm:items-center sm:p-4">
        <div className="flex h-[100dvh] max-h-[100dvh] w-full max-w-xl flex-col overflow-hidden rounded-none border-0 sm:h-auto sm:max-h-[min(92dvh,920px)] sm:rounded-xl sm:border border-[var(--border)] bg-[var(--bg-elevated)] shadow-xl">
          <div className="shrink-0 border-b border-[var(--border)] px-4 py-3 sm:px-5 sm:py-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="min-w-0 text-lg font-semibold">Cambiar ONU</h2>
              <button
                type="button"
                onClick={onClose}
                className="rounded-md px-2 py-1 text-[var(--text-muted)] hover:bg-[var(--bg)]"
              >
                ✕
              </button>
            </div>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              Nombre en OLT:{' '}
              <span className="font-medium text-[var(--text)]">
                {targetName}
              </span>
              {toRelease.length > 0 && (
                <>
                  {' '}
                  · Se liberarán {toRelease.length} ONU(s) conectada(s) con ese
                  nombre antes de aprovisionar la nueva.
                </>
              )}
            </p>
          </div>

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5">
            <div className="flex flex-wrap gap-2">
              <select
                className={`${inputClass} w-auto min-w-[11rem]`}
                value={oltFilter}
                onChange={(e) => setOltFilter(e.target.value)}
              >
                <option value="">Todas las OLTs</option>
                {(uncfgQuery.data?.olts ?? connectedQuery.data?.olts ?? []).map(
                  (o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ),
                )}
              </select>
              <input
                className={`${inputClass} min-w-[12rem] flex-1`}
                placeholder="Buscar por serial, puerto…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <button
                type="button"
                disabled={uncfgQuery.isFetching}
                onClick={() => void uncfgQuery.refetch()}
                className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm hover:bg-[var(--bg)] disabled:opacity-60"
              >
                {uncfgQuery.isFetching ? 'Buscando…' : 'Refrescar'}
              </button>
            </div>

            {uncfgQuery.error && (
              <p className="text-sm text-[var(--danger)]">
                {uncfgQuery.error.message}
              </p>
            )}

            <div className="max-h-56 overflow-y-auto rounded-lg border border-[var(--border)]">
              {uncfgQuery.isLoading ? (
                <p className="px-3 py-6 text-sm text-[var(--text-muted)]">
                  Buscando ONUs huérfanas…
                </p>
              ) : orphans.length === 0 ? (
                <p className="px-3 py-6 text-sm text-[var(--text-muted)]">
                  No hay ONUs huérfanas
                  {search ? ' que coincidan' : ''}.
                </p>
              ) : (
                <ul className="divide-y divide-[var(--border)]">
                  {orphans.map((o) => {
                    const selected =
                      orphan?.sn === o.sn && orphan?.oltIf === o.oltIf
                    return (
                      <li key={`${o.oltId}-${o.oltIf}-${o.sn}`}>
                        <button
                          type="button"
                          onClick={() => pickOrphan(o)}
                          className={[
                            'flex w-full items-center gap-3 px-3 py-2 text-left text-sm',
                            selected
                              ? 'bg-[var(--accent)]/10'
                              : 'hover:bg-[var(--bg)]',
                          ].join(' ')}
                        >
                          <span
                            className={[
                              'flex h-4 w-4 shrink-0 items-center justify-center rounded-full border',
                              selected
                                ? 'border-[var(--accent)]'
                                : 'border-[var(--border)]',
                            ].join(' ')}
                          >
                            {selected && (
                              <span className="h-2 w-2 rounded-full bg-[var(--accent)]" />
                            )}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block font-mono text-xs">
                              {o.sn}
                            </span>
                            <span className="block text-xs text-[var(--text-muted)]">
                              {o.oltName} · {o.oltIf}
                            </span>
                          </span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>

            {orphan && (
              <>
                <label className="block text-sm">
                  <span className="mb-1 block text-[var(--text-muted)]">
                    ONU ID en el puerto
                  </span>
                  <input
                    className={inputClass}
                    inputMode="numeric"
                    value={onuNumber}
                    onChange={(e) => setOnuNumber(e.target.value)}
                  />
                </label>

                <label className="block text-sm">
                  <span className="mb-1 block text-[var(--text-muted)]">
                    VLAN management
                  </span>
                  <select
                    className={inputClass}
                    value={mgmtVlanPick}
                    onChange={(e) => setMgmtVlanPick(e.target.value)}
                  >
                    <option value="">Sin asignar…</option>
                    {mgmtPools.map((p) => (
                      <option key={p.id} value={p.vlanId}>
                        VLAN {p.vlanId}
                        {p.name ? ` — ${p.name}` : ''}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block text-sm">
                  <span className="mb-1 block text-[var(--text-muted)]">
                    VLAN WAN / Internet
                  </span>
                  <select
                    className={inputClass}
                    value={wanVlanPick}
                    onChange={(e) => setWanVlanPick(e.target.value)}
                  >
                    <option value="">Sin WAN…</option>
                    {wanPools.map((p) => (
                      <option key={p.id} value={p.vlanId}>
                        VLAN {p.vlanId}
                        {p.name ? ` — ${p.name}` : ''}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block text-sm">
                  <span className="mb-1 block text-[var(--text-muted)]">
                    Perfil TR069
                  </span>
                  <select
                    className={inputClass}
                    value={tr069ProfilePick}
                    onChange={(e) => setTr069ProfilePick(e.target.value)}
                    disabled={!mgmtVlanPick}
                  >
                    <option value="">
                      {mgmtVlanPick
                        ? 'Seleccionar perfil…'
                        : 'Primero elige VLAN management'}
                    </option>
                    {tr069Profiles.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  {!tr069ProfilesQuery.isLoading &&
                    tr069Profiles.length === 0 && (
                      <span className="mt-1 block text-xs text-amber-400">
                        No hay perfiles TR069. Créalos en Ajustes → TR069.
                      </span>
                    )}
                </label>
              </>
            )}

            {error && <p className="text-sm text-[var(--danger)]">{error}</p>}
          </div>

          <div className="flex justify-end gap-2 border-t border-[var(--border)] px-5 py-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={!orphan}
              onClick={startSwap}
              className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-60"
            >
              Aprovisionar seleccionada
            </button>
          </div>
        </div>
      </div></ModalPortal>

      <OperationProgressModal
        open={progressOpen}
        title="Cambiando ONU del servicio"
        steps={progressSteps}
        running={progressRunning}
        failed={progressFailed}
        allDone={progressDone}
        onRetry={() => void executeProgress(progressSteps)}
        onClose={() => {
          if (progressRunning) return
          setProgressOpen(false)
          if (progressDone) onClose()
        }}
      />
    </>
  )
}
