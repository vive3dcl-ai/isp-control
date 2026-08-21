import { useEffect, useMemo, useRef, useState } from 'react'
import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { apiFetch } from '../lib/api'
import type { TopologyDevice } from '../lib/topology'
import {
  createTvCategory,
  createTvChannel,
  createTvEpgProvider,
  createTvServer,
  checkTvServerUpdate,
  deleteTvChannel,
  deleteTvEpgProvider,
  deleteTvServer,
  formatBytes,
  getTvServerHost,
  installTvServerStep,
  listTvCategories,
  listTvChannels,
  listTvEpgChannels,
  listTvEpgProviders,
  listTvServers,
  nextTvOutput,
  patchTvChannel,
  refreshTvEpgProvider,
  startTvChannel,
  stopTvChannel,
  tvLogoUrl,
  updateTvServer,
  uploadTvChannelLogo,
  type TvChannel,
  type TvServer,
} from '../lib/tv-servers'
import { ModalPortal } from './ModalPortal'
import {
  DesktopTableWrap,
  MobileList,
  MobileListCard,
  MobileListMeta,
} from './MobileList'
import {
  OperationProgressModal,
  runProgressSteps,
  type ProgressStep,
} from './OperationProgressModal'

const INSTALL_STEPS: ProgressStep[] = [
  { id: 'ssh', label: 'Validar SSH', status: 'pending' },
  { id: 'detect', label: 'Detectar ffmpeg existente (sin instalar) / OS', status: 'pending' },
  { id: 'upload', label: 'Subir agente isp-tv-agent', status: 'pending' },
  { id: 'install', label: 'Instalar servicio y capturar token API', status: 'pending' },
  { id: 'health', label: 'Healthcheck API del agente', status: 'pending' },
]

const UPDATE_STEPS: ProgressStep[] = [
  ...INSTALL_STEPS,
  {
    id: 'rewrite',
    label: 'Reescribir units (failover / fuentes de respaldo)',
    status: 'pending',
  },
  {
    id: 'verify',
    label: 'Verificar canales UP y fuentes',
    status: 'pending',
  },
]

function statusBadge(status: TvServer['status']) {
  const map: Record<TvServer['status'], string> = {
    online: 'bg-emerald-600/20 text-emerald-400',
    pending: 'bg-amber-500/15 text-amber-200',
    installing: 'bg-sky-500/15 text-sky-200',
    error: 'bg-red-600/20 text-red-300',
    offline: 'bg-[var(--border)] text-[var(--text-muted)]',
  }
  return map[status] ?? map.offline
}

function channelStateLabel(state: string) {
  if (state === 'running') return 'En vivo'
  if (state === 'error') return 'Error'
  if (state === 'starting') return 'Arrancando'
  return 'Detenido'
}

/** Hold brief DOWN flaps while unit still running (agent progress mtime gaps). */
const LINK_HOLD_MS = 45_000

function linkBadge(
  st: {
    state: string
    link?: string
    verified?: boolean
    bitrateKbps?: number
  },
  opts?: { heldUp?: boolean },
) {
  const raw = st.link ?? (st.state === 'running' ? 'up' : 'down')
  const up = raw === 'up' || !!opts?.heldUp
  return (
    <span
      className={[
        'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium',
        up
          ? 'bg-emerald-600/20 text-emerald-400'
          : 'bg-red-600/20 text-red-300',
      ].join(' ')}
      title={
        up
          ? st.verified
            ? 'Stream verificado (ffmpeg progresando)'
            : opts?.heldUp && raw !== 'up'
              ? 'Unit activa (hold ante flap de progreso)'
              : 'Unit activa'
          : st.state === 'running'
            ? 'Unit activa pero sin progreso reciente (stall)'
            : 'Canal abajo'
      }
    >
      <span
        className={[
          'inline-block h-1.5 w-1.5 rounded-full',
          up ? 'bg-emerald-400' : 'bg-red-400',
        ].join(' ')}
      />
      {up ? 'UP' : 'DOWN'}
    </span>
  )
}

function formatBitrate(kbps?: number) {
  if (kbps == null || !(kbps > 0)) return '—'
  if (kbps >= 1000) return `${(kbps / 1000).toFixed(2)} Mbps`
  return `${kbps.toFixed(0)} kbps`
}

