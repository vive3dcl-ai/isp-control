import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'
import {
  DEFAULT_VPN_ROUTES,
  VPN_PROTOCOLS,
  vpnProtocolLabel,
  vpnStatusLabel,
  type VpnProtocol,
  type VpnSetupPayload,
  type VpnTunnel,
  type VpnTunnelClient,
} from '../lib/vpn'
import type { TopologyDevice } from '../lib/topology'
import { useNotify } from './NotifyProvider'
import { ModalPortal } from './ModalPortal'

const inputClass =
  'w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 outline-none ring-[var(--accent)] focus:ring-2'

type View = 'list' | 'create' | 'edit' | 'setup' | 'import' | 'equipos'

export function VpnModal({
  open,
  onClose,
  canWrite,
}: {
  open: boolean
  onClose: () => void
  canWrite: boolean
}) {
  const queryClient = useQueryClient()
  const { confirm } = useNotify()
  const [view, setView] = useState<View>('list')
  const [selected, setSelected] = useState<VpnTunnel | null>(null)
  const [setup, setSetup] = useState<VpnSetupPayload | null>(null)
  const [expiresLeft, setExpiresLeft] = useState(0)
  const [protocol, setProtocol] = useState<VpnProtocol>('openvpn_tcp')
  const [name, setName] = useState('')
  const [tunnelSubnet, setTunnelSubnet] = useState('')
  const [tunnelRoutes, setTunnelRoutes] = useState(DEFAULT_VPN_ROUTES)
  const [password, setPassword] = useState('')
  const [importDeviceId, setImportDeviceId] = useState('')
  const [importClientId, setImportClientId] = useState('')
  const [setupClientId, setSetupClientId] = useState('')
  const [clientName, setClientName] = useState('')
  const [clientPassword, setClientPassword] = useState('')
  const [importResult, setImportResult] = useState<string | null>(null)
  const [importRunning, setImportRunning] = useState(false)
  const [importSteps, setImportSteps] = useState<
    Array<{
      id: string
      label: string
      status: 'pending' | 'running' | 'ok' | 'error'
      detail?: string
    }>
  >([])
  const [probeReport, setProbeReport] = useState<{
    summary: string
    ok: boolean
    steps: Array<{ id: string; label: string; ok: boolean; detail: string }>
  } | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [helpOpen, setHelpOpen] = useState(false)

  const tunnelsQuery = useQuery({
    queryKey: ['app', 'topology', 'vpn', 'tunnels'],
    queryFn: () =>
      apiFetch<{ tunnels: VpnTunnel[] }>('/app/topology/vpn/tunnels'),
    enabled: open,
    refetchInterval: open ? 15_000 : false,
  })

  const probeMutation = useMutation({
    mutationFn: (id: string) =>
      apiFetch<{
        ok: boolean
        status: string
        reachable: boolean
        summary?: string
        detail?: string
        steps?: Array<{
          id: string
          label: string
          ok: boolean
          detail: string
        }>
      }>(`/app/topology/vpn/tunnels/${id}/probe`, { method: 'POST' }),
    onSuccess: (data) => {
      setProbeReport({
        ok: data.ok,
        summary: data.summary || data.detail || (data.ok ? 'OK' : 'Falló'),
        steps: data.steps ?? [],
      })
      setError(null)
      void queryClient.invalidateQueries({
        queryKey: ['app', 'topology', 'vpn', 'tunnels'],
      })
    },
    onError: (e: Error) => {
      setProbeReport(null)
      setError(e.message)
    },
  })

  const topologyQuery = useQuery({
    queryKey: ['app', 'topology'],
    queryFn: () =>
      apiFetch<{ devices: TopologyDevice[] }>('/app/topology'),
    enabled: open && (view === 'import' || view === 'list' || view === 'equipos'),
  })

  const mikrotikAssets = useMemo(
    () =>
      (topologyQuery.data?.devices ?? []).filter(
        (d) =>
          d.isActive &&
          d.mgmtHost &&
          ((d.type === 'router' &&
            (d.subtype === 'mikrotik' || !d.subtype)) ||
            (d.type === 'switch' && d.subtype === 'mikrotik_routeros')),
      ),
    [topologyQuery.data?.devices],
  )

  const deviceNameById = useMemo(() => {
    const map = new Map<string, string>()
    for (const d of topologyQuery.data?.devices ?? []) {
      map.set(d.id, d.name)
    }
    return map
  }, [topologyQuery.data?.devices])

  const selectedClients = selected?.clients ?? []
  const assignedDeviceIds = useMemo(() => {
    const ids = new Set<string>()
    for (const t of tunnelsQuery.data?.tunnels ?? []) {
      for (const c of t.clients ?? []) {
        if (c.deviceId) ids.add(c.deviceId)
      }
    }
    return ids
  }, [tunnelsQuery.data?.tunnels])

  useEffect(() => {
    if (!open) {
      setView('list')
      setSelected(null)
      setSetup(null)
      setError(null)
      setImportResult(null)
      setImportSteps([])
      setImportRunning(false)
      setProbeReport(null)
      setHelpOpen(false)
    }
  }, [open])

  useEffect(() => {
    if (!setup?.expiresInSeconds) return
    setExpiresLeft(setup.expiresInSeconds)
    const t = setInterval(() => {
      setExpiresLeft((s) => (s > 0 ? s - 1 : 0))
    }, 1000)
    return () => clearInterval(t)
  }, [setup])

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (view !== 'list') {
          setView('list')
          setSetup(null)
        } else onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose, view])

  const createMutation = useMutation({
    mutationFn: () =>
      apiFetch<VpnTunnel>('/app/topology/vpn/tunnels', {
        method: 'POST',
        body: JSON.stringify({
          protocol,
          name: name.trim() || undefined,
          tunnelSubnet: tunnelSubnet.trim() || undefined,
          tunnelRoutes: tunnelRoutes.trim() || DEFAULT_VPN_ROUTES,
          password: password.trim() || undefined,
        }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ['app', 'topology', 'vpn', 'tunnels'],
      })
      setView('list')
      setName('')
      setTunnelSubnet('')
      setPassword('')
      setTunnelRoutes(DEFAULT_VPN_ROUTES)
      setProtocol('openvpn_tcp')
      setError(null)
    },
    onError: (e: Error) => setError(e.message),
  })

  const updateMutation = useMutation({
    mutationFn: () =>
      apiFetch<VpnTunnel>(`/app/topology/vpn/tunnels/${selected!.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: name.trim(),
          tunnelSubnet: tunnelSubnet.trim() || undefined,
          tunnelRoutes: tunnelRoutes.trim() || DEFAULT_VPN_ROUTES,
          password: password.trim() || undefined,
        }),
      }),
    onSuccess: (updated) => {
      void queryClient.invalidateQueries({
        queryKey: ['app', 'topology', 'vpn', 'tunnels'],
      })
      setSelected(updated)
      setView('list')
      setError(null)
      setImportResult(
        'Redes guardadas. El Script ya las refleja; usa Importar en el MikroTik para añadir solo las rutas nuevas.',
      )
    },
    onError: (e: Error) => setError(e.message),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/app/topology/vpn/tunnels/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ['app', 'topology', 'vpn', 'tunnels'],
      })
    },
  })

  const setupMutation = useMutation({
    mutationFn: ({ id, clientId }: { id: string; clientId?: string }) =>
      apiFetch<VpnSetupPayload>(`/app/topology/vpn/tunnels/${id}/setup`, {
        method: 'POST',
        body: JSON.stringify(clientId ? { clientId } : {}),
      }),
    onSuccess: (data) => {
      setSetup(data)
      setSetupClientId(data.client?.id ?? '')
      setView('setup')
      setError(null)
    },
    onError: (e: Error) => setError(e.message),
  })

  const createClientMutation = useMutation({
    mutationFn: () =>
      apiFetch<VpnTunnelClient>(
        `/app/topology/vpn/tunnels/${selected!.id}/clients`,
        {
          method: 'POST',
          body: JSON.stringify({
            name: clientName.trim(),
            password: clientPassword.trim() || undefined,
          }),
        },
      ),
    onSuccess: async () => {
      setClientName('')
      setClientPassword('')
      setError(null)
      const refreshed = await queryClient.fetchQuery({
        queryKey: ['app', 'topology', 'vpn', 'tunnels'],
        queryFn: () =>
          apiFetch<{ tunnels: VpnTunnel[] }>('/app/topology/vpn/tunnels'),
      })
      const next = refreshed.tunnels.find((t) => t.id === selected!.id)
      if (next) setSelected(next)
    },
    onError: (e: Error) => setError(e.message),
  })

  const deleteClientMutation = useMutation({
    mutationFn: (clientId: string) =>
      apiFetch(
        `/app/topology/vpn/tunnels/${selected!.id}/clients/${clientId}`,
        { method: 'DELETE' },
      ),
    onSuccess: async () => {
      const refreshed = await queryClient.fetchQuery({
        queryKey: ['app', 'topology', 'vpn', 'tunnels'],
        queryFn: () =>
          apiFetch<{ tunnels: VpnTunnel[] }>('/app/topology/vpn/tunnels'),
      })
      const next = refreshed.tunnels.find((t) => t.id === selected!.id)
      if (next) setSelected(next)
    },
    onError: (e: Error) => setError(e.message),
  })

  const importMutation = useMutation({
    mutationFn: async () => {
      type PhaseResult = {
        ok: boolean
        phase?: string
        mode?: string
        note?: string
        detail?: string
        addedRoutes?: string[]
        skippedRoutes?: string[]
        firewallPending?: string[]
        pendingCommands?: number
        applied?: number
        failed?: number
        errors?: string[]
        checks?: Array<{
          id: string
          label: string
          ok: boolean
          detail: string
        }>
      }

      const phases: Array<{
        id: 'connect' | 'plan' | 'apply' | 'verify'
        label: string
      }> = [
        { id: 'connect', label: 'Conectar API RouterOS' },
        { id: 'plan', label: 'Analizar rutas y reglas' },
        { id: 'apply', label: 'Aplicar cambios' },
        { id: 'verify', label: 'Verificar reglas creadas' },
      ]

      setImportRunning(true)
      setImportSteps(
        phases.map((p) => ({
          id: p.id,
          label: p.label,
          status: 'pending' as const,
        })),
      )
      setError(null)

      let last: PhaseResult | null = null
      for (const p of phases) {
        setImportSteps((prev) =>
          prev.map((s) =>
            s.id === p.id ? { ...s, status: 'running', detail: '…' } : s,
          ),
        )
        try {
          const data = await apiFetch<PhaseResult>(
            `/app/topology/vpn/tunnels/${selected!.id}/import`,
            {
              method: 'POST',
              body: JSON.stringify({
                deviceId: importDeviceId,
                clientId: importClientId || undefined,
                phase: p.id,
              }),
            },
          )
          last = data
          setImportSteps((prev) =>
            prev.map((s) =>
              s.id === p.id
                ? {
                    ...s,
                    status: data.ok ? 'ok' : 'error',
                    detail: data.detail || data.note || (data.ok ? 'OK' : 'Error'),
                  }
                : s,
            ),
          )
          if (!data.ok) {
            throw new Error(
              data.errors?.filter(Boolean).join('; ') ||
                data.detail ||
                data.note ||
                `Falló: ${p.label}`,
            )
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          setImportSteps((prev) =>
            prev.map((s) =>
              s.id === p.id
                ? {
                    ...s,
                    status: s.status === 'ok' ? 'ok' : 'error',
                    detail: msg,
                  }
                : s,
            ),
          )
          throw e
        }
      }
      return last!
    },
    onSuccess: (data) => {
      void queryClient.invalidateQueries({
        queryKey: ['app', 'topology', 'vpn', 'tunnels'],
      })
      const added = data.addedRoutes?.length
        ? ` Añadidas: ${data.addedRoutes.join(', ')}.`
        : ''
      const skipped = data.skippedRoutes?.length
        ? ` Ya existían / faltan post-check: ${data.skippedRoutes.length}.`
        : ''
      setImportResult(
        (data.note ||
          (data.ok ? 'Importación OK' : 'Importación con errores')) +
          added +
          skipped,
      )
      setError(
        data.errors?.length
          ? data.errors.filter(Boolean).join('; ')
          : null,
      )
      setImportRunning(false)
    },
    onError: (e: Error) => {
      setError(e.message)
      setImportRunning(false)
    },
  })

  if (!open) return null

  async function copyText(text: string, kind: string) {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(kind)
      setTimeout(() => setCopied(null), 2000)
    } catch {
      setError('No se pudo copiar al portapapeles')
    }
  }

  function openEdit(t: VpnTunnel) {
    setSelected(t)
    setName(t.name)
    setTunnelSubnet(t.tunnelSubnet)
    setTunnelRoutes(t.tunnelRoutes || DEFAULT_VPN_ROUTES)
    setPassword('')
    setView('edit')
  }

  function resetCreateForm() {
    setProtocol('openvpn_tcp')
    setName('')
    setTunnelSubnet('')
    setPassword('')
    setTunnelRoutes(DEFAULT_VPN_ROUTES)
    setView('create')
  }

  return (
    <>
    <ModalPortal><div className="fixed inset-0 z-[110] modal-backdrop flex items-stretch justify-center overflow-hidden bg-black/60 sm:items-center sm:p-4">
      <div
        role="dialog"
        aria-modal="true"
        className="flex h-[100dvh] max-h-[100dvh] w-full max-w-2xl flex-col overflow-hidden rounded-none border-0 sm:h-auto sm:max-h-[min(92dvh,920px)] sm:rounded-xl sm:border border-[var(--border)] bg-[var(--bg-elevated)] shadow-xl"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-[var(--border)] px-5 py-4">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold">
                {view === 'list' && 'VPN tunnels'}
                {view === 'create' && 'Add tunnel'}
                {view === 'edit' && 'Edit tunnel'}
                {view === 'equipos' && `Equipos · ${selected?.name ?? ''}`}
                {view === 'setup' && 'MikroTik VPN setup'}
                {view === 'import' && 'Importar a activo'}
              </h2>
              {view === 'list' && (
                <button
                  type="button"
                  onClick={() => setHelpOpen(true)}
                  className="flex h-6 w-6 items-center justify-center rounded-full border border-[var(--border)] text-sm font-medium text-[var(--text-muted)] transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
                  title="Ayuda: cómo conectar"
                  aria-label="Ayuda VPN"
                >
                  ?
                </button>
              )}
            </div>
            {view === 'setup' && setup && (
              <p className="text-xs text-[var(--text-muted)]">
                {setup.protocolLabel} · {setup.tunnel.name}@
                {setup.endpoint.host}:{setup.endpoint.port}
                {expiresLeft > 0
                  ? ` · expira en ${expiresLeft}s`
                  : ' · token expirado (regenera)'}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2 py-1 text-[var(--text-muted)] hover:bg-[var(--bg)]"
          >
            ✕
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {error && (
            <p className="mb-3 text-sm text-[var(--danger)]">{error}</p>
          )}
          {importResult && view === 'list' && (
            <p className="mb-3 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--text)]">
              {importResult}
            </p>
          )}
          {probeReport && view === 'list' && (
            <div
              className={`mb-3 rounded-lg border px-3 py-2 text-sm ${
                probeReport.ok
                  ? 'border-emerald-500/40 bg-emerald-500/5'
                  : 'border-[var(--danger)]/40 bg-[var(--bg)]'
              }`}
            >
              <p className="font-medium">{probeReport.summary}</p>
              {probeReport.steps.length > 0 && (
                <ul className="mt-2 space-y-1.5 text-xs">
                  {probeReport.steps.map((s) => (
                    <li key={s.id}>
                      <span
                        className={
                          s.ok
                            ? 'text-emerald-600'
                            : 'text-[var(--danger)]'
                        }
                      >
                        {s.ok ? '✓' : '✗'} {s.label}
                      </span>
                      <span className="mt-0.5 block pl-4 text-[var(--text-muted)]">
                        {s.detail}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {view === 'list' && (
            <div className="space-y-3">
              <p className="text-sm text-[var(--text-muted)]">
                El MikroTik se conecta al concentrador de plataforma
                (OpenVPN/WireGuard). El concentrador sincroniza peers
                automáticamente. Routes por defecto = RFC1918.
              </p>
              {tunnelsQuery.isLoading && (
                <p className="text-sm text-[var(--text-muted)]">Cargando…</p>
              )}
              {(tunnelsQuery.data?.tunnels ?? []).length === 0 &&
                !tunnelsQuery.isLoading && (
                  <p className="rounded-lg border border-dashed border-[var(--border)] px-4 py-8 text-center text-sm text-[var(--text-muted)]">
                    No hay túneles. Crea el primero con Añadir.
                  </p>
                )}
              <ul className="space-y-2">
                {(tunnelsQuery.data?.tunnels ?? []).map((t) => (
                  <li
                    key={t.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--border)] px-3 py-2"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium">{t.name}</p>
                        <span
                          className={
                            t.status === 'connected' || t.status === 'online'
                              ? 'rounded border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-600'
                              : t.status === 'offline' || t.status === 'error'
                                ? 'rounded border border-[var(--danger)]/40 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--danger)]'
                                : 'rounded border border-[var(--border)] px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--text-muted)]'
                          }
                        >
                          {vpnStatusLabel[t.status] ?? t.status}
                        </span>
                      </div>
                      <p className="truncate text-xs text-[var(--text-muted)]">
                        {t.protocolLabel ?? t.protocol} · {t.tunnelSubnet} ·{' '}
                        {t.serverAddress}
                        {(t.clientCount ?? t.clients?.length ?? 0) > 0
                          ? ` · ${t.clientCount ?? t.clients?.length} equipo(s)`
                          : ''}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {canWrite && (
                        <>
                          <button
                            type="button"
                            className="rounded-md border border-[var(--border)] px-2 py-1 text-xs hover:border-[var(--accent)]"
                            disabled={probeMutation.isPending}
                            onClick={() => probeMutation.mutate(t.id)}
                          >
                            Verificar
                          </button>
                          <button
                            type="button"
                            className="rounded-md border border-[var(--border)] px-2 py-1 text-xs hover:border-[var(--accent)]"
                            onClick={() => openEdit(t)}
                          >
                            Editar
                          </button>
                          <button
                            type="button"
                            className="rounded-md border border-[var(--border)] px-2 py-1 text-xs hover:border-[var(--accent)]"
                            onClick={() => {
                              setSelected(t)
                              setClientName('')
                              setClientPassword('')
                              setView('equipos')
                            }}
                          >
                            Equipos
                          </button>
                          <button
                            type="button"
                            className="rounded-md border border-[var(--border)] px-2 py-1 text-xs hover:border-[var(--accent)]"
                            onClick={() => {
                              setSelected(t)
                              const clients = t.clients ?? []
                              if (clients.length <= 1) {
                                setupMutation.mutate({
                                  id: t.id,
                                  clientId: clients[0]?.id,
                                })
                              } else {
                                setSetupClientId(clients[0]?.id ?? '')
                                setSetup(null)
                                setView('setup')
                              }
                            }}
                          >
                            Script
                          </button>
                          <button
                            type="button"
                            className="rounded-md border border-[var(--border)] px-2 py-1 text-xs hover:border-[var(--accent)]"
                            onClick={() => {
                              setSelected(t)
                              setImportDeviceId('')
                              setImportClientId(t.clients?.[0]?.id ?? '')
                              setView('import')
                            }}
                          >
                            Importar
                          </button>
                          <button
                            type="button"
                            className="rounded-md border border-[var(--danger)]/40 px-2 py-1 text-xs text-[var(--danger)]"
                            onClick={() => {
                              void confirm(`¿Eliminar túnel ${t.name}?`, {
                                title: 'Eliminar túnel VPN',
                                danger: true,
                                confirmLabel: 'Eliminar',
                              }).then((ok) => {
                                if (ok) deleteMutation.mutate(t.id)
                              })
                            }}
                          >
                            Borrar
                          </button>
                        </>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {(view === 'create' || view === 'edit') && (
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault()
                if (view === 'create') createMutation.mutate()
                else updateMutation.mutate()
              }}
            >
              {view === 'create' && (
                <label className="block text-sm">
                  <span className="mb-1 block text-[var(--text-muted)]">
                    Tipo
                  </span>
                  <select
                    className={inputClass}
                    value={protocol}
                    onChange={(e) =>
                      setProtocol(e.target.value as VpnProtocol)
                    }
                  >
                    {VPN_PROTOCOLS.map((p) => (
                      <option key={p} value={p}>
                        {vpnProtocolLabel[p]}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label className="block text-sm">
                <span className="mb-1 block text-[var(--text-muted)]">
                  Tunnel name
                </span>
                <input
                  className={inputClass}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="tunnel1"
                  required={view === 'edit'}
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-[var(--text-muted)]">
                  Tunnel subnet
                </span>
                <input
                  className={inputClass}
                  value={tunnelSubnet}
                  onChange={(e) => setTunnelSubnet(e.target.value)}
                  placeholder={
                    (view === 'edit' ? selected?.protocol : protocol) ===
                    'openvpn_udp'
                      ? 'Auto 10.69.129-254.0/24'
                      : 'Auto 10.69.1-126.0/24'
                  }
                />
                <span className="mt-1 block text-xs text-[var(--text-muted)]">
                  OpenVPN TCP y WireGuard usan 10.69.1–126; OpenVPN UDP usa
                  10.69.129–254 (pools separados en el concentrador).
                </span>
              </label>
              {((view === 'create' && protocol !== 'wireguard') ||
                (view === 'edit' &&
                  selected?.protocol !== 'wireguard')) && (
                <label className="block text-sm">
                  <span className="mb-1 block text-[var(--text-muted)]">
                    {view === 'edit'
                      ? 'Tunnel password (vacío = no cambiar)'
                      : 'Tunnel password'}
                  </span>
                  <input
                    className={inputClass}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={
                      view === 'create' ? 'Auto-generada si vacío' : undefined
                    }
                  />
                </label>
              )}
              <label className="block text-sm">
                <span className="mb-1 block text-[var(--text-muted)]">
                  Redes accesibles vía túnel (OLT / mgmt) *
                </span>
                <textarea
                  className={`${inputClass} min-h-[100px] font-mono text-xs`}
                  value={tunnelRoutes}
                  onChange={(e) => setTunnelRoutes(e.target.value)}
                />
              </label>
              <p className="text-xs text-[var(--text-muted)]">
                CIDRs que el concentrador debe alcanzar detrás del MikroTik
                (OLT, pools ONU, LAN). Van a AllowedIPs / iroute del
                concentrador y a rutas + firewall en el router. Por defecto
                RFC1918; afina a tus subredes reales si puedes.
              </p>
              <p className="text-xs italic text-[var(--text-muted)]">
                * Se recomienda dejar subnet/password auto si no sabes lo que
                haces; las redes sí conviene ajustarlas a tus OLT.
              </p>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm"
                  onClick={() => setView('list')}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={
                    createMutation.isPending || updateMutation.isPending
                  }
                  className="rounded-lg bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white"
                >
                  {view === 'create' ? 'Crear' : 'Guardar'}
                </button>
              </div>
            </form>
          )}

          {view === 'equipos' && selected && (
            <div className="space-y-4">
              <p className="text-sm text-[var(--text-muted)]">
                Clientes del segmento{' '}
                <code className="font-mono">{selected.tunnelSubnet}</code>{' '}
                (gateway {selected.serverAddress}). Cada equipo recibe .2, .3,
                .4… con sus propias credenciales y se ven entre sí.
              </p>
              <ul className="divide-y divide-[var(--border)] rounded-lg border border-[var(--border)]">
                {(selected.clients ?? []).map((c) => (
                  <li
                    key={c.id}
                    className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm"
                  >
                    <div>
                      <p className="font-medium">
                        {c.name}{' '}
                        <span className="font-mono text-xs text-[var(--text-muted)]">
                          {c.clientAddress}
                        </span>
                      </p>
                      <p className="text-xs text-[var(--text-muted)]">
                        {c.deviceId
                          ? `Activo: ${deviceNameById.get(c.deviceId) ?? c.deviceId}`
                          : 'Sin activo asignado'}
                      </p>
                    </div>
                    {canWrite && (selected.clients?.length ?? 0) > 1 && (
                      <button
                        type="button"
                        className="rounded-md border border-[var(--danger)]/40 px-2 py-1 text-xs text-[var(--danger)]"
                        onClick={() => {
                          void confirm(`¿Eliminar cliente ${c.name}?`, {
                            title: 'Eliminar cliente VPN',
                            danger: true,
                            confirmLabel: 'Eliminar',
                          }).then((ok) => {
                            if (ok) deleteClientMutation.mutate(c.id)
                          })
                        }}
                      >
                        Eliminar
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              {canWrite && (
                <form
                  className="space-y-2 rounded-lg border border-[var(--border)] p-3"
                  onSubmit={(e) => {
                    e.preventDefault()
                    if (!clientName.trim()) return
                    createClientMutation.mutate()
                  }}
                >
                  <p className="text-xs font-medium text-[var(--text-muted)]">
                    Añadir equipo al segmento
                  </p>
                  <input
                    className={inputClass}
                    placeholder="Nombre (usuario OpenVPN)"
                    value={clientName}
                    onChange={(e) => setClientName(e.target.value)}
                    required
                  />
                  {selected.protocol !== 'wireguard' && (
                    <input
                      className={inputClass}
                      type="password"
                      placeholder="Password (vacío = auto)"
                      value={clientPassword}
                      onChange={(e) => setClientPassword(e.target.value)}
                    />
                  )}
                  <button
                    type="submit"
                    disabled={
                      !clientName.trim() || createClientMutation.isPending
                    }
                    className="rounded-lg bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                  >
                    {createClientMutation.isPending
                      ? 'Creando…'
                      : 'Añadir equipo'}
                  </button>
                </form>
              )}
              <button
                type="button"
                className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm"
                onClick={() => setView('list')}
              >
                Volver
              </button>
            </div>
          )}

          {view === 'setup' && (setup || selected) && (
            <div className="space-y-4">
              {(selectedClients.length > 1 || !setup) && (
                <label className="block text-sm">
                  <span className="mb-1 block text-[var(--text-muted)]">
                    Cliente / equipo
                  </span>
                  <select
                    className={inputClass}
                    value={setupClientId}
                    onChange={(e) => {
                      setSetupClientId(e.target.value)
                      setSetup(null)
                    }}
                  >
                    <option value="">Seleccionar…</option>
                    {selectedClients.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} · {c.clientAddress}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="mt-2 rounded-lg bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                    disabled={!setupClientId || setupMutation.isPending}
                    onClick={() =>
                      setupMutation.mutate({
                        id: selected!.id,
                        clientId: setupClientId,
                      })
                    }
                  >
                    {setupMutation.isPending
                      ? 'Generando…'
                      : 'Generar script'}
                  </button>
                </label>
              )}
              {setup && (
                <>
              <p className="text-sm text-[var(--text-muted)]">
                El concentrador ya sincroniza el usuario/peer solo. Copia el
                bootstrap o el script en el MikroTik (cliente →{' '}
                {setup.endpoint.host}:{setup.endpoint.port}
                {setup.client
                  ? ` · ${setup.client.name} ${setup.client.clientAddress}`
                  : ''}
                ).
              </p>
              {setup.acsUrlHint && (
                <p className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-xs">
                  ACS URL sugerida (TR069 vía túnel):{' '}
                  <code className="font-mono">{setup.acsUrlHint}</code>
                </p>
              )}
              {setup.bootstrap && (
                <div>
                  <p className="mb-1 text-xs font-medium text-[var(--text-muted)]">
                    Instalación rápida (bootstrap)
                  </p>
                  <pre className="max-h-32 overflow-auto rounded-lg border border-[var(--border)] bg-[var(--bg)] p-3 text-xs whitespace-pre-wrap break-all">
                    {setup.bootstrap}
                  </pre>
                  <button
                    type="button"
                    className="mt-2 rounded-lg bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white"
                    onClick={() => copyText(setup.bootstrap!, 'bootstrap')}
                  >
                    {copied === 'bootstrap'
                      ? 'Copiado'
                      : 'Copy to clipboard'}
                  </button>
                </div>
              )}
              <div>
                <p className="mb-1 text-xs font-medium text-[var(--text-muted)]">
                  Script MikroTik (cliente OVPN/WG)
                </p>
                <pre className="max-h-56 overflow-auto rounded-lg border border-[var(--border)] bg-[var(--bg)] p-3 text-xs whitespace-pre-wrap">
                  {setup.script}
                </pre>
                <button
                  type="button"
                  className="mt-2 rounded-lg border border-[var(--border)] px-3 py-2 text-sm hover:border-[var(--accent)]"
                  onClick={() => copyText(setup.script, 'script')}
                >
                  {copied === 'script'
                    ? 'Copiado'
                    : 'Copiar script completo'}
                </button>
              </div>
              <p className="text-xs text-[var(--text-muted)]">{setup.note}</p>
                </>
              )}
              <button
                type="button"
                className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm"
                onClick={() => {
                  setView('list')
                  setSetup(null)
                }}
              >
                Close
              </button>
            </div>
          )}

          {view === 'import' && selected && (
            <div className="space-y-3">
              <p className="text-sm text-[var(--text-muted)]">
                Asigna un cliente del segmento{' '}
                <strong>{selected.name}</strong> a un activo MikroTik
                (router o switch RouterOS). Un cliente solo puede asignarse
                una vez.
              </p>
              <label className="block text-sm">
                <span className="mb-1 block text-[var(--text-muted)]">
                  Cliente VPN
                </span>
                <select
                  className={inputClass}
                  value={importClientId}
                  onChange={(e) => setImportClientId(e.target.value)}
                  required
                  disabled={importRunning}
                >
                  <option value="">Seleccionar…</option>
                  {selectedClients.map((c) => {
                    const taken =
                      !!c.deviceId && c.deviceId !== importDeviceId
                    return (
                      <option key={c.id} value={c.id} disabled={taken}>
                        {c.name} · {c.clientAddress}
                        {c.deviceId
                          ? ` · ${deviceNameById.get(c.deviceId) ?? 'asignado'}`
                          : ''}
                      </option>
                    )
                  })}
                </select>
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-[var(--text-muted)]">
                  Activo
                </span>
                <select
                  className={inputClass}
                  value={importDeviceId}
                  onChange={(e) => setImportDeviceId(e.target.value)}
                  required
                  disabled={importRunning}
                >
                  <option value="">Seleccionar…</option>
                  {mikrotikAssets.map((d) => {
                    const takenByOther =
                      assignedDeviceIds.has(d.id) &&
                      !selectedClients.some(
                        (c) =>
                          c.id === importClientId && c.deviceId === d.id,
                      )
                    return (
                      <option
                        key={d.id}
                        value={d.id}
                        disabled={takenByOther}
                      >
                        {d.name}
                        {d.type === 'switch' ? ' (switch)' : ' (router)'}
                        {d.mgmtHost ? ` · ${d.mgmtHost}` : ''}
                        {takenByOther ? ' · ya asignado' : ''}
                      </option>
                    )
                  })}
                </select>
              </label>
              {mikrotikAssets.length === 0 && (
                <p className="text-xs text-[var(--text-muted)]">
                  No hay activos MikroTik RouterOS con host de gestión.
                  Configura uno en Topología primero.
                </p>
              )}

              {importSteps.length > 0 && (
                <ol className="space-y-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] p-3 text-sm">
                  {importSteps.map((s, i) => (
                    <li key={s.id} className="flex gap-3">
                      <span
                        className={
                          s.status === 'ok'
                            ? 'text-emerald-600'
                            : s.status === 'error'
                              ? 'text-red-600'
                              : s.status === 'running'
                                ? 'text-[var(--accent)]'
                                : 'text-[var(--text-muted)]'
                        }
                      >
                        {s.status === 'ok'
                          ? '✓'
                          : s.status === 'error'
                            ? '✗'
                            : s.status === 'running'
                              ? '…'
                              : `${i + 1}.`}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="font-medium">{s.label}</div>
                        {s.detail && (
                          <div className="mt-0.5 break-words text-xs text-[var(--text-muted)]">
                            {s.detail}
                          </div>
                        )}
                      </div>
                    </li>
                  ))}
                </ol>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm"
                  disabled={importRunning}
                  onClick={() => {
                    setView('list')
                    setImportSteps([])
                  }}
                >
                  {importRunning ? 'En curso…' : 'Cancelar'}
                </button>
                <button
                  type="button"
                  disabled={
                    !importDeviceId ||
                    !importClientId ||
                    importRunning ||
                    importMutation.isPending
                  }
                  className="rounded-lg bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                  onClick={() => importMutation.mutate()}
                >
                  {importRunning || importMutation.isPending
                    ? 'Importando…'
                    : importSteps.some((s) => s.status === 'error')
                      ? 'Reintentar'
                      : 'Importar al activo'}
                </button>
              </div>
            </div>
          )}
        </div>

        {view === 'list' && canWrite && (
          <div className="flex shrink-0 justify-end border-t border-[var(--border)] px-5 py-3">
            <button
              type="button"
              className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white"
              onClick={resetCreateForm}
            >
              Añadir
            </button>
          </div>
        )}
      </div>
    </div></ModalPortal>

    {helpOpen && (
      <ModalPortal><div className="fixed inset-0 z-[120] modal-backdrop flex items-stretch justify-center overflow-hidden bg-black/60 sm:items-center sm:p-4">
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="vpn-help-title"
          className="flex h-[100dvh] max-h-[100dvh] w-full max-w-lg flex-col overflow-hidden rounded-none border-0 sm:h-auto sm:max-h-[min(92dvh,920px)] sm:rounded-xl sm:border border-[var(--border)] bg-[var(--bg-elevated)] shadow-xl"
        >
          <div className="flex shrink-0 items-center justify-between border-b border-[var(--border)] px-5 py-4">
            <h3 id="vpn-help-title" className="text-lg font-semibold">
              Cómo conectar el túnel
            </h3>
            <button
              type="button"
              onClick={() => setHelpOpen(false)}
              className="rounded-md px-2 py-1 text-[var(--text-muted)] hover:bg-[var(--bg)]"
            >
              ✕
            </button>
          </div>
          <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-4 text-sm leading-relaxed">
            <section className="space-y-3">
              <h4 className="font-semibold text-[var(--accent)]">
                Concentrador ISP Control
              </h4>
              <p className="text-[var(--text-muted)]">
                El MikroTik es cliente OpenVPN o WireGuard hacia{' '}
                <code className="font-mono text-xs">VPN_PUBLIC_HOST</code>.
                Al crear el túnel, el contenedor concentrador sincroniza
                usuario/peer automáticamente.
              </p>
              <ol className="list-decimal space-y-2 pl-5">
                <li>
                  Crea el túnel con <strong>Añadir</strong> (protocolo, nombre,
                  redes LAN).
                </li>
                <li>
                  Espera ~30s o usa <strong>Importar</strong> /{' '}
                  <strong>Script</strong> en el MikroTik.
                </li>
                <li>
                  Verifica que el ovpn-client / wireguard quede connected hacia
                  el concentrador.
                </li>
              </ol>
            </section>

            <section className="space-y-3 border-t border-[var(--border)] pt-6">
              <h4 className="font-semibold text-[var(--accent)]">
                Modo automático (Importar)
              </h4>
              <p className="text-[var(--text-muted)]">
                Ideal si el MikroTik ya está en Topología y ISP Control puede
                hablar con él (API REST / Winbox).
              </p>
              <ol className="list-decimal space-y-2 pl-5">
                <li>
                  En la lista del túnel, pulsa <strong>Importar</strong>.
                </li>
                <li>
                  Elige el router MikroTik de destino y confirma. ISP Control
                  empuja la configuración VPN al equipo.
                </li>
              </ol>
            </section>
          </div>
          <div className="flex shrink-0 justify-end border-t border-[var(--border)] px-5 py-3">
            <button
              type="button"
              className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white"
              onClick={() => setHelpOpen(false)}
            >
              Entendido
            </button>
          </div>
        </div>
      </div></ModalPortal>
    )}
    </>
  )
}
