import { useMemo, useState } from 'react'
import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { apiFetch } from '../lib/api'
import type { TopologyDevice } from '../lib/topology'
import {
  OperationProgressModal,
  runProgressSteps,
  type ProgressStep,
} from './OperationProgressModal'
import { useNotify } from './NotifyProvider'
import { ModalPortal } from './ModalPortal'


const inputClass =
  'w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 outline-none ring-[var(--accent)] focus:ring-2'

type ServiceVlanRow = {
  id: string | null
  vlanId: number
  description: string | null
  oltIds: string[]
  routerIds: string[]
  switchIds: string[]
  olt: string | null
  router: string | null
  switch: string | null
  olts: Array<{ id: string; name: string }>
  routers: Array<{ id: string; name: string }>
  switches: Array<{ id: string; name: string }>
  discovered?: boolean
}

type ModalMode = 'create' | 'edit'

type PendingDelete = {
  device: TopologyDevice
  kind: 'olt' | 'router' | 'switch'
  vlanId: number
}

type SwitchPortMode = 'tagged' | 'untagged'

type SwitchBridgeConfig = {
  ok: boolean
  bridges?: Array<{ name: string; vlanFiltering: boolean; disabled: boolean }>
  ports?: Array<{ interface: string; bridge: string; pvid: number }>
}

/** Sentinel for the "create a new bridge" option in the bridge selector. */
const NEW_BRIDGE = '__new__'

