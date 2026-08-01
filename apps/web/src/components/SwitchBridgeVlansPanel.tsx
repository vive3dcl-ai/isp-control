import { useMemo, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'

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

export function SwitchBridgeVlansPanel({
  deviceId,
  canWrite,
}: {
  deviceId: string
  canWrite: boolean
}) {
  const queryClient = useQueryClient()
  const [bridgeName, setBridgeName] = useState('bridge')
  const [portIface, setPortIface] = useState('')
  const [portBridge, setPortBridge] = useState('bridge')
  const [portPvid, setPortPvid] = useState('1')
  const [vlanId, setVlanId] = useState('')
  const [vlanBridge, setVlanBridge] = useState('bridge')
  const [tagged, setTagged] = useState('')
  const [untagged, setUntagged] = useState('')

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
      invalidate()
    },
  })

  const vlanMutation = useMutation({
    mutationFn: () =>
      apiFetch(`/app/topology/devices/${deviceId}/bridge/vlans`, {
        method: 'PUT',
        body: JSON.stringify({
          bridge: vlanBridge.trim() || 'bridge',
          vlanId: Number(vlanId),
          tagged: tagged
            .split(/[,\s]+/)
            .map((s) => s.trim())
            .filter(Boolean),
          untagged: untagged
            .split(/[,\s]+/)
            .map((s) => s.trim())
            .filter(Boolean),
        }),
      }),
    onSuccess: () => {
      setVlanId('')
      setTagged('')
      setUntagged('')
      invalidate()
    },
  })

  const bridges = query.data?.bridges ?? []
  const ports = query.data?.ports ?? []
  const vlans = query.data?.vlans ?? []

  const portOptions = useMemo(() => {
    const names = new Set<string>()
    for (const p of ports) if (p.interface) names.add(p.interface)
    return [...names].sort()
  }, [ports])

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
    vlanMutation.mutate()
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-[var(--text-muted)]">
        Flujo RouterOS switch: crea un bridge con VLAN filtering, asigna
        puertos (PVID = untagged nativo) y define cada VLAN con tagged /
        untagged.
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
          <div className="mt-2 max-h-40 overflow-auto text-sm">
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
                  <tr key={`${p.bridge}-${p.interface}`} className="border-t border-[var(--border)]">
                    <td className="py-1 pr-2 font-medium">{p.interface}</td>
                    <td className="py-1 pr-2">{p.bridge}</td>
                    <td className="py-1">{p.pvid}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {canWrite && (
            <form
              onSubmit={onPort}
              className="mt-3 grid gap-2 sm:grid-cols-4"
            >
              <input
                className={inputClass}
                list={`ifaces-${deviceId}`}
                value={portIface}
                onChange={(e) => setPortIface(e.target.value)}
                placeholder="ether2"
              />
              <datalist id={`ifaces-${deviceId}`}>
                {portOptions.map((n) => (
                  <option key={n} value={n} />
                ))}
              </datalist>
              <input
                className={inputClass}
                value={portBridge}
                onChange={(e) => setPortBridge(e.target.value)}
                placeholder="bridge"
              />
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
          {portMutation.error && (
            <p className="mt-1 text-xs text-[var(--danger)]">
              {portMutation.error.message}
            </p>
          )}
        </div>
      </div>

      <div className="rounded-lg border border-[var(--border)] p-3">
        <h3 className="text-sm font-medium">Bridge VLANs</h3>
        <div className="mt-2 max-h-52 overflow-auto text-sm">
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
                  className="border-t border-[var(--border)] align-top"
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
        </div>
        {canWrite && (
          <form onSubmit={onVlan} className="mt-3 grid gap-2 sm:grid-cols-2">
            <input
              className={inputClass}
              type="number"
              min={1}
              max={4094}
              value={vlanId}
              onChange={(e) => setVlanId(e.target.value)}
              placeholder="VLAN ID"
            />
            <input
              className={inputClass}
              value={vlanBridge}
              onChange={(e) => setVlanBridge(e.target.value)}
              placeholder="bridge"
            />
            <input
              className={inputClass}
              value={tagged}
              onChange={(e) => setTagged(e.target.value)}
              placeholder="Tagged: ether1,sfp-sfpplus1"
            />
            <input
              className={inputClass}
              value={untagged}
              onChange={(e) => setUntagged(e.target.value)}
              placeholder="Untagged: ether2,ether3"
            />
            <button
              type="submit"
              disabled={vlanMutation.isPending || !Number(vlanId)}
              className="sm:col-span-2 rounded-lg bg-[var(--accent)] px-3 py-2 text-sm text-white disabled:opacity-50"
            >
              Guardar VLAN
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
