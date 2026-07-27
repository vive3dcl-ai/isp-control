import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'
import {
  DEFAULT_VPN_ROUTES,
  VPN_PROTOCOLS,
  vpnModeLabel,
  vpnProtocolLabel,
  type VpnMode,
  type VpnProtocol,
  type VpnSetupPayload,
  type VpnTunnel,
} from '../lib/vpn'
import type { TopologyDevice } from '../lib/topology'
import { useNotify } from './NotifyProvider'

const inputClass =
  'w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 outline-none ring-[var(--accent)] focus:ring-2'

type View = 'list' | 'create' | 'edit' | 'setup' | 'import'

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
  const [mode, setMode] = useState<VpnMode>('outbound')
  const [protocol, setProtocol] = useState<VpnProtocol>('openvpn_tcp')
  const [name, setName] = useState('')
  const [endpointHost, setEndpointHost] = useState('')
  const [tunnelSubnet, setTunnelSubnet] = useState('')
  const [tunnelRoutes, setTunnelRoutes] = useState(DEFAULT_VPN_ROUTES)
  const [password, setPassword] = useState('')
  const [importDeviceId, setImportDeviceId] = useState('')
  const [importResult, setImportResult] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [helpOpen, setHelpOpen] = useState(false)

  const tunnelsQuery = useQuery({
    queryKey: ['app', 'topology', 'vpn', 'tunnels'],
    queryFn: () =>
      apiFetch<{ tunnels: VpnTunnel[] }>('/app/topology/vpn/tunnels'),
    enabled: open,
  })

  const topologyQuery = useQuery({
    queryKey: ['app', 'topology'],
    queryFn: () =>
      apiFetch<{ devices: TopologyDevice[] }>('/app/topology'),
    enabled: open && (view === 'import' || view === 'list'),
  })

  const mikrotikRouters = useMemo(
    () =>
      (topologyQuery.data?.devices ?? []).filter(
        (d) =>
          d.type === 'router' &&
          d.subtype === 'mikrotik' &&
          d.isActive &&
          d.mgmtHost,
      ),
    [topologyQuery.data?.devices],
  )

  useEffect(() => {
    if (!open) {
      setView('list')
      setSelected(null)
      setSetup(null)
      setError(null)
      setImportResult(null)
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
          mode,
          protocol: mode === 'reverse' ? 'openvpn_tcp' : protocol,
          name: name.trim() || undefined,
          endpointHost:
            mode === 'reverse' ? endpointHost.trim() : undefined,
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
      setEndpointHost('')
      setTunnelSubnet('')
      setPassword('')
      setTunnelRoutes(DEFAULT_VPN_ROUTES)
      setMode('outbound')
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
          endpointHost:
            selected?.mode === 'reverse'
              ? endpointHost.trim() || undefined
              : undefined,
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
    mutationFn: (id: string) =>
      apiFetch<VpnSetupPayload>(`/app/topology/vpn/tunnels/${id}/setup`, {
        method: 'POST',
      }),
    onSuccess: (data) => {
      setSetup(data)
      setView('setup')
      setError(null)
    },
    onError: (e: Error) => setError(e.message),
  })

  const importMutation = useMutation({
    mutationFn: () =>
      apiFetch<{
        ok: boolean
        mode?: string
        note?: string
        addedRoutes?: string[]
        skippedRoutes?: string[]
        errors?: string[]
      }>(`/app/topology/vpn/tunnels/${selected!.id}/import`, {
        method: 'POST',
        body: JSON.stringify({ deviceId: importDeviceId }),
      }),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({
        queryKey: ['app', 'topology', 'vpn', 'tunnels'],
      })
      const added = data.addedRoutes?.length
        ? ` Añadidas: ${data.addedRoutes.join(', ')}.`
        : ''
      const skipped = data.skippedRoutes?.length
        ? ` Ya existían: ${data.skippedRoutes.length}.`
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
      setView('list')
    },
    onError: (e: Error) => setError(e.message),
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
    setEndpointHost(t.endpointHost ?? '')
    setTunnelSubnet(t.tunnelSubnet)
    setTunnelRoutes(t.tunnelRoutes || DEFAULT_VPN_ROUTES)
    setPassword('')
    setView('edit')
  }

  function resetCreateForm() {
    setMode('outbound')
    setProtocol('openvpn_tcp')
    setName('')
    setEndpointHost('')
    setTunnelSubnet('')
    setPassword('')
    setTunnelRoutes(DEFAULT_VPN_ROUTES)
    setView('create')
  }

  const isReverseSetup = setup?.mode === 'reverse' || setup?.tunnel.mode === 'reverse'

  return (
    <>
    <div className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-black/60 p-4 sm:items-center">
      <div
        role="dialog"
        aria-modal="true"
        className="flex max-h-[min(92vh,100dvh)] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] shadow-xl"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-[var(--border)] px-5 py-4">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold">
                {view === 'list' && 'VPN tunnels'}
                {view === 'create' && 'Add tunnel'}
                {view === 'edit' && 'Edit tunnel'}
                {view === 'setup' &&
                  (isReverseSetup
                    ? 'VPN inverso — setup'
                    : 'MikroTik VPN setup')}
                {view === 'import' && 'Import to MikroTik'}
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
                {setup.modeLabel ?? setup.protocolLabel} · {setup.tunnel.name}@
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

          {view === 'list' && (
            <div className="space-y-3">
              <p className="text-sm text-[var(--text-muted)]">
                Concentrador (MikroTik cliente) o inverso lab TR069 (MikroTik
                servidor / ACS local cliente). Routes por defecto = RFC1918.
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
                        {t.mode === 'reverse' ? (
                          <span className="rounded border border-[var(--accent)]/40 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--accent)]">
                            Inverso
                          </span>
                        ) : (
                          <span className="rounded border border-[var(--border)] px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
                            Concentrador
                          </span>
                        )}
                      </div>
                      <p className="truncate text-xs text-[var(--text-muted)]">
                        {t.protocolLabel ?? t.protocol} · {t.tunnelSubnet}
                        {t.mode === 'reverse' && t.endpointHost
                          ? ` · ${t.endpointHost}`
                          : ''}{' '}
                        · {t.status}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {canWrite && (
                        <>
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
                            onClick={() => setupMutation.mutate(t.id)}
                          >
                            Script
                          </button>
                          <button
                            type="button"
                            className="rounded-md border border-[var(--border)] px-2 py-1 text-xs hover:border-[var(--accent)]"
                            onClick={() => {
                              setSelected(t)
                              setImportDeviceId('')
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
                if (view === 'create' && mode === 'reverse' && !endpointHost.trim()) {
                  setError('Indica la IP/hostname público del MikroTik')
                  return
                }
                if (view === 'create') createMutation.mutate()
                else updateMutation.mutate()
              }}
            >
              {view === 'create' && (
                <>
                  <label className="block text-sm">
                    <span className="mb-1 block text-[var(--text-muted)]">
                      Modo
                    </span>
                    <select
                      className={inputClass}
                      value={mode}
                      onChange={(e) => {
                        const m = e.target.value as VpnMode
                        setMode(m)
                        if (m === 'reverse') setProtocol('openvpn_tcp')
                      }}
                    >
                      <option value="outbound">
                        {vpnModeLabel.outbound}
                      </option>
                      <option value="reverse">
                        {vpnModeLabel.reverse}
                      </option>
                    </select>
                  </label>
                  {mode === 'reverse' && (
                    <p className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-xs text-[var(--text-muted)]">
                      Lab TR069: el MikroTik (IP pública) es servidor OpenVPN
                      TCP; el ACS interno se conecta como cliente y recibe la
                      IP .2 del túnel.
                    </p>
                  )}
                  {mode === 'outbound' && (
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
                  {mode === 'reverse' && (
                    <label className="block text-sm">
                      <span className="mb-1 block text-[var(--text-muted)]">
                        Protocolo
                      </span>
                      <input
                        className={inputClass}
                        value="OpenVPN TCP"
                        disabled
                        readOnly
                      />
                    </label>
                  )}
                </>
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
              {(view === 'create' && mode === 'reverse') ||
              (view === 'edit' && selected?.mode === 'reverse') ? (
                <label className="block text-sm">
                  <span className="mb-1 block text-[var(--text-muted)]">
                    IP / hostname público del MikroTik *
                  </span>
                  <input
                    className={inputClass}
                    value={endpointHost}
                    onChange={(e) => setEndpointHost(e.target.value)}
                    placeholder="vpn.tuisp.com o 45.x.x.x"
                    required={view === 'create'}
                  />
                </label>
              ) : null}
              <label className="block text-sm">
                <span className="mb-1 block text-[var(--text-muted)]">
                  Tunnel subnet
                </span>
                <input
                  className={inputClass}
                  value={tunnelSubnet}
                  onChange={(e) => setTunnelSubnet(e.target.value)}
                  placeholder="Auto 10.69.x.0/24"
                />
              </label>
              {((view === 'create' &&
                (mode === 'reverse' || protocol !== 'wireguard')) ||
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

          {view === 'setup' && setup && (
            <div className="space-y-4">
              <p className="text-sm text-[var(--text-muted)]">
                {isReverseSetup
                  ? 'Aplica el script servidor en el MikroTik; luego conecta el ACS con el .ovpn (remote = IP pública del MikroTik).'
                  : setup.concentratorPeerConfig
                    ? 'Primero el peer en el concentrador WireGuard; luego bootstrap/script en el MikroTik.'
                    : setup.concentratorOpenVpnConfig
                      ? 'Primero el usuario/CCD en el concentrador OpenVPN; luego bootstrap/script en el MikroTik.'
                      : 'Copia y pega en el terminal RouterOS. Mantén esta ventana abierta hasta terminar.'}
              </p>
              {setup.concentratorOpenVpnConfig && (
                <div>
                  <p className="mb-1 text-xs font-medium text-[var(--text-muted)]">
                    Usuario concentrador OpenVPN (CCD)
                  </p>
                  <pre className="max-h-40 overflow-auto rounded-lg border border-[var(--border)] bg-[var(--bg)] p-3 text-xs whitespace-pre-wrap">
                    {setup.concentratorOpenVpnConfig}
                  </pre>
                  <button
                    type="button"
                    className="mt-2 rounded-lg border border-[var(--border)] px-3 py-2 text-sm hover:border-[var(--accent)]"
                    onClick={() =>
                      copyText(setup.concentratorOpenVpnConfig!, 'ovpn-ccd')
                    }
                  >
                    {copied === 'ovpn-ccd' ? 'Copiado' : 'Copiar CCD / user'}
                  </button>
                </div>
              )}
              {setup.concentratorOpenVpnMikrotik && (
                <div>
                  <p className="mb-1 text-xs font-medium text-[var(--text-muted)]">
                    Si el concentrador es MikroTik (ppp secret)
                  </p>
                  <pre className="max-h-32 overflow-auto rounded-lg border border-[var(--border)] bg-[var(--bg)] p-3 text-xs whitespace-pre-wrap">
                    {setup.concentratorOpenVpnMikrotik}
                  </pre>
                  <button
                    type="button"
                    className="mt-2 rounded-lg border border-[var(--border)] px-3 py-2 text-sm hover:border-[var(--accent)]"
                    onClick={() =>
                      copyText(
                        setup.concentratorOpenVpnMikrotik!,
                        'ovpn-mt',
                      )
                    }
                  >
                    {copied === 'ovpn-mt' ? 'Copiado' : 'Copiar comandos'}
                  </button>
                </div>
              )}
              {setup.concentratorPeerConfig && (
                <div>
                  <p className="mb-1 text-xs font-medium text-[var(--text-muted)]">
                    Peer concentrador WireGuard ([Peer])
                  </p>
                  <pre className="max-h-40 overflow-auto rounded-lg border border-[var(--border)] bg-[var(--bg)] p-3 text-xs whitespace-pre-wrap">
                    {setup.concentratorPeerConfig}
                  </pre>
                  <button
                    type="button"
                    className="mt-2 rounded-lg border border-[var(--border)] px-3 py-2 text-sm hover:border-[var(--accent)]"
                    onClick={() =>
                      copyText(setup.concentratorPeerConfig!, 'wg-peer')
                    }
                  >
                    {copied === 'wg-peer' ? 'Copiado' : 'Copiar [Peer]'}
                  </button>
                </div>
              )}
              {setup.concentratorApplyCommands && (
                <div>
                  <p className="mb-1 text-xs font-medium text-[var(--text-muted)]">
                    Comandos en vivo (wg0 en el concentrador)
                  </p>
                  <pre className="max-h-32 overflow-auto rounded-lg border border-[var(--border)] bg-[var(--bg)] p-3 text-xs whitespace-pre-wrap">
                    {setup.concentratorApplyCommands}
                  </pre>
                  <button
                    type="button"
                    className="mt-2 rounded-lg border border-[var(--border)] px-3 py-2 text-sm hover:border-[var(--accent)]"
                    onClick={() =>
                      copyText(setup.concentratorApplyCommands!, 'wg-apply')
                    }
                  >
                    {copied === 'wg-apply' ? 'Copiado' : 'Copiar comandos'}
                  </button>
                </div>
              )}
              {setup.acsUrlHint && (
                <p className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-xs">
                  ACS URL sugerida (TR069):{' '}
                  <code className="font-mono">{setup.acsUrlHint}</code>
                </p>
              )}
              {setup.bootstrap && !isReverseSetup && (
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
                  {isReverseSetup
                    ? 'Script MikroTik (servidor OpenVPN)'
                    : 'Script completo (manual)'}
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
              {isReverseSetup && setup.acsClientConfig && (
                <div>
                  <p className="mb-1 text-xs font-medium text-[var(--text-muted)]">
                    Config cliente ACS (.ovpn)
                  </p>
                  <pre className="max-h-56 overflow-auto rounded-lg border border-[var(--border)] bg-[var(--bg)] p-3 text-xs whitespace-pre-wrap">
                    {setup.acsClientConfig}
                  </pre>
                  <button
                    type="button"
                    className="mt-2 rounded-lg border border-[var(--border)] px-3 py-2 text-sm hover:border-[var(--accent)]"
                    onClick={() =>
                      copyText(setup.acsClientConfig!, 'acs')
                    }
                  >
                    {copied === 'acs' ? 'Copiado' : 'Copiar .ovpn'}
                  </button>
                </div>
              )}
              <p className="text-xs text-[var(--text-muted)]">{setup.note}</p>
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
                {selected.mode === 'reverse' ? (
                  <>
                    Aplica el <strong>servidor</strong> OpenVPN del túnel{' '}
                    <strong>{selected.name}</strong> al MikroTik (API). El ACS
                    se conecta aparte con el .ovpn.
                  </>
                ) : (
                  <>
                    Si el túnel <strong>ya existe</strong> en el router, solo se
                    añaden rutas/reglas <strong>faltantes</strong> (redes nuevas
                    que hayas editado). Si no existe, se aplica el script
                    completo.
                  </>
                )}
              </p>
              <label className="block text-sm">
                <span className="mb-1 block text-[var(--text-muted)]">
                  Router MikroTik
                </span>
                <select
                  className={inputClass}
                  value={importDeviceId}
                  onChange={(e) => setImportDeviceId(e.target.value)}
                  required
                >
                  <option value="">Seleccionar…</option>
                  {mikrotikRouters.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                      {d.mgmtHost ? ` · ${d.mgmtHost}` : ''}
                    </option>
                  ))}
                </select>
              </label>
              {mikrotikRouters.length === 0 && (
                <p className="text-xs text-[var(--text-muted)]">
                  No hay routers MikroTik con host de gestión. Configura uno en
                  Topología primero.
                </p>
              )}
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm"
                  onClick={() => setView('list')}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={!importDeviceId || importMutation.isPending}
                  className="rounded-lg bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                  onClick={() => importMutation.mutate()}
                >
                  {importMutation.isPending
                    ? 'Importando…'
                    : 'Importar al router'}
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
    </div>

    {helpOpen && (
      <div className="fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto bg-black/60 p-4 sm:items-center">
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="vpn-help-title"
          className="flex max-h-[min(92vh,100dvh)] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] shadow-xl"
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
                Modo concentrador (MikroTik cliente)
              </h4>
              <p className="text-[var(--text-muted)]">
                El MikroTik se conecta al concentrador de plataforma. Usa
                Importar o Script como hasta ahora.
              </p>
            </section>

            <section className="space-y-3 border-t border-[var(--border)] pt-6">
              <h4 className="font-semibold text-[var(--accent)]">
                Modo inverso lab TR069
              </h4>
              <p className="text-[var(--text-muted)]">
                MikroTik con IP pública = servidor OpenVPN TCP. Tu ACS local =
                cliente. Ideal cuando el servidor ISP Control está detrás de
                NAT.
              </p>
              <ol className="list-decimal space-y-2 pl-5">
                <li>
                  Añadir túnel → modo <strong>Inverso lab TR069</strong> → IP
                  pública del MikroTik.
                </li>
                <li>
                  <strong>Importar</strong> o pegar el script servidor en el
                  MikroTik.
                </li>
                <li>
                  Exportar el CA del MikroTik y pegarlo en el .ovpn del ACS.
                </li>
                <li>
                  Conectar el OpenVPN en la máquina del ACS; TR069 usará
                  http://10.69.x.2:14501 por defecto.
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
                  Crea el túnel con <strong>Añadir</strong> (elige protocolo,
                  nombre y contraseña).
                </li>
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
      </div>
    )}
    </>
  )
}