export function VlansSettingsTab({ canWrite }: { canWrite: boolean }) {
  const queryClient = useQueryClient()
  const { confirm } = useNotify()
  const [modal, setModal] = useState<ModalMode | null>(null)
  const [editing, setEditing] = useState<ServiceVlanRow | null>(null)
  const [vlanId, setVlanId] = useState('')
  const [description, setDescription] = useState('')
  /** routerId → parent physical port id (only needed when creating) */
  const [routerParentPort, setRouterParentPort] = useState<
    Record<string, string>
  >({})
  /** switchId → chosen bridge name, '' = auto, NEW_BRIDGE = create one */
  const [switchBridge, setSwitchBridge] = useState<Record<string, string>>({})
  /** switchId → name typed when creating a new bridge */
  const [switchNewBridge, setSwitchNewBridge] = useState<
    Record<string, string>
  >({})
  /** switchId → portId → tagged|untagged */
  const [switchPortModes, setSwitchPortModes] = useState<
    Record<string, Record<string, SwitchPortMode | ''>>
  >({})
  const [error, setError] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState('')

  const [progressOpen, setProgressOpen] = useState(false)
  const [progressSteps, setProgressSteps] = useState<ProgressStep[]>([])
  const [progressRunning, setProgressRunning] = useState(false)
  const [progressFailed, setProgressFailed] = useState(false)
  const [progressDone, setProgressDone] = useState(false)
  const [progressTitle, setProgressTitle] = useState('Aplicando VLAN')
  const [progressRunners, setProgressRunners] = useState<
    Record<string, () => Promise<string | void>>
  >({})

  const vlansQuery = useQuery({
    queryKey: ['app', 'settings', 'vlans'],
    queryFn: () =>
      apiFetch<{ vlans: ServiceVlanRow[] }>('/app/settings/vlans'),
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

  const routers = useMemo(
    () =>
      (topologyQuery.data?.devices ?? []).filter(
        (d) => d.type === 'router' && d.subtype === 'mikrotik' && d.isActive,
      ),
    [topologyQuery.data?.devices],
  )

  const switches = useMemo(
    () =>
      (topologyQuery.data?.devices ?? []).filter(
        (d) =>
          d.type === 'switch' &&
          d.subtype === 'mikrotik_routeros' &&
          d.isActive,
      ),
    [topologyQuery.data?.devices],
  )

  // Live bridge layout per switch: the selector must offer what the device
  // really has, never a hardcoded name.
  const bridgeQueries = useQueries({
    queries: switches.map((sw) => ({
      queryKey: ['app', 'topology', 'devices', sw.id, 'bridge'],
      queryFn: () =>
        apiFetch<SwitchBridgeConfig>(`/app/topology/devices/${sw.id}/bridge`),
      enabled: modal !== null,
      staleTime: 30_000,
    })),
  })

  const bridgeInfo = useMemo(() => {
    const out: Record<
      string,
      {
        loading: boolean
        failed: boolean
        names: string[]
        bridgeByPort: Record<string, string>
      }
    > = {}
    switches.forEach((sw, i) => {
      const q = bridgeQueries[i]
      const data = q?.data
      const bridgeByPort: Record<string, string> = {}
      for (const p of data?.ports ?? []) {
        if (p.interface && p.bridge) bridgeByPort[p.interface] = p.bridge
      }
      out[sw.id] = {
        loading: !!q?.isLoading,
        failed: !!q?.isError || (!!data && data.ok === false),
        names: (data?.bridges ?? []).map((b) => b.name).filter(Boolean),
        bridgeByPort,
      }
    })
    return out
  }, [switches, bridgeQueries])

  /** Bridge that the currently selected ports already belong to, if unanimous. */
  function autoBridge(sw: TopologyDevice): string | null {
    const info = bridgeInfo[sw.id]
    if (!info) return null
    const byId = new Map(physicalPorts(sw).map((p) => [p.id, p.name]))
    const found = new Set(
      switchSelectedPorts(sw.id)
        .map((s) => info.bridgeByPort[byId.get(s.portId) ?? ''])
        .filter(Boolean),
    )
    if (found.size === 1) return [...found][0]
    if (found.size === 0 && info.names.length === 1) return info.names[0]
    return null
  }

  /** Value sent to the API: undefined lets the backend resolve it. */
  function bridgePayload(switchId: string): {
    bridge?: string
    createBridge?: boolean
  } {
    const choice = switchBridge[switchId] ?? ''
    if (choice === NEW_BRIDGE) {
      const name = switchNewBridge[switchId]?.trim()
      return name ? { bridge: name, createBridge: true } : {}
    }
    return { bridge: choice.trim() || undefined }
  }

  function invalidate() {
    void queryClient.invalidateQueries({
      queryKey: ['app', 'settings', 'vlans'],
    })
    void queryClient.invalidateQueries({ queryKey: ['app', 'topology'] })
  }

  function openCreate() {
    setModal('create')
    setEditing(null)
    setVlanId('')
    setDescription('')
    setRouterParentPort({})
    setSwitchBridge({})
    setSwitchNewBridge({})
    setSwitchPortModes({})
    setError(null)
  }

  function openEdit(v: ServiceVlanRow) {
    setModal('edit')
    setEditing(v)
    setVlanId(String(v.vlanId))
    setDescription(v.description ?? '')
    setRouterParentPort({})
    setSwitchBridge({})
    setSwitchNewBridge({})
    // Prefill tagged/untagged from topology port cache so existing VLANs are editable.
    const modes: Record<string, Record<string, SwitchPortMode | ''>> = {}
    for (const d of topologyQuery.data?.devices ?? []) {
      if (
        d.type !== 'switch' ||
        d.subtype !== 'mikrotik_routeros' ||
        !d.isActive
      ) {
        continue
      }
      const perPort: Record<string, SwitchPortMode | ''> = {}
      for (const p of physicalPorts(d, { excludeBridge: true })) {
        const assignment = (p.vlans ?? []).find((x) => x.vlanId === v.vlanId)
        if (assignment?.mode === 'tagged' || assignment?.mode === 'untagged') {
          perPort[p.id] = assignment.mode
        }
      }
      modes[d.id] = perPort
    }
    setSwitchPortModes(modes)
    setError(null)
  }

  function closeModal() {
    setModal(null)
    setEditing(null)
    setError(null)
  }

  const currentVlanId = editing?.vlanId ?? Number(vlanId) ?? 0

  function oltHasVlan(oltId: string): boolean {
    return !!editing?.olts?.some((o) => o.id === oltId)
  }

  function routerHasVlan(router: TopologyDevice, id: number): boolean {
    if (editing?.routers?.some((r) => r.id === router.id)) return true
    const iface = `vlan_${id}`.toLowerCase()
    return (router.ports ?? []).some((p) =>
      (p.vlans ?? []).some(
        (v) => v.vlanId === id || v.interfaceName?.toLowerCase() === iface,
      ),
    )
  }

  function switchHasVlan(sw: TopologyDevice, id: number): boolean {
    if (editing?.switches?.some((s) => s.id === sw.id)) return true
    return (sw.ports ?? []).some((p) =>
      (p.vlans ?? []).some((v) => v.vlanId === id),
    )
  }

  function physicalPorts(
    device: TopologyDevice,
    opts?: { excludeBridge?: boolean },
  ) {
    return [...(device.ports ?? [])]
      .filter(
        (p) =>
          !/^vlan[_-]?/i.test(p.name) &&
          !/^lo$/i.test(p.name) &&
          !/^pppoe/i.test(p.name) &&
          !(opts?.excludeBridge && /^bridge/i.test(p.name)),
      )
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  function switchSelectedPorts(switchId: string) {
    const modes = switchPortModes[switchId] ?? {}
    return Object.entries(modes)
      .filter(([, mode]) => mode === 'tagged' || mode === 'untagged')
      .map(([portId, mode]) => ({
        portId,
        mode: mode as SwitchPortMode,
      }))
  }

  async function executeProgress(
    steps: ProgressStep[],
    runners: Record<string, () => Promise<string | void>>,
  ) {
    setProgressRunning(true)
    setProgressFailed(false)
    setProgressDone(false)
    const result = await runProgressSteps(steps, setProgressSteps, runners)
    setProgressRunning(false)
    if (result.ok) {
      setProgressDone(true)
      invalidate()
    } else {
      setProgressFailed(true)
    }
  }

  function startProgress(
    title: string,
    steps: ProgressStep[],
    runners: Record<string, () => Promise<string | void>>,
  ) {
    setProgressTitle(title)
    setProgressSteps(steps)
    setProgressRunners(runners)
    setProgressOpen(true)
    void executeProgress(steps, runners)
  }

  /** Create catalog row (used by "Añadir VLAN"). */
  async function createCatalogVlan() {
    const idNum = Number(vlanId)
    if (!Number.isInteger(idNum) || idNum < 1 || idNum > 4094) {
      setError('VLAN ID inválido (1–4094)')
      return
    }
    try {
      const created = await apiFetch<ServiceVlanRow>('/app/settings/vlans', {
        method: 'POST',
        body: JSON.stringify({
          vlanId: idNum,
          description: description.trim() || undefined,
        }),
      })
      setMsg(`VLAN ${idNum} añadida al catálogo`)
      invalidate()
      // Continue in edit mode so the user can create it on devices
      setModal('edit')
      setEditing({
        ...created,
        olts: created.olts ?? [],
        routers: created.routers ?? [],
        switches: created.switches ?? [],
        switchIds: created.switchIds ?? [],
        switch: created.switch ?? null,
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function ensureCatalogId(): Promise<string> {
    if (editing?.id) return editing.id
    const upserted = await apiFetch<ServiceVlanRow>(
      `/app/settings/vlans/by-vlan/${currentVlanId}`,
      {
        method: 'PUT',
        body: JSON.stringify({ description: description.trim() || null }),
      },
    )
    setEditing((prev) => (prev ? { ...prev, id: upserted.id } : prev))
    return upserted.id!
  }

  function createOnDevice(
    device: TopologyDevice,
    kind: 'olt' | 'router' | 'switch',
  ) {
    if (kind === 'router' && !routerParentPort[device.id]) {
      setError(
        `Selecciona el puerto físico en «${device.name}» para crear vlan_${currentVlanId}`,
      )
      return
    }
    if (kind === 'switch') {
      const ports = switchSelectedPorts(device.id)
      if (ports.length === 0) {
        setError(
          `Selecciona tagged/untagged en al menos un puerto de «${device.name}»`,
        )
        return
      }
    }
    setError(null)
    const kindLabel =
      kind === 'olt' ? 'OLT' : kind === 'router' ? 'Router' : 'Switch'
    const actionLabel =
      kind === 'switch' && switchHasVlan(device, currentVlanId)
        ? 'actualizar'
        : 'crear'
    const steps: ProgressStep[] = [
      { id: 'catalog', label: 'Guardar en catálogo', status: 'pending' },
      {
        id: 'device',
        label: `${kindLabel} · ${device.name} — ${actionLabel} VLAN`,
        status: 'pending',
      },
      { id: 'verify', label: 'Verificar en equipos', status: 'pending' },
    ]
    let catalogId: string | null = editing?.id ?? null
    const runners: Record<string, () => Promise<string | void>> = {
      catalog: async () => {
        catalogId = await ensureCatalogId()
        await apiFetch(`/app/settings/vlans/${catalogId}`, {
          method: 'PATCH',
          body: JSON.stringify({ description: description.trim() || null }),
        })
        return 'Catálogo actualizado'
      },
      device: async () => {
        if (!catalogId) throw new Error('Sin ID de catálogo')
        const r = await apiFetch<{ message: string }>(
          `/app/settings/vlans/${catalogId}/sync-device`,
          {
            method: 'POST',
            body: JSON.stringify({
              deviceId: device.id,
              kind,
              parentPortId:
                kind === 'router' ? routerParentPort[device.id] : undefined,
              ...(kind === 'switch' ? bridgePayload(device.id) : {}),
              ports: kind === 'switch' ? switchSelectedPorts(device.id) : undefined,
            }),
          },
        )
        return r.message
      },
      verify: async () => {
        if (!catalogId) throw new Error('Sin ID de catálogo')
        const r = await apiFetch<{ ok: boolean; message: string }>(
          `/app/settings/vlans/${catalogId}/verify`,
          { method: 'POST' },
        )
        if (!r.ok) throw new Error(r.message)
        return r.message
      },
    }
    startProgress(
      `${actionLabel === 'actualizar' ? 'Actualizar' : 'Crear'} VLAN ${currentVlanId} en ${device.name}`,
      steps,
      runners,
    )
  }

  function confirmDelete() {
    if (!pendingDelete) return
    const { device, kind, vlanId: vid } = pendingDelete
    setPendingDelete(null)
    setDeleteConfirm('')
    const kindLabel =
      kind === 'olt' ? 'OLT' : kind === 'router' ? 'Router' : 'Switch'
    const steps: ProgressStep[] = [
      {
        id: 'device',
        label: `${kindLabel} · ${device.name} — eliminar VLAN`,
        status: 'pending',
      },
      { id: 'verify', label: 'Verificar equipos restantes', status: 'pending' },
    ]
    const runners: Record<string, () => Promise<string | void>> = {
      device: async () => {
        const catalogId = await ensureCatalogId()
        const r = await apiFetch<{ message: string }>(
          `/app/settings/vlans/${catalogId}/remove-device`,
          {
            method: 'POST',
            body: JSON.stringify({
              deviceId: device.id,
              kind,
              ...(kind === 'switch'
                ? { bridge: bridgePayload(device.id).bridge }
                : {}),
            }),
          },
        )
        return r.message
      },
      verify: async () => {
        const catalogId = await ensureCatalogId()
        const r = await apiFetch<{ ok: boolean; message: string }>(
          `/app/settings/vlans/${catalogId}/verify`,
          { method: 'POST' },
        )
        if (!r.ok) throw new Error(r.message)
        return r.message
      },
    }
    startProgress(`Eliminar VLAN ${vid} de ${device.name}`, steps, runners)
  }

  const deleteCatalogMutation = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/app/settings/vlans/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      setMsg('VLAN eliminada del catálogo')
      closeModal()
      invalidate()
    },
    onError: (e: Error) => setError(e.message),
  })

  const vlans = vlansQuery.data?.vlans ?? []

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {canWrite && (
          <button
            type="button"
            onClick={openCreate}
            className="rounded-lg bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)]"
          >
            + Añadir VLAN
          </button>
        )}
        <button
          type="button"
          disabled={vlansQuery.isFetching}
          onClick={() => void vlansQuery.refetch()}
          className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm hover:bg-[var(--bg)] disabled:opacity-60"
        >
          {vlansQuery.isFetching ? 'Actualizando…' : 'Refrescar'}
        </button>
      </div>

      <p className="text-sm text-[var(--text-muted)]">
        Catálogo de VLANs del sistema. OLT / Router / Switch muestran dónde
        existe hoy (vacío si no está). Al editar puedes crearla o eliminarla en
        cada equipo; en switches eliges puertos tagged/untagged del bridge.
      </p>

      {msg && <p className="text-sm text-emerald-500">{msg}</p>}
      {vlansQuery.error && (
        <p className="text-sm text-[var(--danger)]">
          {(vlansQuery.error as Error).message}
        </p>
      )}
      {vlansQuery.isLoading && (
        <p className="text-sm text-[var(--text-muted)]">Cargando VLANs…</p>
      )}

      {!vlansQuery.isLoading && vlans.length === 0 && (
        <div className="rounded-xl border border-dashed border-[var(--border)] px-4 py-10 text-center text-sm text-[var(--text-muted)]">
          No hay VLANs. Añade la primera o créalas en OLT / MikroTik.
        </div>
      )}

      {vlans.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="border-b border-[var(--border)] bg-[var(--bg)] text-[var(--text-muted)]">
              <tr>
                <th className="px-3 py-2 font-medium">VLAN</th>
                <th className="px-3 py-2 font-medium">Descripción</th>
                <th className="px-3 py-2 font-medium">OLT</th>
                <th className="px-3 py-2 font-medium">Router</th>
                <th className="px-3 py-2 font-medium">Switch</th>
                <th className="px-3 py-2 font-medium">Acción</th>
              </tr>
            </thead>
            <tbody>
              {vlans.map((v) => (
                <tr
                  key={v.id ?? `disc-${v.vlanId}`}
                  className="border-b border-[var(--border)] last:border-0"
                >
                  <td className="px-3 py-2.5 font-medium">
                    {v.vlanId}
                    {v.discovered && (
                      <span className="ml-2 text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
                        detectada
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5">{v.description || '—'}</td>
                  <td className="px-3 py-2.5 text-xs">{v.olt || '—'}</td>
                  <td className="px-3 py-2.5 text-xs">{v.router || '—'}</td>
                  <td className="px-3 py-2.5 text-xs">{v.switch || '—'}</td>
                  <td className="px-3 py-2.5">
                    {canWrite && (
                      <button
                        type="button"
                        className="text-xs text-[var(--accent)] hover:underline"
                        onClick={() => openEdit(v)}
                      >
                        Editar
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <ModalPortal><div className="fixed inset-0 z-[100] modal-backdrop flex items-stretch justify-center overflow-hidden bg-black/50 sm:items-center sm:p-4">
          <div className="h-[100dvh] max-h-[100dvh] w-full max-w-xl overflow-y-auto overscroll-contain rounded-none border-0 sm:h-auto sm:max-h-[min(92dvh,920px)] sm:rounded-xl sm:border border-[var(--border)] bg-[var(--bg-elevated)] p-5 text-[var(--text)] shadow-xl">
            <h3 className="text-lg font-semibold">
              {modal === 'create'
                ? 'Añadir VLAN'
                : `VLAN ${editing?.vlanId}`}
            </h3>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              ID + descripción (MikroTik:{' '}
              <span className="font-mono">
                vlan_{vlanId || currentVlanId || 'N'}
              </span>
              ).
            </p>

            <div className="mt-4 space-y-3">
              <label className="block text-sm">
                <span className="mb-1 block text-[var(--text-muted)]">
                  VLAN ID
                </span>
                <input
                  className={inputClass}
                  type="number"
                  min={1}
                  max={4094}
                  value={vlanId}
                  disabled={modal === 'edit'}
                  onChange={(e) => setVlanId(e.target.value)}
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-[var(--text-muted)]">
                  Descripción
                </span>
                <input
                  className={inputClass}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="ej. Management / Internet"
                />
              </label>

              {modal === 'edit' && (
                <>
                  <div>
                    <p className="mb-1 text-sm text-[var(--text-muted)]">
                      OLTs
                    </p>
                    <div className="divide-y divide-[var(--border)] rounded-lg border border-[var(--border)] bg-[var(--bg)]">
                      {olts.length === 0 && (
                        <p className="px-3 py-2 text-xs text-[var(--text-muted)]">
                          Sin OLTs activas
                        </p>
                      )}
                      {olts.map((o) => {
                        const exists = oltHasVlan(o.id)
                        return (
                          <div
                            key={o.id}
                            className="flex items-center justify-between gap-2 px-3 py-2 text-xs"
                          >
                            <span>
                              {o.name}
                              <span
                                className={
                                  exists
                                    ? 'ml-2 text-emerald-400'
                                    : 'ml-2 text-[var(--text-muted)]'
                                }
                              >
                                {exists ? 'creada' : 'no existe'}
                              </span>
                            </span>
                            {canWrite &&
                              (exists ? (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setDeleteConfirm('')
                                    setPendingDelete({
                                      device: o,
                                      kind: 'olt',
                                      vlanId: currentVlanId,
                                    })
                                  }}
                                  className="rounded-lg border border-[var(--danger)]/50 px-2 py-1 text-[var(--danger)] hover:bg-[var(--danger)]/10"
                                >
                                  Eliminar
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => createOnDevice(o, 'olt')}
                                  className="rounded-lg bg-[var(--accent)] px-2 py-1 font-medium text-white hover:bg-[var(--accent-hover)]"
                                >
                                  Crear
                                </button>
                              ))}
                          </div>
                        )
                      })}
                    </div>
                  </div>

                  <div>
                    <p className="mb-1 text-sm text-[var(--text-muted)]">
                      Routers (MikroTik)
                    </p>
                    <div className="divide-y divide-[var(--border)] rounded-lg border border-[var(--border)] bg-[var(--bg)]">
                      {routers.length === 0 && (
                        <p className="px-3 py-2 text-xs text-[var(--text-muted)]">
                          Sin routers MikroTik activos
                        </p>
                      )}
                      {routers.map((r) => {
                        const exists = routerHasVlan(r, currentVlanId)
                        const ports = physicalPorts(r)
                        return (
                          <div key={r.id} className="space-y-2 px-3 py-2">
                            <div className="flex items-center justify-between gap-2 text-xs">
                              <span>
                                {r.name}
                                <span
                                  className={
                                    exists
                                      ? 'ml-2 text-emerald-400'
                                      : 'ml-2 text-[var(--text-muted)]'
                                  }
                                >
                                  {exists ? 'creada' : 'no existe'}
                                </span>
                              </span>
                              {canWrite &&
                                (exists ? (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setDeleteConfirm('')
                                      setPendingDelete({
                                        device: r,
                                        kind: 'router',
                                        vlanId: currentVlanId,
                                      })
                                    }}
                                    className="rounded-lg border border-[var(--danger)]/50 px-2 py-1 text-[var(--danger)] hover:bg-[var(--danger)]/10"
                                  >
                                    Eliminar
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    disabled={!routerParentPort[r.id]}
                                    onClick={() => createOnDevice(r, 'router')}
                                    className="rounded-lg bg-[var(--accent)] px-2 py-1 font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-40"
                                  >
                                    Crear
                                  </button>
                                ))}
                            </div>
                            {!exists && canWrite && (
                              <label className="block text-xs">
                                <span className="mb-1 block text-[var(--text-muted)]">
                                  Puerto físico / bridge
                                </span>
                                <select
                                  className={inputClass}
                                  value={routerParentPort[r.id] ?? ''}
                                  onChange={(e) =>
                                    setRouterParentPort((prev) => ({
                                      ...prev,
                                      [r.id]: e.target.value,
                                    }))
                                  }
                                >
                                  <option value="">Seleccionar puerto…</option>
                                  {ports.map((p) => (
                                    <option key={p.id} value={p.id}>
                                      {p.name}
                                      {p.comment ? ` — ${p.comment}` : ''}
                                    </option>
                                  ))}
                                </select>
                                {ports.length === 0 && (
                                  <span className="mt-1 block text-[11px] text-amber-400">
                                    Sin puertos en topología. Sincroniza el
                                    router primero.
                                  </span>
                                )}
                              </label>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>

                  <div>
                    <p className="mb-1 text-sm text-[var(--text-muted)]">
                      Switches (MikroTik RouterOS)
                    </p>
                    <p className="mb-2 text-[11px] text-[var(--text-muted)]">
                      Bridge VLAN filtering: elige tagged (trunk) o untagged
                      (access / PVID) por puerto. SwitchOS no admite escritura
                      aún.
                    </p>
                    <div className="divide-y divide-[var(--border)] rounded-lg border border-[var(--border)] bg-[var(--bg)]">
                      {switches.length === 0 && (
                        <p className="px-3 py-2 text-xs text-[var(--text-muted)]">
                          Sin switches MikroTik RouterOS activos
                        </p>
                      )}
                      {switches.map((sw) => {
                        const exists = switchHasVlan(sw, currentVlanId)
                        const ports = physicalPorts(sw, { excludeBridge: true })
                        const selected = switchSelectedPorts(sw.id)
                        return (
                          <div key={sw.id} className="space-y-2 px-3 py-2">
                            <div className="flex items-center justify-between gap-2 text-xs">
                              <span>
                                {sw.name}
                                <span
                                  className={
                                    exists
                                      ? 'ml-2 text-emerald-400'
                                      : 'ml-2 text-[var(--text-muted)]'
                                  }
                                >
                                  {exists ? 'creada' : 'no existe'}
                                </span>
                              </span>
                              {canWrite && (
                                <div className="flex shrink-0 gap-1">
                                  <button
                                    type="button"
                                    disabled={selected.length === 0}
                                    onClick={() =>
                                      createOnDevice(sw, 'switch')
                                    }
                                    className="rounded-lg bg-[var(--accent)] px-2 py-1 font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-40"
                                  >
                                    {exists ? 'Guardar' : 'Crear'}
                                  </button>
                                  {exists && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setDeleteConfirm('')
                                        setPendingDelete({
                                          device: sw,
                                          kind: 'switch',
                                          vlanId: currentVlanId,
                                        })
                                      }}
                                      className="rounded-lg border border-[var(--danger)]/50 px-2 py-1 text-[var(--danger)] hover:bg-[var(--danger)]/10"
                                    >
                                      Eliminar
                                    </button>
                                  )}
                                </div>
                              )}
                            </div>
                            {canWrite && (
                              <div className="space-y-2">
                                {(() => {
                                  const info = bridgeInfo[sw.id]
                                  const choice = switchBridge[sw.id] ?? ''
                                  const auto = autoBridge(sw)
                                  return (
                                    <label className="block text-xs">
                                      <span className="mb-1 block text-[var(--text-muted)]">
                                        Bridge
                                      </span>
                                      <select
                                        className={inputClass}
                                        value={choice}
                                        onChange={(e) =>
                                          setSwitchBridge((prev) => ({
                                            ...prev,
                                            [sw.id]: e.target.value,
                                          }))
                                        }
                                      >
                                        <option value="">
                                          {info?.loading
                                            ? 'Leyendo bridges…'
                                            : auto
                                              ? `Automático (${auto})`
                                              : 'Automático'}
                                        </option>
                                        {(info?.names ?? []).map((name) => (
                                          <option key={name} value={name}>
                                            {name}
                                          </option>
                                        ))}
                                        <option value={NEW_BRIDGE}>
                                          Crear bridge nuevo…
                                        </option>
                                      </select>
                                      {choice === NEW_BRIDGE && (
                                        <input
                                          className={`${inputClass} mt-1`}
                                          value={switchNewBridge[sw.id] ?? ''}
                                          onChange={(e) =>
                                            setSwitchNewBridge((prev) => ({
                                              ...prev,
                                              [sw.id]: e.target.value,
                                            }))
                                          }
                                          placeholder="nombre del bridge nuevo"
                                        />
                                      )}
                                      {info?.failed ? (
                                        <span className="mt-1 block text-[11px] text-amber-400">
                                          No se pudieron leer los bridges del
                                          switch. Con «Automático» el servidor
                                          usa el de los puertos elegidos.
                                        </span>
                                      ) : choice === NEW_BRIDGE ? (
                                        <span className="mt-1 block text-[11px] text-amber-400">
                                          Solo puertos que hoy no estén en otro
                                          bridge: mover uno cortaría su tráfico.
                                        </span>
                                      ) : (
                                        <span className="mt-1 block text-[11px] text-[var(--text-muted)]">
                                          La VLAN se suma al bridge existente
                                          sin mover los puertos.
                                        </span>
                                      )}
                                    </label>
                                  )
                                })()}
                                {ports.length === 0 ? (
                                  <span className="block text-[11px] text-amber-400">
                                    Sin puertos en topología. Sincroniza el
                                    switch primero.
                                  </span>
                                ) : (
                                  <div className="max-h-48 space-y-1 overflow-y-auto rounded-md border border-[var(--border)] p-2">
                                    {ports.map((p) => {
                                      const mode =
                                        switchPortModes[sw.id]?.[p.id] ?? ''
                                      return (
                                        <div
                                          key={p.id}
                                          className="flex items-center justify-between gap-2 text-xs"
                                        >
                                          <span className="truncate">
                                            <span className="font-mono">
                                              {p.name}
                                            </span>
                                            {bridgeInfo[sw.id]?.bridgeByPort[
                                              p.name
                                            ] && (
                                              <span className="ml-1 text-[var(--text-muted)]">
                                                (
                                                {
                                                  bridgeInfo[sw.id]
                                                    .bridgeByPort[p.name]
                                                }
                                                )
                                              </span>
                                            )}
                                            {p.comment
                                              ? ` — ${p.comment}`
                                              : ''}
                                          </span>
                                          <select
                                            className="rounded border border-[var(--border)] bg-[var(--bg-elevated)] px-2 py-1 text-xs"
                                            value={mode}
                                            onChange={(e) => {
                                              const value = e.target
                                                .value as SwitchPortMode | ''
                                              setSwitchPortModes((prev) => ({
                                                ...prev,
                                                [sw.id]: {
                                                  ...(prev[sw.id] ?? {}),
                                                  [p.id]: value,
                                                },
                                              }))
                                            }}
                                          >
                                            <option value="">—</option>
                                            <option value="tagged">
                                              tagged
                                            </option>
                                            <option value="untagged">
                                              untagged
                                            </option>
                                          </select>
                                        </div>
                                      )
                                    })}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </>
              )}

              {error && <p className="text-sm text-[var(--danger)]">{error}</p>}
            </div>

            <div className="mt-5 flex flex-wrap justify-end gap-2">
              {modal === 'edit' && editing?.id && canWrite && (
                <button
                  type="button"
                  className="mr-auto rounded-lg px-3 py-2 text-sm text-[var(--danger)] hover:underline"
                  disabled={deleteCatalogMutation.isPending}
                  onClick={() => {
                    void confirm(
                      `¿Quitar VLAN ${editing.vlanId} del catálogo? (no borra de los equipos)`,
                      {
                        title: 'Quitar del catálogo',
                        danger: true,
                        confirmLabel: 'Quitar',
                      },
                    ).then((ok) => {
                      if (ok) void deleteCatalogMutation.mutateAsync(editing.id!)
                    })
                  }}
                >
                  Quitar del catálogo
                </button>
              )}
              <button
                type="button"
                onClick={closeModal}
                className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm"
              >
                {modal === 'edit' ? 'Cerrar' : 'Cancelar'}
              </button>
              {modal === 'create' && (
                <button
                  type="button"
                  disabled={!vlanId}
                  onClick={() => void createCatalogVlan()}
                  className="rounded-lg bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                >
                  Añadir
                </button>
              )}
              {modal === 'edit' && canWrite && (
                <button
                  type="button"
                  onClick={() => {
                    void (async () => {
                      try {
                        const id = await ensureCatalogId()
                        await apiFetch(`/app/settings/vlans/${id}`, {
                          method: 'PATCH',
                          body: JSON.stringify({
                            description: description.trim() || null,
                          }),
                        })
                        setMsg('Descripción guardada')
                        invalidate()
                      } catch (e) {
                        setError(e instanceof Error ? e.message : String(e))
                      }
                    })()
                  }}
                  className="rounded-lg bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white"
                >
                  Guardar descripción
                </button>
              )}
            </div>
          </div>
        </div></ModalPortal>
      )}

      {pendingDelete && (
        <ModalPortal><div className="fixed inset-0 z-[110] modal-backdrop flex items-stretch justify-center overflow-hidden bg-black/60 sm:items-center sm:p-4">
          <div className="h-[100dvh] max-h-[100dvh] overflow-y-auto overscroll-contain w-full max-w-sm rounded-none border-0 sm:h-auto sm:max-h-[min(92dvh,920px)] sm:rounded-xl sm:border border-[var(--border)] bg-[var(--bg-elevated)] p-5 text-[var(--text)] shadow-xl">
            <h3 className="text-lg font-semibold text-[var(--danger)]">
              Eliminar VLAN {pendingDelete.vlanId}
            </h3>
            <p className="mt-2 text-sm text-[var(--text-muted)]">
              Se eliminará de{' '}
              <span className="text-[var(--text)]">
                {pendingDelete.device.name}
              </span>{' '}
              (
              {pendingDelete.kind === 'olt'
                ? `no vlan ${pendingDelete.vlanId}`
                : pendingDelete.kind === 'switch'
                  ? `bridge vlan ${pendingDelete.vlanId}`
                  : `interface vlan_${pendingDelete.vlanId}`}
              ). Puede cortar servicio. Escribe el VLAN-ID para confirmar.
            </p>
            <input
              className={`${inputClass} mt-3`}
              value={deleteConfirm}
              onChange={(e) => setDeleteConfirm(e.target.value)}
              placeholder={String(pendingDelete.vlanId)}
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setPendingDelete(null)
                  setDeleteConfirm('')
                }}
                className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={deleteConfirm.trim() !== String(pendingDelete.vlanId)}
                onClick={confirmDelete}
                className="rounded-lg bg-[var(--danger)] px-3 py-2 text-sm font-medium text-white disabled:opacity-40"
              >
                Eliminar
              </button>
            </div>
          </div>
        </div></ModalPortal>
      )}

      <OperationProgressModal
        open={progressOpen}
        title={progressTitle}
        steps={progressSteps}
        running={progressRunning}
        failed={progressFailed}
        allDone={progressDone}
        onRetry={() => {
          void executeProgress(progressSteps, progressRunners)
        }}
        onClose={() => {
          if (progressRunning) return
          setProgressOpen(false)
          invalidate()
          void vlansQuery.refetch().then((r) => {
            const fresh = r.data?.vlans?.find(
              (x) => x.vlanId === currentVlanId,
            )
            if (fresh) setEditing(fresh)
          })
        }}
      />
    </div>
  )
}
