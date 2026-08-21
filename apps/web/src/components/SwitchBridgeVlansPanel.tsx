import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'
import type { TopologyPort } from '../lib/topology'
import {
  DesktopTableWrap,
  MobileList,
  MobileListCard,
  MobileListMeta,
} from './MobileList'

const inputClass =
  'w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 outline-none ring-[var(--accent)] focus:ring-2'

type BridgeConfig = {
  ok: boolean
  bridges?: Array<{ name: string; vlanFiltering: boolean; disabled: boolean }>
  ports?: Array<{
    interface: string
    bridge: string
    pvid: number
    disabled: boolean
  }>
  vlans?: Array<{
    vlanIds: number[]
    bridge: string
    tagged: string[]
    untagged: string[]
  }>
}

type PortMode = 'tagged' | 'untagged' | ''

function isPhysicalIface(name: string) {
  return (
    !!name &&
    !/^vlan[_-]?/i.test(name) &&
    !/^lo$/i.test(name) &&
    !/^pppoe/i.test(name)
  )
}

export function SwitchBridgeVlansPanel({
  deviceId,
  canWrite,
  devicePorts = [],
}: {
  deviceId: string
  canWrite: boolean
  devicePorts?: TopologyPort[]
}) {
  const queryClient = useQueryClient()
  const [bridgeName, setBridgeName] = useState('bridge')
  const [portIface, setPortIface] = useState('')
  const [portBridge, setPortBridge] = useState('bridge')
  const [portPvid, setPortPvid] = useState('1')
  const [vlanId, setVlanId] = useState('')
  const [vlanBridge, setVlanBridge] = useState('bridge')
  const [vlanPortModes, setVlanPortModes] = useState<Record<string, PortMode>>(
    {},
  )
  const [editingExisting, setEditingExisting] = useState(false)

  const query = useQuery({
    queryKey: ['app', 'topology', 'devices', deviceId, 'bridge'],
    queryFn: () =>
      apiFetch<BridgeConfig>(`/app/topology/devices/${deviceId}/bridge`),
  })

  const invalidate = () => {
    void queryClient.invalidateQueries({
      queryKey: ['app', 'topology', 'devices', deviceId, 'bridge'],
    })
    void queryClient.invalidateQueries({
      queryKey: ['app', 'topology', 'device', deviceId],
    })
    void queryClient.invalidateQueries({ queryKey: ['app', 'topology'] })
  }

  const ensureMutation = useMutation({
    mutationFn: () =>
      apiFetch(`/app/topology/devices/${deviceId}/bridge/ensure`, {
        method: 'POST',
        body: JSON.stringify({ name: bridgeName.trim() || 'bridge' }),
      }),
    onSuccess: invalidate,
  })

  const portMutation = useMutation({
    mutationFn: () =>
      apiFetch(`/app/topology/devices/${deviceId}/bridge/ports`, {
        method: 'POST',
        body: JSON.stringify({
          interfaceName: portIface.trim(),
          bridge: portBridge.trim() || 'bridge',
          pvid: Number(portPvid) || 1,
        }),
      }),
    onSuccess: () => {
      setPortIface('')
      setPortPvid('1')
      invalidate()
    },
  })

  const vlanMutation = useMutation({
    mutationFn: () => {
      const tagged: string[] = []
      const untagged: string[] = []
      for (const [iface, mode] of Object.entries(vlanPortModes)) {
        if (mode === 'tagged') tagged.push(iface)
        if (mode === 'untagged') untagged.push(iface)
      }
      const bridge = vlanBridge.trim() || 'bridge'
      if (
        !tagged.map((n) => n.toLowerCase()).includes(bridge.toLowerCase())
      ) {
        tagged.push(bridge)
      }
      return apiFetch(`/app/topology/devices/${deviceId}/bridge/vlans`, {
        method: 'PUT',
        body: JSON.stringify({
          bridge,
          vlanId: Number(vlanId),
          tagged,
          untagged,
        }),
      })
    },
    onSuccess: () => {
      setVlanId('')
      setVlanPortModes({})
      setEditingExisting(false)
      invalidate()
    },
  })

  const bridges = query.data?.bridges ?? []
  const ports = query.data?.ports ?? []
  const vlans = query.data?.vlans ?? []

  const selectableIfaces = useMemo(() => {
    const names = new Set<string>()
    for (const p of ports) {
      if (isPhysicalIface(p.interface) && !/^bridge/i.test(p.interface)) {
        names.add(p.interface)
      }
    }
    for (const p of devicePorts) {
      if (isPhysicalIface(p.name) && !/^bridge/i.test(p.name)) {
        names.add(p.name)
      }
    }
    return [...names].sort((a, b) => a.localeCompare(b))
  }, [ports, devicePorts])

  const bridgeSelectOptions = useMemo(() => {
    const names = new Set<string>(['bridge'])
    for (const b of bridges) if (b.name) names.add(b.name)
    return [...names]
  }, [bridges])

  // Prefill port PVID when selecting an interface already on the bridge.
  useEffect(() => {
    if (!portIface) return
    const existing = ports.find(
      (p) => p.interface.toLowerCase() === portIface.toLowerCase(),
    )
    if (existing) {
      setPortBridge(existing.bridge || 'bridge')
      setPortPvid(String(existing.pvid || 1))
    }
  }, [portIface, ports])

  function loadVlanForEdit(v: {
    vlanIds: number[]
    bridge: string
    tagged: string[]
    untagged: string[]
  }) {
    const id = v.vlanIds[0]
    if (!id) return
    setVlanId(String(id))
    setVlanBridge(v.bridge || 'bridge')
    const modes: Record<string, PortMode> = {}
    for (const iface of selectableIfaces) {
      const lower = iface.toLowerCase()
      if (v.tagged.some((t) => t.toLowerCase() === lower)) modes[iface] = 'tagged'
      else if (v.untagged.some((t) => t.toLowerCase() === lower))
        modes[iface] = 'untagged'
      else modes[iface] = ''
    }
    setVlanPortModes(modes)
    setEditingExisting(true)
  }

  function clearVlanForm() {
    setVlanId('')
    setVlanPortModes({})
    setEditingExisting(false)
  }

  function onEnsure(e: FormEvent) {
    e.preventDefault()
    ensureMutation.mutate()
  }
  function onPort(e: FormEvent) {
    e.preventDefault()
    if (!portIface.trim()) return
    portMutation.mutate()
  }
  function onVlan(e: FormEvent) {
    e.preventDefault()
    if (!Number(vlanId)) return
    const hasMembership = Object.values(vlanPortModes).some(
      (m) => m === 'tagged' || m === 'untagged',
    )
    if (!hasMembership) return
    vlanMutation.mutate()
  }

  const hasVlanMembership = Object.values(vlanPortModes).some(
    (m) => m === 'tagged' || m === 'untagged',
  )

  return (
    <div className="space-y-4">
      <p className="text-sm text-[var(--text-muted)]">
        Flujo RouterOS switch: crea un bridge con VLAN filtering, asigna
        puertos (PVID = untagged nativo) y define cada VLAN con tagged /
        untagged. Haz clic en una fila VLAN para editarla.
      </p>

      {query.isLoading && (
        <p className="text-sm text-[var(--text-muted)]">Leyendo bridge…</p>
      )}
      {query.error && (
        <p className="text-sm text-[var(--danger)]">{query.error.message}</p>
      )}

      <div className="grid gap-3 lg:grid-cols-3">
        <div className="rounded-lg border border-[var(--border)] p-3">
          <h3 className="text-sm font-medium">Bridges</h3>
          <ul className="mt-2 space-y-1 text-sm">
            {bridges.length === 0 && (
              <li className="text-[var(--text-muted)]">Ninguno</li>
            )}
            {bridges.map((b) => (
              <li key={b.name}>
                <span className="font-medium">{b.name}</span>
                {b.vlanFiltering ? ' · vlan-filtering' : ''}
                {b.disabled ? ' · disabled' : ''}
              </li>
            ))}
          </ul>
          {canWrite && (
            <form onSubmit={onEnsure} className="mt-3 flex gap-2">
              <input
                className={inputClass}
                value={bridgeName}
                onChange={(e) => setBridgeName(e.target.value)}
                placeholder="bridge"
              />
              <button
                type="submit"
                disabled={ensureMutation.isPending}
                className="shrink-0 rounded-lg bg-[var(--accent)] px-3 py-2 text-sm text-white disabled:opacity-50"
              >
                Asegurar
              </button>
            </form>
          )}
          {ensureMutation.error && (
            <p className="mt-1 text-xs text-[var(--danger)]">
              {ensureMutation.error.message}
            </p>
          )}
        </div>

        <div className="rounded-lg border border-[var(--border)] p-3 lg:col-span-2">
          <h3 className="text-sm font-medium">Puertos en bridge</h3>
          <div className="mt-2 max-h-52 overflow-auto text-sm">
            <MobileList>
              {ports.map((p) => (
                <MobileListCard
                  key={`${p.bridge}-${p.interface}`}
                  className={canWrite ? 'cursor-pointer' : undefined}
                  onClick={() => {
                    if (!canWrite) return
                    setPortIface(p.interface)
                    setPortBridge(p.bridge || 'bridge')
                    setPortPvid(String(p.pvid || 1))
                  }}
                >
                  <p className="text-sm font-semibold">{p.interface}</p>
                  <MobileListMeta>
                    <span>{p.bridge}</span>
                    <span>·</span>
                    <span>PVID {p.pvid}</span>
                  </MobileListMeta>
                </MobileListCard>
              ))}
            </MobileList>
            <DesktopTableWrap bordered={false}>
              <table className="w-full text-left">
                <thead className="text-xs text-[var(--text-muted)]">
                  <tr>
                    <th className="py-1 pr-2">Interfaz</th>
                    <th className="py-1 pr-2">Bridge</th>
                    <th className="py-1">PVID</th>
                  </tr>
                </thead>
                <tbody>
                  {ports.map((p) => (
                    <tr
                      key={`${p.bridge}-${p.interface}`}
                      className={`border-t border-[var(--border)] ${
                        canWrite
                          ? 'cursor-pointer hover:bg-[var(--bg)]'
                          : ''
                      }`}
                      onClick={() => {
                        if (!canWrite) return
                        setPortIface(p.interface)
                        setPortBridge(p.bridge || 'bridge')
                        setPortPvid(String(p.pvid || 1))
                      }}
                    >
                      <td className="py-1 pr-2 font-medium">{p.interface}</td>
                      <td className="py-1 pr-2">{p.bridge}</td>
                      <td className="py-1">{p.pvid}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </DesktopTableWrap>
          </div>
          {canWrite && (
            <form
              onSubmit={onPort}
              className="mt-3 grid gap-2 sm:grid-cols-4"
            >
              <select
                className={inputClass}
                value={portIface}
                onChange={(e) => setPortIface(e.target.value)}
              >
                <option value="">Seleccionar puerto…</option>
                {selectableIfaces.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
              <select
                className={inputClass}
                value={portBridge}
                onChange={(e) => setPortBridge(e.target.value)}
              >
                {bridgeSelectOptions.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
              <input
                className={inputClass}
                type="number"
                min={1}
                max={4094}
                value={portPvid}
                onChange={(e) => setPortPvid(e.target.value)}
                placeholder="PVID"
              />
              <button
                type="submit"
                disabled={portMutation.isPending || !portIface.trim()}
                className="rounded-lg bg-[var(--accent)] px-3 py-2 text-sm text-white disabled:opacity-50"
              >
                Asignar
              </button>
            </form>
          )}
          {selectableIfaces.length === 0 && (
            <p className="mt-2 text-[11px] text-amber-400">
              Sin puertos detectados. Sincroniza el switch en topología.
            </p>
          )}
          {portMutation.error && (
            <p className="mt-1 text-xs text-[var(--danger)]">
              {portMutation.error.message}
            </p>
          )}
        </div>
      </div>

      <div className="rounded-lg border border-[var(--border)] p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-medium">Bridge VLANs</h3>
          {editingExisting && canWrite && (
            <button
              type="button"
              onClick={clearVlanForm}
              className="text-xs text-[var(--text-muted)] hover:underline"
            >
              Nueva VLAN
            </button>
          )}
        </div>
        <div className="mt-2 max-h-64 overflow-auto text-sm">
          <MobileList>
            {vlans.map((v, i) => (
              <MobileListCard
                key={`${v.bridge}-${v.vlanIds.join('-')}-${i}`}
                className={[
                  canWrite ? 'cursor-pointer' : '',
                  editingExisting &&
                  vlanId === String(v.vlanIds[0]) &&
                  vlanBridge === v.bridge
                    ? 'border-[var(--accent)] bg-[var(--accent)]/10'
                    : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => {
                  if (canWrite) loadVlanForEdit(v)
                }}
              >
                <p className="text-sm font-semibold">
                  VLAN {v.vlanIds.join(', ')}
                </p>
                <MobileListMeta>
                  <span>{v.bridge}</span>
                  <span>·</span>
                  <span className="line-clamp-2">
                    Tagged: {v.tagged.join(', ') || '—'}
                  </span>
                  <span>·</span>
                  <span className="line-clamp-2">
                    Untagged: {v.untagged.join(', ') || '—'}
                  </span>
                </MobileListMeta>
              </MobileListCard>
            ))}
          </MobileList>
          <DesktopTableWrap bordered={false}>
            <table className="w-full text-left">
              <thead className="text-xs text-[var(--text-muted)]">
                <tr>
                  <th className="py-1 pr-2">VLAN</th>
                  <th className="py-1 pr-2">Bridge</th>
                  <th className="py-1 pr-2">Tagged</th>
                  <th className="py-1">Untagged</th>
                </tr>
              </thead>
              <tbody>
                {vlans.map((v, i) => (
                  <tr
                    key={`${v.bridge}-${v.vlanIds.join('-')}-${i}`}
                    className={`border-t border-[var(--border)] align-top ${
                      canWrite ? 'cursor-pointer hover:bg-[var(--bg)]' : ''
                    } ${
                      editingExisting &&
                      vlanId === String(v.vlanIds[0]) &&
                      vlanBridge === v.bridge
                        ? 'bg-[var(--accent)]/10'
                        : ''
                    }`}
                    onClick={() => {
                      if (canWrite) loadVlanForEdit(v)
                    }}
                  >
                    <td className="py-1 pr-2 font-medium">
                      {v.vlanIds.join(', ')}
                    </td>
                    <td className="py-1 pr-2">{v.bridge}</td>
                    <td className="py-1 pr-2">{v.tagged.join(', ') || '—'}</td>
                    <td className="py-1">{v.untagged.join(', ') || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </DesktopTableWrap>
        </div>
        {canWrite && (
          <form onSubmit={onVlan} className="mt-3 space-y-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <input
                className={inputClass}
                type="number"
                min={1}
                max={4094}
                value={vlanId}
                onChange={(e) => {
                  setVlanId(e.target.value)
                  setEditingExisting(false)
                }}
                placeholder="VLAN ID"
                disabled={editingExisting}
              />
              <select
                className={inputClass}
                value={vlanBridge}
                onChange={(e) => setVlanBridge(e.target.value)}
              >
                {bridgeSelectOptions.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <p className="mb-1 text-xs text-[var(--text-muted)]">
                Puertos (tagged = trunk, untagged = access / PVID)
              </p>
              {selectableIfaces.length === 0 ? (
                <p className="text-[11px] text-amber-400">
                  Sin puertos para seleccionar.
                </p>
              ) : (
                <div className="max-h-56 space-y-1 overflow-y-auto rounded-md border border-[var(--border)] p-2">
                  {selectableIfaces.map((iface) => (
                    <div
                      key={iface}
                      className="flex items-center justify-between gap-2 text-xs"
                    >
                      <span className="truncate font-mono">{iface}</span>
                      <select
                        className="rounded border border-[var(--border)] bg-[var(--bg-elevated)] px-2 py-1 text-xs"
                        value={vlanPortModes[iface] ?? ''}
                        onChange={(e) => {
                          const value = e.target.value as PortMode
                          setVlanPortModes((prev) => ({
                            ...prev,
                            [iface]: value,
                          }))
                        }}
                      >
                        <option value="">—</option>
                        <option value="tagged">tagged</option>
                        <option value="untagged">untagged</option>
                      </select>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <button
              type="submit"
              disabled={
                vlanMutation.isPending ||
                !Number(vlanId) ||
                !hasVlanMembership
              }
              className="w-full rounded-lg bg-[var(--accent)] px-3 py-2 text-sm text-white disabled:opacity-50"
            >
              {editingExisting ? 'Actualizar VLAN' : 'Guardar VLAN'}
            </button>
          </form>
        )}
        {vlanMutation.error && (
          <p className="mt-1 text-xs text-[var(--danger)]">
            {vlanMutation.error.message}
          </p>
        )}
      </div>
    </div>
  )
}
