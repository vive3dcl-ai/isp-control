import { useMemo, useState, useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'
import type { OltVlansResponse, TopologyDevice } from '../lib/topology'
import {
  previewNetwork,
  type IpPool,
  type IpPoolAddressesResponse,
  type IpPoolPurpose,
  type IpPoolsResponse,
} from '../lib/ip-pools'
import { useNotify } from './NotifyProvider'
import { SettingsSubTabs } from './SettingsSubTabs'
import { ModalPortal } from './ModalPortal'
import {
  DesktopTableWrap,
  MobileList,
  MobileListCard,
  MobileListMeta,
} from './MobileList'

const inputClass =
  'w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 outline-none ring-[var(--accent)] focus:ring-2'

type PurposeTab = IpPoolPurpose
type FormModal = 'create' | 'edit' | null

/** Anything wider is unusual for a client pool and only the API pages it. */
const MIN_RECOMMENDED_PREFIX = 20

export function IpPoolsSettingsTab({ canWrite }: { canWrite: boolean }) {
  const queryClient = useQueryClient()
  const { confirm } = useNotify()
  const [purpose, setPurpose] = useState<PurposeTab>('management')
  const [oltFilter, setOltFilter] = useState('')
  const [formModal, setFormModal] = useState<FormModal>(null)
  const [viewPool, setViewPool] = useState<IpPool | null>(null)
  const [editing, setEditing] = useState<IpPool | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [oltId, setOltId] = useState('')
  const [routerId, setRouterId] = useState('')
  const [vlanId, setVlanId] = useState('')
  const [gateway, setGateway] = useState('')
  const [prefix, setPrefix] = useState('24')
  const [name, setName] = useState('')
  const [dns1, setDns1] = useState('')
  const [dns2, setDns2] = useState('')

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

  const routers = useMemo(
    () =>
      (topologyQuery.data?.devices ?? []).filter(
        (d) => d.type === 'router' && d.subtype === 'mikrotik' && d.isActive,
      ),
    [topologyQuery.data?.devices],
  )

  /** Include linked router even if inactive so edit keeps selection. */
  const routerOptions = useMemo(() => {
    const list = [...routers]
    if (
      editing?.routerId &&
      !list.some((r) => r.id === editing.routerId)
    ) {
      const linked = (topologyQuery.data?.devices ?? []).find(
        (d) => d.id === editing.routerId,
      )
      if (linked) list.unshift(linked)
    }
    return list
  }, [routers, editing?.routerId, topologyQuery.data?.devices])

  const selectedRouter = useMemo(
    () => routerOptions.find((r) => r.id === routerId) ?? null,
    [routerOptions, routerId],
  )

  function routerHasVlanOn(
    router: TopologyDevice | null | undefined,
    id: number,
  ): boolean {
    if (!router || !Number.isInteger(id) || id < 1) return false
    const iface = `vlan_${id}`.toLowerCase()
    return (router.ports ?? []).some((p) =>
      (p.vlans ?? []).some(
        (v) =>
          v.vlanId === id || v.interfaceName?.toLowerCase() === iface,
      ),
    )
  }

  const vlanIdNum = Number(vlanId)
  const routerHasVlan = useMemo(
    () => routerHasVlanOn(selectedRouter, vlanIdNum),
    [selectedRouter, vlanIdNum],
  )

  function findRouterForVlan(vlan: number): string {
    const withVlan = routers.find((r) => routerHasVlanOn(r, vlan))
    return withVlan?.id ?? ''
  }

  function openEdit(p: IpPool) {
    setEditing(p)
    setOltId(p.oltId)
    const linked =
      p.routerId &&
      (topologyQuery.data?.devices ?? []).some((d) => d.id === p.routerId)
        ? p.routerId
        : findRouterForVlan(p.vlanId) || p.routerId || ''
    setRouterId(linked)
    setVlanId(String(p.vlanId))
    setGateway(p.gateway)
    setPrefix(String(p.prefix))
    setName(p.name ?? '')
    setDns1(p.dns1 ?? '')
    setDns2(p.dns2 ?? '')
    setError(null)
    setFormModal('edit')
  }

  // If topology loads after opening edit, fill the linked Router.
  useEffect(() => {
    if (formModal !== 'edit' || !editing) return
    if (routerId) return
    if (editing.routerId) {
      setRouterId(editing.routerId)
      return
    }
    const found = findRouterForVlan(editing.vlanId)
    if (found) setRouterId(found)
  }, [formModal, editing, routerId, topologyQuery.data?.devices, routers])

  const poolsQuery = useQuery({
    queryKey: ['app', 'settings', 'ip-pools', purpose, oltFilter],
    queryFn: () => {
      const qs = new URLSearchParams({ purpose })
      if (oltFilter) qs.set('oltId', oltFilter)
      return apiFetch<IpPoolsResponse>(
        `/app/settings/ip-pools?${qs.toString()}`,
      )
    },
  })

  const vlansQuery = useQuery({
    queryKey: ['app', 'topology', 'vlans', oltId],
    queryFn: () =>
      apiFetch<OltVlansResponse>(`/app/topology/devices/${oltId}/vlans`),
    enabled: !!formModal && !!oltId,
  })

  const addressesQuery = useQuery({
    queryKey: ['app', 'settings', 'ip-pools', viewPool?.id, 'addresses'],
    queryFn: () =>
      apiFetch<IpPoolAddressesResponse>(
        `/app/settings/ip-pools/${viewPool!.id}/addresses`,
      ),
    enabled: !!viewPool,
  })

  const preview = useMemo(() => {
    const p = Number(prefix)
    if (!gateway.trim() || !Number.isFinite(p)) {
      return { network: '', totalUsable: 0, error: null as string | null }
    }
    return previewNetwork(gateway, p)
  }, [gateway, prefix])

  const prefixTooWide = useMemo(() => {
    const p = Number(prefix)
    return Number.isInteger(p) && p >= 8 && p < MIN_RECOMMENDED_PREFIX
  }, [prefix])

  function invalidate() {
    void queryClient.invalidateQueries({
      queryKey: ['app', 'settings', 'ip-pools'],
    })
  }

  function resetForm() {
    setOltId(oltFilter || '')
    setRouterId('')
    setVlanId('')
    setGateway('')
    setPrefix('24')
    setName('')
    setDns1('')
    setDns2('')
    setError(null)
    setEditing(null)
  }

  function openCreate() {
    resetForm()
    setFormModal('create')
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!routerId) throw new Error('Selecciona un Router')
      if (!routerHasVlan) {
        throw new Error(
          `La VLAN ${vlanId} no existe en el Router. Créala primero en Ajustes → VLANs.`,
        )
      }
      const dnsPayload =
        purpose === 'internet'
          ? {
              dns1: dns1.trim(),
              dns2: dns2.trim() || null,
            }
          : {}
      if (formModal === 'create') {
        return apiFetch<IpPool>('/app/settings/ip-pools', {
          method: 'POST',
          body: JSON.stringify({
            oltId,
            routerId,
            vlanId: Number(vlanId),
            purpose,
            gateway: gateway.trim(),
            prefix: Number(prefix),
            name: name.trim() || undefined,
            ...dnsPayload,
          }),
        })
      }
      if (!editing) throw new Error('Sin pool')
      return apiFetch<IpPool>(`/app/settings/ip-pools/${editing.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          gateway: gateway.trim(),
          prefix: Number(prefix),
          name: name.trim() || null,
          vlanId: Number(vlanId),
          routerId,
          ...dnsPayload,
        }),
      })
    },
    onSuccess: (res) => {
      invalidate()
      setFormModal(null)
      resetForm()
      setError(null)
      if (res.mikrotikMessage?.includes('actualizado')) {
        setNotice(
          `Pool VLAN ${res.vlanId} (${res.purpose}) actualizado: ya existía en el sistema.`,
        )
      } else {
        setNotice(null)
      }
    },
    onError: (e: Error) => setError(e.message),
  })

  const vlanSelectReady = !!oltId && !!routerId

  /** The OLT VLAN list is cached for 30 min; let the user force a CLI read. */
  const refreshVlans = useMutation({
    mutationFn: () =>
      apiFetch<OltVlansResponse>(
        `/app/topology/devices/${oltId}/vlans?refresh=1`,
      ),
    onSuccess: (data) => {
      queryClient.setQueryData(['app', 'topology', 'vlans', oltId], data)
    },
    onError: (e: Error) => setError(e.message),
  })

  /** Another catalog pool already uses this router + VLAN + gateway. */
  const gatewayAlreadyInCatalog = useMemo(() => {
    if (!routerId || !vlanId || !gateway.trim()) return null
    const pfx = Number(prefix)
    return (
      poolsQuery.data?.pools.find(
        (p) =>
          p.routerId === routerId &&
          p.vlanId === vlanIdNum &&
          p.gateway === gateway.trim() &&
          p.prefix === pfx &&
          p.id !== editing?.id,
      ) ?? null
    )
  }, [
    routerId,
    vlanId,
    vlanIdNum,
    gateway,
    prefix,
    poolsQuery.data?.pools,
    editing?.id,
  ])

  const canSubmit =
    !!gateway.trim() &&
    !!vlanId &&
    !!routerId &&
    !!oltId &&
    routerHasVlan &&
    !gatewayAlreadyInCatalog &&
    (purpose !== 'internet' || !!dns1.trim()) &&
    !preview.error &&
    !saveMutation.isPending

  const editVlanLabel = useMemo(() => {
    if (!vlanId) return ''
    const meta = (vlansQuery.data?.vlans ?? []).find(
      (v) => String(v.vlanId) === vlanId,
    )
    return meta?.description ? `${vlanId} — ${meta.description}` : vlanId
  }, [vlanId, vlansQuery.data?.vlans])

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/app/settings/ip-pools/${id}`, { method: 'DELETE' }),
    onSuccess: () => invalidate(),
    onError: (e: Error) => setError(e.message),
  })

  const pools = poolsQuery.data?.pools ?? []
  const purposeLabel =
    purpose === 'management' ? 'Administración' : 'Internet'

  return (
    <div className="space-y-4">
      <SettingsSubTabs
        aria-label="Tipo de pool"
        value={purpose}
        onChange={setPurpose}
        tabs={
          [
            { id: 'management', label: 'Administración' },
            { id: 'internet', label: 'Internet' },
          ] as const
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-[var(--text-muted)]">
          Pools de {purposeLabel.toLowerCase()} por OLT y VLAN. El gateway se
          publica en el Router como{' '}
          <span className="font-mono">/ip/address</span> sobre{' '}
          <span className="font-mono">vlan_N</span>
          {purpose === 'internet'
            ? '. Los pools WAN incluyen DNS para IP estática vía TR069.'
            : '.'}
        </p>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <select
            className="min-w-[10rem] rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-1.5 text-sm outline-none ring-[var(--accent)] focus:ring-2"
            value={oltFilter}
            onChange={(e) => setOltFilter(e.target.value)}
          >
            <option value="">Todas las OLTs</option>
            {olts.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
          {canWrite && (
            <button
              type="button"
              onClick={openCreate}
              className="shrink-0 rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-white hover:bg-[var(--accent-hover)]"
            >
              Nuevo pool
            </button>
          )}
        </div>
      </div>

      {error && (
        <p className="rounded-lg border border-[var(--danger)]/40 bg-[var(--danger)]/10 px-3 py-2 text-sm text-[var(--danger)]">
          {error}
        </p>
      )}
      {notice && (
        <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">
          {notice}
        </p>
      )}

      {poolsQuery.isLoading ? (
        <p className="text-sm text-[var(--text-muted)]">Cargando…</p>
      ) : poolsQuery.isError ? (
        <p className="rounded-lg border border-[var(--danger)]/40 bg-[var(--danger)]/10 px-3 py-2 text-sm text-[var(--danger)]">
          No se pudieron cargar los pools:{' '}
          {poolsQuery.error instanceof Error
            ? poolsQuery.error.message
            : 'error desconocido'}
        </p>
      ) : pools.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[var(--border)] px-4 py-10 text-center text-sm text-[var(--text-muted)]">
          No hay pools de {purposeLabel.toLowerCase()}.
        </div>
      ) : (
        <>
          <MobileList>
            {pools.map((p) => (
              <MobileListCard key={p.id}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">
                      VLAN {p.vlanId}
                    </p>
                    <p className="font-mono text-[11px] text-[var(--text-muted)]">
                      {p.gateway}/{p.prefix}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setViewPool(p)}
                    className="shrink-0 text-xs text-[var(--accent)] hover:underline"
                  >
                    Ver pool
                  </button>
                </div>
                <MobileListMeta>
                  <span>{p.oltName ?? '—'}</span>
                  <span>·</span>
                  <span>{p.routerName ?? '—'}</span>
                  <span>·</span>
                  <span className="font-mono">{p.network}</span>
                  {purpose === 'internet' && (
                    <>
                      <span>·</span>
                      <span className="font-mono">
                        DNS {p.dns1 ?? '—'}
                        {p.dns2 ? ` / ${p.dns2}` : ''}
                      </span>
                    </>
                  )}
                  <span>·</span>
                  <span>
                    {p.assigned}/{p.total} ({p.available} libres)
                  </span>
                </MobileListMeta>
                {canWrite && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => openEdit(p)}
                      className="text-xs text-[var(--text-muted)] hover:underline"
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      disabled={p.assigned > 0 || deleteMutation.isPending}
                      onClick={() => {
                        void confirm(
                          `¿Eliminar pool VLAN ${p.vlanId} (${p.gateway}/${p.prefix})?`,
                          {
                            title: 'Eliminar pool IP',
                            danger: true,
                            confirmLabel: 'Eliminar',
                          },
                        ).then((ok) => {
                          if (ok) void deleteMutation.mutateAsync(p.id)
                        })
                      }}
                      className="text-xs text-[var(--danger)] hover:underline disabled:opacity-40"
                    >
                      Eliminar
                    </button>
                  </div>
                )}
              </MobileListCard>
            ))}
          </MobileList>

          <DesktopTableWrap>
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="border-b border-[var(--border)] bg-[var(--bg)] text-[var(--text-muted)]">
                <tr>
                  <th className="px-3 py-2 font-medium">OLT</th>
                  <th className="px-3 py-2 font-medium">Router</th>
                  <th className="px-3 py-2 font-medium">VLAN</th>
                  <th className="px-3 py-2 font-medium">Gateway</th>
                  <th className="px-3 py-2 font-medium">Prefijo</th>
                  <th className="px-3 py-2 font-medium">Red</th>
                  {purpose === 'internet' && (
                    <th className="px-3 py-2 font-medium">DNS</th>
                  )}
                  <th className="px-3 py-2 font-medium">Uso</th>
                  <th className="px-3 py-2 font-medium">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {pools.map((p) => (
                  <tr
                    key={p.id}
                    className="border-b border-[var(--border)] last:border-0"
                  >
                    <td className="px-3 py-2">{p.oltName ?? '—'}</td>
                    <td className="px-3 py-2">{p.routerName ?? '—'}</td>
                    <td className="px-3 py-2">{p.vlanId}</td>
                    <td className="px-3 py-2 font-mono text-xs">{p.gateway}</td>
                    <td className="px-3 py-2">/{p.prefix}</td>
                    <td className="px-3 py-2 font-mono text-xs">{p.network}</td>
                    {purpose === 'internet' && (
                      <td className="px-3 py-2 font-mono text-xs">
                        {p.dns1 ?? '—'}
                        {p.dns2 ? (
                          <span className="block text-[var(--text-muted)]">
                            {p.dns2}
                          </span>
                        ) : null}
                      </td>
                    )}
                    <td className="px-3 py-2">
                      {p.assigned} / {p.total}
                      <span className="ml-1 text-[var(--text-muted)]">
                        ({p.available} libres)
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => setViewPool(p)}
                          className="text-sm text-[var(--accent)] hover:underline"
                        >
                          Ver pool
                        </button>
                        {canWrite && (
                          <>
                            <button
                              type="button"
                              onClick={() => openEdit(p)}
                              className="text-sm text-[var(--text-muted)] hover:underline"
                            >
                              Editar
                            </button>
                            <button
                              type="button"
                              disabled={
                                p.assigned > 0 || deleteMutation.isPending
                              }
                              onClick={() => {
                                void confirm(
                                  `¿Eliminar pool VLAN ${p.vlanId} (${p.gateway}/${p.prefix})?`,
                                  {
                                    title: 'Eliminar pool IP',
                                    danger: true,
                                    confirmLabel: 'Eliminar',
                                  },
                                ).then((ok) => {
                                  if (ok) void deleteMutation.mutateAsync(p.id)
                                })
                              }}
                              className="text-sm text-[var(--danger)] hover:underline disabled:opacity-40"
                            >
                              Eliminar
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </DesktopTableWrap>
        </>
      )}

      {formModal && (
        <ModalPortal><div className="fixed inset-0 z-[100] modal-backdrop flex items-stretch justify-center overflow-hidden bg-black/50 sm:items-center sm:p-4">
          <div className="h-[100dvh] max-h-[100dvh] w-full max-w-md overflow-y-auto overscroll-contain rounded-none border-0 sm:h-auto sm:max-h-[min(92dvh,920px)] sm:rounded-xl sm:border border-[var(--border)] bg-[var(--bg-elevated)] p-5 text-[var(--text)] shadow-xl">
            <h3 className="text-lg font-semibold">
              {formModal === 'create'
                ? `Nuevo pool · ${purposeLabel}`
                : `Editar pool · ${purposeLabel}`}
            </h3>
            <div className="mt-4 space-y-3">
              {formModal === 'create' ? (
                <label className="block text-sm">
                  <span className="mb-1 block text-[var(--text-muted)]">
                    OLT
                  </span>
                  <select
                    className={inputClass}
                    value={oltId}
                    onChange={(e) => {
                      setOltId(e.target.value)
                      setVlanId('')
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
              ) : (
                <label className="block text-sm">
                  <span className="mb-1 block text-[var(--text-muted)]">
                    OLT
                  </span>
                  <input
                    className={inputClass}
                    value={editing?.oltName ?? oltId}
                    disabled
                  />
                </label>
              )}
              <label className="block text-sm">
                <span className="mb-1 block text-[var(--text-muted)]">
                  Router (gateway)
                </span>
                <select
                  className={inputClass}
                  value={routerId}
                  onChange={(e) => {
                    setRouterId(e.target.value)
                    // Solo en crear se limpia la VLAN; en editar se mantiene la del pool.
                    if (formModal === 'create') setVlanId('')
                  }}
                >
                  <option value="">Seleccionar…</option>
                  {routerOptions.map((r) => {
                    const hasVlan = routerHasVlanOn(r, vlanIdNum)
                    return (
                      <option key={r.id} value={r.id}>
                        {r.name}
                        {formModal === 'edit' && vlanId
                          ? hasVlan
                            ? ' · VLAN OK'
                            : ' · sin VLAN'
                          : ''}
                      </option>
                    )
                  })}
                </select>
                {routers.length === 0 && (
                  <span className="mt-1 block text-xs text-amber-400">
                    No hay routers MikroTik activos en topología.
                  </span>
                )}
              </label>
              <label className="block text-sm">
                <span className="mb-1 flex items-center justify-between gap-2">
                  <span className="text-[var(--text-muted)]">VLAN</span>
                  {formModal === 'create' && !!oltId && (
                    <button
                      type="button"
                      className="text-xs text-[var(--accent)] hover:underline disabled:opacity-50"
                      disabled={refreshVlans.isPending}
                      onClick={() => refreshVlans.mutate()}
                    >
                      {refreshVlans.isPending
                        ? 'Leyendo OLT…'
                        : 'Releer desde la OLT'}
                    </button>
                  )}
                </span>
                {formModal === 'edit' ? (
                  <input
                    className={inputClass}
                    value={editVlanLabel}
                    disabled
                  />
                ) : (
                  <select
                    className={inputClass}
                    value={vlanId}
                    onChange={(e) => setVlanId(e.target.value)}
                    disabled={!vlanSelectReady || vlansQuery.isLoading}
                  >
                    <option value="">
                      {!oltId
                        ? 'Primero elige OLT…'
                        : !routerId
                          ? 'Primero elige Router…'
                          : vlansQuery.isLoading
                            ? 'Cargando VLANs…'
                            : 'Seleccionar…'}
                    </option>
                    {vlanSelectReady &&
                      (vlansQuery.data?.vlans ?? []).map((v) => (
                        <option key={v.vlanId} value={v.vlanId}>
                          {v.vlanId}
                          {v.description ? ` — ${v.description}` : ''}
                          {v.usedForMgmt ? ' (mgmt)' : ''}
                          {v.usedForInternet ? ' (wan)' : ''}
                        </option>
                      ))}
                  </select>
                )}
                {vlansQuery.isError && !!oltId && (
                  <span className="mt-1 block text-xs text-[var(--danger)]">
                    No se pudieron leer VLANs de la OLT.
                  </span>
                )}
                {formModal === 'create' &&
                  vlanSelectReady &&
                  !vlansQuery.isLoading &&
                  !vlansQuery.isError && (
                    <span className="mt-1 block text-xs text-[var(--text-muted)]">
                      {vlansQuery.data?.vlans.length ?? 0} VLANs en la OLT
                      {vlansQuery.data?.syncedAt
                        ? ` · leídas ${new Date(vlansQuery.data.syncedAt).toLocaleString()}`
                        : ''}
                      . Si falta alguna, usa “Releer desde la OLT”.
                    </span>
                  )}
              </label>
              {!routerId && formModal === 'edit' && (
                <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                  Este pool aún no está enlazado a un Router. Selecciona uno
                  donde exista la VLAN {vlanId || '…'} para publicar el gateway.
                </p>
              )}
              {routerId && vlanId && !routerHasVlan && (
                <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                  La VLAN {vlanId} no está creada en{' '}
                  <span className="font-medium">{selectedRouter?.name}</span>.
                  Ve a <span className="font-medium">Ajustes → VLANs</span>,
                  créala en ese Router (elige el puerto físico) y vuelve aquí
                  para enlazarla.
                </p>
              )}
              {formModal === 'create' &&
                routerId &&
                vlanId &&
                routerHasVlan && (
                <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">
                  VLAN {vlanId} presente en {selectedRouter?.name} (
                  <span className="font-mono">vlan_{vlanId}</span>
                  ). Al guardar se enlaza el pool y se publica{' '}
                  <span className="font-mono">
                    {gateway.trim() || 'gateway'}/{prefix}
                  </span>{' '}
                  en /ip/address.
                </p>
              )}
              {gatewayAlreadyInCatalog && (
                <p className="rounded-lg border border-[var(--danger)]/40 bg-[var(--danger)]/10 px-3 py-2 text-xs text-[var(--danger)]">
                  Ese gateway ya está en un pool de{' '}
                  {gatewayAlreadyInCatalog.oltName ?? 'otra OLT'} (VLAN{' '}
                  {gatewayAlreadyInCatalog.vlanId}).
                </p>
              )}
              <label className="block text-sm">
                <span className="mb-1 block text-[var(--text-muted)]">
                  Gateway
                </span>
                <input
                  className={inputClass}
                  placeholder="10.70.0.1"
                  value={gateway}
                  onChange={(e) => setGateway(e.target.value)}
                  disabled={formModal === 'create' ? !routerHasVlan : !routerId}
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-[var(--text-muted)]">
                  Prefijo
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-[var(--text-muted)]">/</span>
                  <input
                    className={inputClass}
                    type="number"
                    min={MIN_RECOMMENDED_PREFIX}
                    max={30}
                    value={prefix}
                    onChange={(e) => setPrefix(e.target.value)}
                    disabled={formModal === 'create' ? !routerHasVlan : !routerId}
                  />
                </div>
                {prefixTooWide && (
                  <p className="mt-1 text-xs text-amber-400">
                    /{prefix} son {preview.totalUsable} IPs. Para pools de
                    clientes usa /{MIN_RECOMMENDED_PREFIX} o más específico.
                  </p>
                )}
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-[var(--text-muted)]">
                  Nombre (opcional)
                </span>
                <input
                  className={inputClass}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              {purpose === 'internet' && (
                <>
                  <label className="block text-sm">
                    <span className="mb-1 block text-[var(--text-muted)]">
                      DNS primario
                    </span>
                    <input
                      className={inputClass}
                      placeholder="8.8.8.8"
                      value={dns1}
                      onChange={(e) => setDns1(e.target.value)}
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="mb-1 block text-[var(--text-muted)]">
                      DNS secundario (opcional)
                    </span>
                    <input
                      className={inputClass}
                      placeholder="1.1.1.1"
                      value={dns2}
                      onChange={(e) => setDns2(e.target.value)}
                    />
                  </label>
                </>
              )}
              {preview.error ? (
                <p className="text-xs text-[var(--danger)]">{preview.error}</p>
              ) : preview.network && (formModal === 'edit' || routerHasVlan) ? (
                <p className="rounded-lg bg-[var(--bg)] px-3 py-2 text-xs text-[var(--text-muted)]">
                  Red{' '}
                  <span className="font-mono text-[var(--text)]">
                    {preview.network}/{prefix}
                  </span>
                  {' · '}
                  {preview.totalUsable} IPs usables (excl. gateway)
                  {gateway.trim() && routerId && (
                    <>
                      {' · '}Router:{' '}
                      <span className="font-mono text-[var(--text)]">
                        {gateway.trim()}/{prefix}
                      </span>{' '}
                      en vlan_{vlanId || 'N'}
                    </>
                  )}
                </p>
              ) : null}
              {error && (
                <p className="text-sm text-[var(--danger)]">{error}</p>
              )}
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setFormModal(null)
                  resetForm()
                }}
                className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={!canSubmit}
                onClick={() => void saveMutation.mutateAsync()}
                className="rounded-lg bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {saveMutation.isPending
                  ? 'Aplicando…'
                  : formModal === 'create'
                    ? 'Crear pool'
                    : editing?.routerId === routerId && routerHasVlan
                      ? 'Guardar y sincronizar'
                      : 'Enlazar Router y sincronizar'}
              </button>
            </div>
          </div>
        </div></ModalPortal>
      )}

      {viewPool && (
        <ModalPortal><div className="fixed inset-0 z-[100] modal-backdrop flex items-stretch justify-center overflow-hidden bg-black/50 sm:items-center sm:p-4">
          <div className="flex h-[100dvh] max-h-[100dvh] w-full max-w-lg flex-col overflow-hidden rounded-none border-0 sm:h-auto sm:max-h-[min(92dvh,920px)] sm:rounded-xl sm:border border-[var(--border)] bg-[var(--bg-elevated)] text-[var(--text)] shadow-xl">
            <div className="border-b border-[var(--border)] px-5 py-4">
              <h3 className="text-lg font-semibold">
                Pool VLAN {viewPool.vlanId}
              </h3>
              <p className="mt-1 text-sm text-[var(--text-muted)]">
                {viewPool.oltName} · {viewPool.gateway}/{viewPool.prefix} · red{' '}
                {viewPool.network}
                {viewPool.purpose === 'internet' && viewPool.dns1
                  ? ` · DNS ${viewPool.dns1}${viewPool.dns2 ? `, ${viewPool.dns2}` : ''}`
                  : ''}
              </p>
              {addressesQuery.data && (
                <>
                  <p className="mt-1 text-xs text-[var(--text-muted)]">
                    {addressesQuery.data.assigned} asignadas ·{' '}
                    {addressesQuery.data.available} disponibles · gateway{' '}
                    {addressesQuery.data.gateway} (excluido)
                  </p>
                  {addressesQuery.data.truncated && (
                    <p className="mt-1 text-xs text-amber-400">
                      Red muy amplia: se muestran{' '}
                      {addressesQuery.data.returned} de{' '}
                      {addressesQuery.data.total} IPs.
                    </p>
                  )}
                </>
              )}
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-3">
              {addressesQuery.isLoading ? (
                <p className="text-sm text-[var(--text-muted)]">Cargando IPs…</p>
              ) : addressesQuery.isError ? (
                <p className="text-sm text-[var(--danger)]">
                  {(addressesQuery.error as Error).message}
                </p>
              ) : (
                <ul className="divide-y divide-[var(--border)] font-mono text-xs">
                  {(addressesQuery.data?.addresses ?? []).map((a) => (
                    <li
                      key={a.ip}
                      className="flex items-center justify-between gap-2 py-1.5"
                    >
                      <span>{a.ip}</span>
                      {a.status === 'available' ? (
                        <span className="rounded bg-emerald-600/20 px-2 py-0.5 text-[10px] font-sans text-emerald-400">
                          Disponible
                        </span>
                      ) : (
                        <span className="truncate font-sans text-[var(--text-muted)]">
                          Asignada
                          {a.onuIf ? ` · ${a.onuIf}` : ''}
                          {a.sn ? ` · ${a.sn}` : ''}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="border-t border-[var(--border)] px-5 py-3 text-right">
              <button
                type="button"
                onClick={() => setViewPool(null)}
                className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div></ModalPortal>
      )}
    </div>
  )
}