export function TvServersPanel({ canWrite }: { canWrite: boolean }) {
  const qc = useQueryClient()
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  const [formName, setFormName] = useState('')
  const [formDeviceId, setFormDeviceId] = useState('')
  const [formHost, setFormHost] = useState('')
  const [formPort, setFormPort] = useState('22')
  const [formUser, setFormUser] = useState('root')
  const [formPass, setFormPass] = useState('')
  const [formListen, setFormListen] = useState(':8099')
  const [formMcastCidr, setFormMcastCidr] = useState('239.1.1.0/24')
  const [formMcastPort, setFormMcastPort] = useState('5000')

  const [progressOpen, setProgressOpen] = useState(false)
  const [progressTitle, setProgressTitle] = useState('Instalando servidor TV')
  const [progressSteps, setProgressSteps] = useState<ProgressStep[]>([])
  const [progressRunning, setProgressRunning] = useState(false)
  const [installServerId, setInstallServerId] = useState<string | null>(null)
  const [updateConfirm, setUpdateConfirm] = useState<{
    serverId: string
    name: string
    from: string
    to: string
  } | null>(null)

  const [channelModal, setChannelModal] = useState<{
    serverId: string
    channel?: TvChannel
  } | null>(null)
  const [epgModal, setEpgModal] = useState<string | null>(null)
  const [editServer, setEditServer] = useState<TvServer | null>(null)

  const serversQ = useQuery({
    queryKey: ['app', 'tv', 'servers'],
    queryFn: listTvServers,
  })

  const topologyQ = useQuery({
    queryKey: ['app', 'topology'],
    queryFn: () =>
      apiFetch<{ devices: TopologyDevice[] }>('/app/topology'),
  })

  const servers = serversQ.data?.servers ?? []
  const usedDeviceIds = useMemo(
    () => new Set(servers.map((s) => s.deviceId)),
    [servers],
  )
  const serverDevices = useMemo(
    () =>
      (topologyQ.data?.devices ?? []).filter(
        (d) => d.type === 'server' && d.isActive && !usedDeviceIds.has(d.id),
      ),
    [topologyQ.data?.devices, usedDeviceIds],
  )

  function onPickDevice(id: string) {
    setFormDeviceId(id)
    const d = topologyQ.data?.devices.find((x) => x.id === id)
    if (d) {
      if (!formName) setFormName(d.name)
      if (d.mgmtHost) setFormHost(d.mgmtHost)
      if (d.mgmtPort) setFormPort(String(d.mgmtPort))
      if (d.mgmtUsername) setFormUser(d.mgmtUsername)
    }
  }

  async function runInstall(
    serverId: string,
    steps: ProgressStep[],
    opts?: { title?: string; successMsg?: string },
  ) {
    setInstallServerId(serverId)
    setProgressTitle(opts?.title ?? 'Instalando servidor TV')
    setProgressSteps(steps)
    setProgressOpen(true)
    setProgressRunning(true)
    const runners: Record<string, () => Promise<string | void>> = {
      ssh: async () => {
        const r = await installTvServerStep(serverId, 'ssh')
        return r.detail
      },
      detect: async () => {
        const r = await installTvServerStep(serverId, 'detect')
        return r.detail
      },
      upload: async () => {
        const r = await installTvServerStep(serverId, 'upload')
        return r.detail
      },
      install: async () => {
        const r = await installTvServerStep(serverId, 'install')
        return r.detail
      },
      health: async () => {
        const r = await installTvServerStep(serverId, 'health')
        return r.detail
      },
      rewrite: async () => {
        const r = await installTvServerStep(serverId, 'rewrite')
        return r.detail
      },
      verify: async () => {
        const r = await installTvServerStep(serverId, 'verify')
        return r.detail
      },
    }
    const result = await runProgressSteps(steps, setProgressSteps, runners)
    setProgressRunning(false)
    void qc.invalidateQueries({ queryKey: ['app', 'tv', 'servers'] })
    void qc.invalidateQueries({
      queryKey: ['app', 'tv', 'servers', serverId],
    })
    if (result.ok) {
      setMsg(opts?.successMsg ?? 'Servidor TV instalado y online')
      setCreating(false)
    }
  }

  const createMut = useMutation({
    mutationFn: async () => {
      if (!formDeviceId) throw new Error('Selecciona un activo servidor')
      if (!formHost.trim() || !formUser.trim() || !formPass) {
        throw new Error('SSH host, usuario y contraseña son obligatorios')
      }
      return createTvServer({
        deviceId: formDeviceId,
        name: formName.trim() || 'Servidor TV',
        sshHost: formHost.trim(),
        sshPort: Number(formPort) || 22,
        sshUsername: formUser.trim(),
        sshPassword: formPass,
        apiListen: formListen.trim() || ':8099',
        multicastCidr: formMcastCidr.trim() || undefined,
        multicastPort: Number(formMcastPort) || 5000,
      })
    },
    onSuccess: async (row) => {
      setError(null)
      setFormPass('')
      await runInstall(row.id, INSTALL_STEPS.map((s) => ({ ...s })))
    },
    onError: (e: Error) => setError(e.message),
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteTvServer(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['app', 'tv', 'servers'] })
      setMsg('Servidor TV eliminado')
    },
    onError: (e: Error) => setError(e.message),
  })

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-[var(--text-muted)]">
          Agente Go en el servidor: canales (fuente → salida multicast), EPG
          XMLTV y métricas. Install por SSH; operación diaria por API.
        </p>
        {canWrite && (
          <button
            type="button"
            className="rounded-lg bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white"
            onClick={() => {
              setCreating(true)
              setError(null)
            }}
          >
            Nuevo servidor
          </button>
        )}
      </div>

      {msg && (
        <p className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm">
          {msg}
        </p>
      )}
      {error && <p className="text-sm text-red-500">{error}</p>}
      {serversQ.isLoading && (
        <p className="text-sm text-[var(--text-muted)]">Cargando…</p>
      )}
      {!serversQ.isLoading && servers.length === 0 && (
        <div className="rounded-lg border border-dashed border-[var(--border)] px-4 py-8 text-center text-sm text-[var(--text-muted)]">
          No hay servidores TV. Crea un activo tipo Servidor en Topología y
          luego añádelo aquí.
        </div>
      )}

      {servers.length > 0 && (
        <ul className="divide-y divide-[var(--border)] rounded-lg border border-[var(--border)]">
          {servers.map((s) => (
            <ServerRow
              key={s.id}
              server={s}
              open={!!expanded[s.id]}
              canWrite={canWrite}
              onToggle={() =>
                setExpanded((p) => ({ ...p, [s.id]: !p[s.id] }))
              }
              onDelete={() => {
                if (confirm(`¿Eliminar servidor TV “${s.name}”?`)) {
                  deleteMut.mutate(s.id)
                }
              }}
              onReinstall={() =>
                void runInstall(
                  s.id,
                  INSTALL_STEPS.map((x) => ({ ...x })),
                  { title: 'Reinstalando servidor TV' },
                )
              }
              onUpdate={(info) => setUpdateConfirm(info)}
              onEdit={() => setEditServer(s)}
              onAddChannel={() => setChannelModal({ serverId: s.id })}
              onEditChannel={(ch) =>
                setChannelModal({ serverId: s.id, channel: ch })
              }
              onAddEpg={() => setEpgModal(s.id)}
            />
          ))}
        </ul>
      )}

      {creating && (
        <ModalPortal>
          <div className="fixed inset-0 z-50 flex items-center justify-center modal-backdrop bg-black/50 p-4">
            <div className="w-full max-w-lg space-y-3 rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4 shadow-xl">
              <h3 className="text-lg font-semibold">Nuevo servidor TV</h3>
              <label className="block text-sm">
                Activo topología (Servidor)
                <select
                  className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2"
                  value={formDeviceId}
                  onChange={(e) => onPickDevice(e.target.value)}
                >
                  <option value="">— seleccionar —</option>
                  {serverDevices.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                      {d.mgmtHost ? ` (${d.mgmtHost})` : ''}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                Nombre
                <input
                  className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                />
              </label>
              <div className="grid grid-cols-3 gap-2">
                <label className="col-span-2 block text-sm">
                  SSH host / IP
                  <input
                    className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2"
                    value={formHost}
                    onChange={(e) => setFormHost(e.target.value)}
                  />
                </label>
                <label className="block text-sm">
                  Puerto
                  <input
                    className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2"
                    value={formPort}
                    onChange={(e) => setFormPort(e.target.value)}
                  />
                </label>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="block text-sm">
                  Usuario
                  <input
                    className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2"
                    value={formUser}
                    onChange={(e) => setFormUser(e.target.value)}
                  />
                </label>
                <label className="block text-sm">
                  Contraseña
                  <input
                    type="password"
                    className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2"
                    value={formPass}
                    onChange={(e) => setFormPass(e.target.value)}
                  />
                </label>
              </div>
              <label className="block text-sm">
                Listen agente
                <input
                  className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2"
                  value={formListen}
                  onChange={(e) => setFormListen(e.target.value)}
                  placeholder=":8099"
                />
              </label>
              <div className="grid grid-cols-3 gap-2">
                <label className="col-span-2 block text-sm">
                  Segmento multicast (canales)
                  <input
                    className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 font-mono text-xs"
                    value={formMcastCidr}
                    onChange={(e) => setFormMcastCidr(e.target.value)}
                    placeholder="239.1.1.0/24"
                  />
                </label>
                <label className="block text-sm">
                  Puerto
                  <input
                    className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2"
                    value={formMcastPort}
                    onChange={(e) => setFormMcastPort(e.target.value)}
                  />
                </label>
              </div>
              <p className="text-xs text-[var(--text-muted)]">
                Cada canal toma la siguiente IP del segmento (mismo puerto). Se
                puede editar después.
              </p>
              {error && <p className="text-sm text-red-500">{error}</p>}
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm"
                  onClick={() => setCreating(false)}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={createMut.isPending}
                  className="rounded-lg bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                  onClick={() => createMut.mutate()}
                >
                  Crear e instalar
                </button>
              </div>
            </div>
          </div>
        </ModalPortal>
      )}

      {channelModal && (
        <ChannelModal
          serverId={channelModal.serverId}
          channel={channelModal.channel}
          canWrite={canWrite}
          onClose={() => setChannelModal(null)}
          onDone={() => {
            const sid = channelModal.serverId
            setChannelModal(null)
            void qc.invalidateQueries({
              queryKey: ['app', 'tv', 'servers', sid],
            })
          }}
        />
      )}

      {epgModal && (
        <EpgModal
          serverId={epgModal}
          canWrite={canWrite}
          onClose={() => setEpgModal(null)}
        />
      )}

      {editServer && (
        <EditServerModal
          server={editServer}
          onClose={() => setEditServer(null)}
          onSaved={() => {
            setEditServer(null)
            void qc.invalidateQueries({ queryKey: ['app', 'tv', 'servers'] })
            setMsg('Servidor TV actualizado')
          }}
        />
      )}

      {updateConfirm && (
        <ModalPortal>
          <div className="fixed inset-0 z-[110] flex items-center justify-center modal-backdrop bg-black/50 p-4">
            <div className="w-full max-w-md space-y-3 rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4 shadow-xl">
              <h3 className="text-lg font-semibold">Actualizar agente TV</h3>
              <p className="text-sm text-[var(--text-muted)]">
                Se actualizará <span className="font-medium text-[var(--text)]">{updateConfirm.name}</span>{' '}
                de <span className="font-mono">v{updateConfirm.from}</span> a{' '}
                <span className="font-mono">v{updateConfirm.to}</span>. Luego se
                reescriben las units con failover y se verifica que los canales
                queden UP con sus fuentes.
              </p>
              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm"
                  onClick={() => setUpdateConfirm(null)}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  className="rounded-lg bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white"
                  onClick={() => {
                    const info = updateConfirm
                    setUpdateConfirm(null)
                    void runInstall(
                      info.serverId,
                      UPDATE_STEPS.map((x) => ({ ...x })),
                      {
                        title: `Actualizando agente TV → v${info.to}`,
                        successMsg: `Agente actualizado a v${info.to} y canales verificados`,
                      },
                    )
                  }}
                >
                  Actualizar
                </button>
              </div>
            </div>
          </div>
        </ModalPortal>
      )}

      <OperationProgressModal
        open={progressOpen}
        title={progressTitle}
        steps={progressSteps}
        running={progressRunning}
        failed={progressSteps.some((s) => s.status === 'error')}
        allDone={
          !progressRunning &&
          progressSteps.length > 0 &&
          progressSteps.every((s) => s.status === 'done')
        }
        onRetry={() => {
          if (!installServerId) return
          void runInstall(installServerId, progressSteps, {
            title: progressTitle,
          })
        }}
        onClose={() => {
          if (!progressRunning) setProgressOpen(false)
        }}
      />
    </div>
  )
}

function ServerRow({
  server,
  open,
  canWrite,
  onToggle,
  onDelete,
  onReinstall,
  onUpdate,
  onEdit,
  onAddChannel,
  onEditChannel,
  onAddEpg,
}: {
  server: TvServer
  open: boolean
  canWrite: boolean
  onToggle: () => void
  onDelete: () => void
  onReinstall: () => void
  onUpdate: (info: {
    serverId: string
    name: string
    from: string
    to: string
  }) => void
  onEdit: () => void
  onAddChannel: () => void
  onEditChannel: (ch: TvChannel) => void
  onAddEpg: () => void
}) {
  const lastLinkUpAt = useRef(new Map<string, number>())

  const hostQ = useQuery({
    queryKey: ['app', 'tv', 'servers', server.id, 'host'],
    queryFn: () => getTvServerHost(server.id),
    enabled: open && server.hasApiToken,
    refetchInterval: open ? 5_000 : false,
    retry: false,
  })

  const channelsQ = useQuery({
    queryKey: ['app', 'tv', 'servers', server.id, 'channels'],
    queryFn: () => listTvChannels(server.id),
    enabled: open && server.status === 'online',
    refetchInterval: open ? 3_000 : false,
  })

  const epgQ = useQuery({
    queryKey: ['app', 'tv', 'servers', server.id, 'epg'],
    queryFn: () => listTvEpgProviders(server.id),
    enabled: open && server.status === 'online',
  })

  const updateQ = useQuery({
    queryKey: ['app', 'tv', 'servers', server.id, 'update-check'],
    queryFn: () => checkTvServerUpdate(server.id),
    refetchInterval: 60_000,
    retry: false,
  })

  const host = hostQ.data?.host
  const channels = channelsQ.data?.channels ?? []
  const providers = epgQ.data?.providers ?? []
  const totalKbps = channels.reduce(
    (sum, row) => sum + (row.status.bitrateKbps ?? 0),
    0,
  )
  const updateAvailable = !!updateQ.data?.updateAvailable
  const availableVersion = updateQ.data?.availableVersion
  const installedVersion =
    updateQ.data?.installedVersion ?? server.agentVersion

  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <button
          type="button"
          className="min-w-0 flex-1 text-left"
          onClick={onToggle}
          aria-expanded={open}
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[var(--text-muted)]">
              {open ? '▾' : '▸'}
            </span>
            <span className="font-medium">{server.name}</span>
            <span
              className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${statusBadge(server.status)}`}
            >
              {server.status}
            </span>
            {installedVersion && (
              <span className="text-xs text-[var(--text-muted)]">
                v{installedVersion}
                {updateAvailable && availableVersion
                  ? ` → v${availableVersion}`
                  : ''}
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-[var(--text-muted)]">
            {server.sshHost}:{server.sshPort}
            {server.apiBaseUrl ? ` · API ${server.apiBaseUrl}` : ''}
            {server.multicastCidr
              ? ` · mcast ${server.multicastCidr} :${server.multicastPort}`
              : ' · mcast sin definir'}
          </p>
          {host && (
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              CPU {host.cpuPercent.toFixed(0)}% · RAM{' '}
              {host.ramPercent.toFixed(0)}% (
              {formatBytes(host.ramUsedBytes)}/{formatBytes(host.ramTotalBytes)}
              )
              {host.gpu
                ? ` · GPU ${host.gpu.name} ${host.gpu.utilPercent.toFixed(0)}%`
                : ''}
              {channels.length > 0
                ? ` · TV ${formatBitrate(totalKbps)}`
                : ''}
            </p>
          )}
        </button>
        {canWrite && (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded border border-[var(--border)] px-2 py-1 text-xs"
              onClick={onEdit}
            >
              Editar
            </button>
            <button
              type="button"
              disabled={!updateAvailable || updateQ.isFetching}
              title={
                updateAvailable
                  ? `Actualizar agente a v${availableVersion}`
                  : availableVersion
                    ? `Al día (v${installedVersion ?? '?'} = v${availableVersion})`
                    : 'Comprobando versión…'
              }
              className="rounded border border-[var(--border)] px-2 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-40"
              onClick={() => {
                if (!updateAvailable || !availableVersion) return
                onUpdate({
                  serverId: server.id,
                  name: server.name,
                  from: installedVersion ?? '?',
                  to: availableVersion,
                })
              }}
            >
              Actualizar
            </button>
            {server.status !== 'online' && (
              <button
                type="button"
                className="rounded border border-[var(--border)] px-2 py-1 text-xs"
                onClick={onReinstall}
              >
                Reinstalar
              </button>
            )}
            <button
              type="button"
              className="rounded border border-red-500/40 px-2 py-1 text-xs text-red-400"
              onClick={onDelete}
            >
              Eliminar
            </button>
          </div>
        )}
      </div>

      {open && (
        <div className="mt-3 space-y-4 border-t border-[var(--border)] pt-3">
          {server.lastError && (
            <p className="text-sm text-red-400">{server.lastError}</p>
          )}
          {server.status !== 'online' && (
            <p className="text-sm text-[var(--text-muted)]">
              Servidor no online — reinstala o revisa conectividad al agente.
            </p>
          )}

          {server.status === 'online' && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="text-sm font-medium">Canales</h4>
                {canWrite && (
                  <button
                    type="button"
                    className="rounded-lg bg-[var(--accent)] px-2.5 py-1.5 text-xs font-medium text-white"
                    onClick={onAddChannel}
                  >
                    Añadir canal
                  </button>
                )}
              </div>
              {channelsQ.isLoading && (
                <p className="text-xs text-[var(--text-muted)]">
                  Cargando canales…
                </p>
              )}
              {channels.length === 0 && !channelsQ.isLoading && (
                <p className="text-xs text-[var(--text-muted)]">
                  Sin canales todavía.
                </p>
              )}
              {channels.length > 0 && (
                <>
                  <MobileList>
                    {channels.map(({ channel: ch, status: st }) => {
                      const rawLink =
                        st.link ?? (st.state === 'running' ? 'up' : 'down')
                      if (rawLink === 'up') {
                        lastLinkUpAt.current.set(ch.id, Date.now())
                      }
                      const heldUp =
                        rawLink !== 'up' &&
                        (st.state === 'running' || st.state === 'starting') &&
                        Date.now() - (lastLinkUpAt.current.get(ch.id) ?? 0) <
                          LINK_HOLD_MS
                      return (
                        <MobileListCard key={ch.id}>
                          <div className="flex items-start gap-2">
                            {ch.logoUrl ? (
                              <img
                                src={tvLogoUrl(server.id, ch.id)}
                                alt=""
                                className="h-8 w-8 shrink-0 rounded object-cover"
                              />
                            ) : (
                              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-[var(--bg)] text-[10px] text-[var(--text-muted)]">
                                TV
                              </span>
                            )}
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-semibold">
                                {ch.name}
                              </p>
                              <p className="text-[10px] text-[var(--text-muted)]">
                                {channelStateLabel(st.state)}
                              </p>
                            </div>
                            {linkBadge(st, { heldUp })}
                          </div>
                          <MobileListMeta>
                            <span className="truncate" title={ch.source}>
                              {ch.source}
                            </span>
                            {(ch.sources?.length ?? 0) > 1 && (
                              <span>
                                +{(ch.sources!.length - 1)} respaldo
                                {ch.sources!.length > 2 ? 's' : ''}
                              </span>
                            )}
                            <span>·</span>
                            <span className="font-mono truncate" title={ch.output}>
                              {ch.output}
                            </span>
                            <span>·</span>
                            <span className="font-mono">
                              {formatBitrate(st.bitrateKbps)}
                            </span>
                            <span>·</span>
                            <span>
                              {st.packetLossPercent != null
                                ? `${st.packetLossPercent.toFixed(2)}%`
                                : st.dropFrames != null
                                  ? `${st.dropFrames} drops`
                                  : '—'}
                            </span>
                            <span>·</span>
                            <span>Reconn. {st.reconnects ?? 0}</span>
                          </MobileListMeta>
                          {canWrite && (
                            <div className="mt-2 flex flex-wrap gap-1">
                              <button
                                type="button"
                                className="rounded border border-[var(--border)] px-1.5 py-0.5"
                                onClick={() => onEditChannel(ch)}
                              >
                                Editar
                              </button>
                              {st.state === 'running' ? (
                                <button
                                  type="button"
                                  className="rounded border border-[var(--border)] px-1.5 py-0.5"
                                  onClick={() =>
                                    void stopTvChannel(server.id, ch.id).then(
                                      () => channelsQ.refetch(),
                                    )
                                  }
                                >
                                  Stop
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  className="rounded border border-[var(--border)] px-1.5 py-0.5"
                                  onClick={() =>
                                    void startTvChannel(server.id, ch.id).then(
                                      () => channelsQ.refetch(),
                                    )
                                  }
                                >
                                  Start
                                </button>
                              )}
                              <button
                                type="button"
                                className="rounded border border-red-500/40 px-1.5 py-0.5 text-red-400"
                                onClick={() => {
                                  if (!confirm(`¿Eliminar canal ${ch.name}?`))
                                    return
                                  void deleteTvChannel(server.id, ch.id).then(
                                    () => channelsQ.refetch(),
                                  )
                                }}
                              >
                                ×
                              </button>
                            </div>
                          )}
                        </MobileListCard>
                      )
                    })}
                  </MobileList>

                  <DesktopTableWrap bordered={false}>
                    <table className="w-full min-w-[640px] text-left text-xs">
                      <thead className="text-[var(--text-muted)]">
                        <tr>
                          <th className="py-1 pr-2">Canal</th>
                          <th className="py-1 pr-2">Fuente</th>
                          <th className="py-1 pr-2">Salida</th>
                          <th className="py-1 pr-2">Link</th>
                          <th className="py-1 pr-2">Velocidad</th>
                          <th className="py-1 pr-2">Pérdida</th>
                          <th className="py-1 pr-2">Reconn.</th>
                          <th className="py-1"> </th>
                        </tr>
                      </thead>
                      <tbody>
                        {channels.map(({ channel: ch, status: st }) => {
                          const rawLink =
                            st.link ?? (st.state === 'running' ? 'up' : 'down')
                          if (rawLink === 'up') {
                            lastLinkUpAt.current.set(ch.id, Date.now())
                          }
                          const heldUp =
                            rawLink !== 'up' &&
                            (st.state === 'running' || st.state === 'starting') &&
                            Date.now() -
                              (lastLinkUpAt.current.get(ch.id) ?? 0) <
                              LINK_HOLD_MS
                          return (
                            <tr
                              key={ch.id}
                              className="border-t border-[var(--border)]"
                            >
                              <td className="py-2 pr-2">
                                <div className="flex items-center gap-2">
                                  {ch.logoUrl ? (
                                    <img
                                      src={tvLogoUrl(server.id, ch.id)}
                                      alt=""
                                      className="h-7 w-7 rounded object-cover"
                                    />
                                  ) : (
                                    <span className="flex h-7 w-7 items-center justify-center rounded bg-[var(--bg)] text-[10px] text-[var(--text-muted)]">
                                      TV
                                    </span>
                                  )}
                                  <div>
                                    <span className="font-medium">{ch.name}</span>
                                    <div className="text-[10px] text-[var(--text-muted)]">
                                      {channelStateLabel(st.state)}
                                    </div>
                                  </div>
                                </div>
                              </td>
                              <td
                                className="max-w-[160px] truncate py-2 pr-2 text-[var(--text-muted)]"
                                title={
                                  (ch.sources?.length
                                    ? ch.sources
                                    : [ch.source]
                                  ).join('\n') +
                                  (st.activeSource
                                    ? `\nactiva: ${st.activeSource}`
                                    : '')
                                }
                              >
                                <div className="truncate">{ch.source}</div>
                                {(ch.sources?.length ?? 0) > 1 && (
                                  <div className="text-[10px]">
                                    +{(ch.sources!.length - 1)} respaldo
                                    {ch.sources!.length > 2 ? 's' : ''}
                                    {(st.activeSourceIndex ?? 0) > 0
                                      ? ` · usando #${(st.activeSourceIndex ?? 0) + 1}`
                                      : ''}
                                  </div>
                                )}
                              </td>
                              <td
                                className="max-w-[120px] truncate py-2 pr-2 font-mono"
                                title={ch.output}
                              >
                                {ch.output}
                              </td>
                              <td className="py-2 pr-2">
                                {linkBadge(st, { heldUp })}
                              </td>
                              <td
                                className="py-2 pr-2 font-mono"
                                title={
                                  st.speed != null
                                    ? `ffmpeg speed ${st.speed.toFixed(2)}x`
                                    : undefined
                                }
                              >
                                {formatBitrate(st.bitrateKbps)}
                              </td>
                              <td className="py-2 pr-2">
                                {st.packetLossPercent != null
                                  ? `${st.packetLossPercent.toFixed(2)}%`
                                  : st.dropFrames != null
                                    ? `${st.dropFrames} drops`
                                    : '—'}
                              </td>
                              <td className="py-2 pr-2">
                                {st.reconnects ?? 0}
                              </td>
                              <td className="py-2">
                                {canWrite && (
                                  <div className="flex gap-1">
                                    <button
                                      type="button"
                                      className="rounded border border-[var(--border)] px-1.5 py-0.5"
                                      onClick={() => onEditChannel(ch)}
                                    >
                                      Editar
                                    </button>
                                    {st.state === 'running' ? (
                                      <button
                                        type="button"
                                        className="rounded border border-[var(--border)] px-1.5 py-0.5"
                                        onClick={() =>
                                          void stopTvChannel(
                                            server.id,
                                            ch.id,
                                          ).then(() => channelsQ.refetch())
                                        }
                                      >
                                        Stop
                                      </button>
                                    ) : (
                                      <button
                                        type="button"
                                        className="rounded border border-[var(--border)] px-1.5 py-0.5"
                                        onClick={() =>
                                          void startTvChannel(
                                            server.id,
                                            ch.id,
                                          ).then(() => channelsQ.refetch())
                                        }
                                      >
                                        Start
                                      </button>
                                    )}
                                    <button
                                      type="button"
                                      className="rounded border border-red-500/40 px-1.5 py-0.5 text-red-400"
                                      onClick={() => {
                                        if (
                                          !confirm(
                                            `¿Eliminar canal ${ch.name}?`,
                                          )
                                        )
                                          return
                                        void deleteTvChannel(
                                          server.id,
                                          ch.id,
                                        ).then(() => channelsQ.refetch())
                                      }}
                                    >
                                      ×
                                    </button>
                                  </div>
                                )}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </DesktopTableWrap>
                </>
              )}

              <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
                <h4 className="text-sm font-medium">Proveedores EPG</h4>
                {canWrite && (
                  <button
                    type="button"
                    className="rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-xs"
                    onClick={onAddEpg}
                  >
                    Agregar EPG
                  </button>
                )}
              </div>
              {providers.length === 0 && (
                <p className="text-xs text-[var(--text-muted)]">
                  Sin proveedores EPG.
                </p>
              )}
              <ul className="space-y-1 text-xs">
                {providers.map((p) => (
                  <li
                    key={p.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded border border-[var(--border)] px-2 py-1.5"
                  >
                    <span>
                      <span className="font-medium">{p.name}</span>
                      <span className="text-[var(--text-muted)]">
                        {' '}
                        · {p.channelCount} canales · cada {p.refreshMinutes} min
                      </span>
                      {p.lastError && (
                        <span className="block text-red-400">{p.lastError}</span>
                      )}
                    </span>
                    {canWrite && (
                      <span className="flex gap-1">
                        <button
                          type="button"
                          className="rounded border border-[var(--border)] px-1.5 py-0.5"
                          onClick={() =>
                            void refreshTvEpgProvider(server.id, p.id).then(
                              () => epgQ.refetch(),
                            )
                          }
                        >
                          Refresh
                        </button>
                        <button
                          type="button"
                          className="rounded border border-red-500/40 px-1.5 py-0.5 text-red-400"
                          onClick={() => {
                            if (!confirm(`¿Eliminar EPG ${p.name}?`)) return
                            void deleteTvEpgProvider(server.id, p.id).then(() =>
                              epgQ.refetch(),
                            )
                          }}
                        >
                          ×
                        </button>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </li>
  )
}

function ChannelModal({
  serverId,
  channel,
  canWrite,
  onClose,
  onDone,
}: {
  serverId: string
  channel?: TvChannel
  canWrite: boolean
  onClose: () => void
  onDone: () => void
}) {
  const isEdit = !!channel
  const [name, setName] = useState(channel?.name ?? '')
  const [categoryMode, setCategoryMode] = useState<'existing' | 'new'>(
    'existing',
  )
  const [categoryId, setCategoryId] = useState(channel?.categoryId ?? '')
  const [newCategory, setNewCategory] = useState('')
  const [sources, setSources] = useState<string[]>(() => {
    const list =
      channel?.sources && channel.sources.length > 0
        ? channel.sources
        : channel?.source
          ? [channel.source]
          : ['']
    return list.length > 0 ? list : ['']
  })
  const [output, setOutput] = useState(channel?.output ?? '')
  const [epgProviderId, setEpgProviderId] = useState(
    channel?.epgProviderId ?? '',
  )
  const [epgKey, setEpgKey] = useState(channel?.epgChannelKey ?? '')
  const [logo, setLogo] = useState<File | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const nextOutQ = useQuery({
    queryKey: ['app', 'tv', 'servers', serverId, 'next-output'],
    queryFn: () => nextTvOutput(serverId),
    retry: false,
    enabled: !isEdit,
  })

  useEffect(() => {
    if (!isEdit && nextOutQ.data?.output) setOutput(nextOutQ.data.output)
  }, [isEdit, nextOutQ.data?.output])

  const catsQ = useQuery({
    queryKey: ['app', 'tv', 'servers', serverId, 'categories'],
    queryFn: () => listTvCategories(serverId),
  })
  const epgQ = useQuery({
    queryKey: ['app', 'tv', 'servers', serverId, 'epg'],
    queryFn: () => listTvEpgProviders(serverId),
  })
  const epgChQ = useQuery({
    queryKey: ['app', 'tv', 'servers', serverId, 'epg', epgProviderId, 'ch'],
    queryFn: () => listTvEpgChannels(serverId, epgProviderId),
    enabled: !!epgProviderId,
  })

  const cleanedSources = sources.map((s) => s.trim()).filter(Boolean)
  const primarySource = cleanedSources[0] ?? ''

  async function submit() {
    if (!canWrite) return
    setBusy(true)
    setErr(null)
    try {
      let catId: string | null = categoryId || null
      if (categoryMode === 'new' && newCategory.trim()) {
        const c = await createTvCategory(serverId, newCategory.trim())
        catId = c.id
      }
      if (cleanedSources.length === 0) {
        throw new Error('Indica al menos una fuente')
      }
      if (isEdit && channel) {
        await patchTvChannel(serverId, channel.id, {
          name: name.trim(),
          categoryId: catId,
          source: primarySource,
          sources: cleanedSources,
          output: output.trim(),
          epgProviderId: epgProviderId || null,
          epgChannelKey: epgKey || null,
        })
        if (logo) {
          await uploadTvChannelLogo(serverId, channel.id, logo)
        }
      } else {
        let out = output.trim()
        if (!out) {
          const n = await nextTvOutput(serverId)
          out = n.output
        }
        const created = await createTvChannel(serverId, {
          name: name.trim(),
          categoryId: catId,
          source: primarySource,
          sources: cleanedSources,
          output: out,
          epgProviderId: epgProviderId || null,
          epgChannelKey: epgKey || null,
        })
        if (logo) {
          await uploadTvChannelLogo(serverId, created.channel.id, logo)
        }
      }
      onDone()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-50 flex items-center justify-center modal-backdrop bg-black/50 p-4">
        <div className="max-h-[90vh] w-full max-w-lg space-y-3 overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4">
          <h3 className="text-lg font-semibold">
            {isEdit ? 'Editar canal' : 'Añadir canal'}
          </h3>
          <label className="block text-sm">
            Nombre
            <input
              className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <div className="flex gap-3 text-sm">
            <label className="flex items-center gap-1">
              <input
                type="radio"
                checked={categoryMode === 'existing'}
                onChange={() => setCategoryMode('existing')}
              />
              Categoría existente
            </label>
            <label className="flex items-center gap-1">
              <input
                type="radio"
                checked={categoryMode === 'new'}
                onChange={() => setCategoryMode('new')}
              />
              Nueva
            </label>
          </div>
          {categoryMode === 'existing' ? (
            <select
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm"
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
            >
              <option value="">— sin categoría —</option>
              {(catsQ.data?.categories ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          ) : (
            <input
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm"
              placeholder="Nombre categoría"
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
            />
          )}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm">Fuentes (failover)</span>
              <button
                type="button"
                className="rounded border border-[var(--border)] px-2 py-0.5 text-xs"
                onClick={() => setSources((s) => [...s, ''])}
              >
                + Respaldo
              </button>
            </div>
            <p className="text-[11px] text-[var(--text-muted)]">
              La primera es la principal. Si cae, usa la siguiente; cada ~25s
              prueba la principal y vuelve si responde.
            </p>
            {sources.map((src, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="w-16 shrink-0 text-[11px] text-[var(--text-muted)]">
                  {i === 0 ? 'Principal' : `Resp. ${i}`}
                </span>
                <input
                  className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 font-mono text-xs"
                  value={src}
                  onChange={(e) =>
                    setSources((prev) =>
                      prev.map((x, j) => (j === i ? e.target.value : x)),
                    )
                  }
                  placeholder="http://… o udp://…"
                />
                {i > 0 && (
                  <button
                    type="button"
                    className="rounded border border-red-500/40 px-2 py-1 text-xs text-red-400"
                    onClick={() =>
                      setSources((prev) => prev.filter((_, j) => j !== i))
                    }
                    aria-label="Quitar respaldo"
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
          </div>
          <label className="block text-sm">
            Salida multicast{isEdit ? '' : ' (auto del segmento)'}
            <input
              className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 font-mono text-xs"
              value={output}
              onChange={(e) => setOutput(e.target.value)}
              placeholder="udp://239.x.x.x:5000"
            />
          </label>
          {!isEdit && nextOutQ.isError && (
            <p className="text-xs text-amber-400">
              {(nextOutQ.error as Error).message}. Define el segmento en Editar
              servidor.
            </p>
          )}
          {!isEdit && nextOutQ.data && !nextOutQ.isError && (
            <p className="text-xs text-[var(--text-muted)]">
              Siguiente del pool {nextOutQ.data.multicastCidr} puerto{' '}
              {nextOutQ.data.multicastPort}
            </p>
          )}
          {isEdit && (
            <p className="text-xs text-[var(--text-muted)]">
              Si cambias fuentes o salida y el canal está en marcha, haz Stop y
              Start para aplicar.
            </p>
          )}
          <label className="block text-sm">
            Logo{isEdit ? ' (opcional, reemplaza el actual)' : ''}
            <input
              type="file"
              accept="image/*"
              className="mt-1 block w-full text-sm"
              onChange={(e) => setLogo(e.target.files?.[0] ?? null)}
            />
          </label>
          <label className="block text-sm">
            Proveedor EPG
            <select
              className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2"
              value={epgProviderId}
              onChange={(e) => {
                setEpgProviderId(e.target.value)
                setEpgKey('')
              }}
            >
              <option value="">— ninguno —</option>
              {(epgQ.data?.providers ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          {epgProviderId && (
            <label className="block text-sm">
              Canal EPG
              <select
                className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2"
                value={epgKey}
                onChange={(e) => setEpgKey(e.target.value)}
              >
                <option value="">— seleccionar —</option>
                {(epgChQ.data?.channels ?? []).map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.display} ({c.key})
                  </option>
                ))}
              </select>
            </label>
          )}
          {err && <p className="text-sm text-red-500">{err}</p>}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm"
              onClick={onClose}
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={
                busy ||
                !name.trim() ||
                cleanedSources.length === 0 ||
                !output.trim()
              }
              className="rounded-lg bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
              onClick={() => void submit()}
            >
              {isEdit ? 'Guardar' : 'Crear'}
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  )
}

function EditServerModal({
  server,
  onClose,
  onSaved,
}: {
  server: TvServer
  onClose: () => void
  onSaved: () => void
}) {
  const [name, setName] = useState(server.name)
  const [cidr, setCidr] = useState(server.multicastCidr ?? '239.1.1.0/24')
  const [port, setPort] = useState(String(server.multicastPort ?? 5000))
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function save() {
    setBusy(true)
    setErr(null)
    try {
      await updateTvServer(server.id, {
        name: name.trim(),
        multicastCidr: cidr.trim() || null,
        multicastPort: Number(port) || 5000,
      })
      onSaved()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-50 flex items-center justify-center modal-backdrop bg-black/50 p-4">
        <div className="w-full max-w-md space-y-3 rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4">
          <h3 className="text-lg font-semibold">Editar servidor TV</h3>
          <label className="block text-sm">
            Nombre
            <input
              className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <div className="grid grid-cols-3 gap-2">
            <label className="col-span-2 block text-sm">
              Segmento multicast
              <input
                className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 font-mono text-xs"
                value={cidr}
                onChange={(e) => setCidr(e.target.value)}
                placeholder="239.1.1.0/24"
              />
            </label>
            <label className="block text-sm">
              Puerto
              <input
                className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2"
                value={port}
                onChange={(e) => setPort(e.target.value)}
              />
            </label>
          </div>
          <p className="text-xs text-[var(--text-muted)]">
            Los canales nuevos usarán la siguiente IP libre del segmento (mismo
            puerto). No cambia salidas ya creadas.
          </p>
          {err && <p className="text-sm text-red-500">{err}</p>}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm"
              onClick={onClose}
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={busy || !name.trim()}
              className="rounded-lg bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
              onClick={() => void save()}
            >
              Guardar
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  )
}

function EpgModal({
  serverId,
  canWrite,
  onClose,
}: {
  serverId: string
  canWrite: boolean
  onClose: () => void
}) {
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [mins, setMins] = useState('360')
  const [err, setErr] = useState<string | null>(null)
  const [linkChannelId, setLinkChannelId] = useState('')
  const [linkProviderId, setLinkProviderId] = useState('')
  const [linkKey, setLinkKey] = useState('')

  const channelsQ = useQuery({
    queryKey: ['app', 'tv', 'servers', serverId, 'channels'],
    queryFn: () => listTvChannels(serverId),
  })
  const epgChQ = useQuery({
    queryKey: ['app', 'tv', 'servers', serverId, 'epg', linkProviderId, 'ch'],
    queryFn: () => listTvEpgChannels(serverId, linkProviderId),
    enabled: !!linkProviderId,
  })
  const providersQ = useQuery({
    queryKey: ['app', 'tv', 'servers', serverId, 'epg'],
    queryFn: () => listTvEpgProviders(serverId),
  })

  async function createProvider() {
    if (!canWrite) return
    setErr(null)
    try {
      const p = await createTvEpgProvider(serverId, {
        name: name.trim(),
        url: url.trim(),
        refreshMinutes: Number(mins) || 360,
      })
      await refreshTvEpgProvider(serverId, p.id)
      setName('')
      setUrl('')
      void qc.invalidateQueries({
        queryKey: ['app', 'tv', 'servers', serverId, 'epg'],
      })
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }

  async function linkChannel() {
    if (!canWrite || !linkChannelId || !linkProviderId) return
    setErr(null)
    try {
      await patchTvChannel(serverId, linkChannelId, {
        epgProviderId: linkProviderId,
        epgChannelKey: linkKey || null,
      })
      void qc.invalidateQueries({
        queryKey: ['app', 'tv', 'servers', serverId, 'channels'],
      })
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-50 flex items-center justify-center modal-backdrop bg-black/50 p-4">
        <div className="max-h-[90vh] w-full max-w-lg space-y-4 overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4">
          <h3 className="text-lg font-semibold">EPG</h3>
          <section className="space-y-2">
            <h4 className="text-sm font-medium">Nuevo proveedor (XMLTV)</h4>
            <input
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm"
              placeholder="Nombre"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <input
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm"
              placeholder="URL XMLTV"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
            <input
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm"
              placeholder="Refresh minutos"
              value={mins}
              onChange={(e) => setMins(e.target.value)}
            />
            <button
              type="button"
              className="rounded-lg bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white"
              onClick={() => void createProvider()}
            >
              Crear y refrescar
            </button>
          </section>
          <section className="space-y-2 border-t border-[var(--border)] pt-3">
            <h4 className="text-sm font-medium">Enlazar canal ↔ EPG</h4>
            <select
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm"
              value={linkChannelId}
              onChange={(e) => setLinkChannelId(e.target.value)}
            >
              <option value="">Canal…</option>
              {(channelsQ.data?.channels ?? []).map(({ channel: c }) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <select
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm"
              value={linkProviderId}
              onChange={(e) => {
                setLinkProviderId(e.target.value)
                setLinkKey('')
              }}
            >
              <option value="">Proveedor…</option>
              {(providersQ.data?.providers ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <select
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm"
              value={linkKey}
              onChange={(e) => setLinkKey(e.target.value)}
              disabled={!linkProviderId}
            >
              <option value="">Key EPG…</option>
              {(epgChQ.data?.channels ?? []).map((c) => (
                <option key={c.key} value={c.key}>
                  {c.display}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm"
              onClick={() => void linkChannel()}
            >
              Guardar enlace
            </button>
          </section>
          {err && <p className="text-sm text-red-500">{err}</p>}
          <div className="flex justify-end">
            <button
              type="button"
              className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm"
              onClick={onClose}
            >
              Cerrar
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  )
}
