import {
  connectionStatusLabel,
  formatBytes,
  isMikrotikSwosDevice,
  oltSubtypeLabel,
  switchSubtypeLabel,
  type ConnectionStatus,
  type OltSubtype,
  type SwitchSubtype,
  type TopologyDevice,
} from '../lib/topology'
import {
  mikrotikBoardImageUrl,
  mikrotikFallbackImageUrl,
} from '../lib/mikrotikBoardImage'
import { oltBoardImageUrl } from '../lib/oltBoardImage'

function ramUsedLabel(device: TopologyDevice) {
  const free = device.metricFreeMemory
  const total = device.metricTotalMemory
  if (free == null || total == null) return '—'
  const f = Number(free)
  const t = Number(total)
  if (!Number.isFinite(f) || !Number.isFinite(t) || t <= 0) return '—'
  const usedPct = Math.round(((t - f) / t) * 100)
  return `${usedPct}% · ${formatBytes(t - f)}`
}

function statusDotClass(status?: string) {
  if (status === 'connected') return 'bg-[var(--success)]'
  if (status === 'disconnected' || status === 'error')
    return 'bg-[var(--danger)]'
  return 'bg-[var(--text-muted)]'
}

export function RouterDeviceCard({
  device,
  onClick,
}: {
  device: TopologyDevice
  onClick: () => void
}) {
  const board = device.metricBoardName
  const img =
    mikrotikBoardImageUrl(board) ?? mikrotikFallbackImageUrl('router')
  const status = (device.connectionStatus ??
    'unknown') as ConnectionStatus

  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex w-full min-w-0 items-stretch overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] text-left transition hover:border-[var(--accent)] hover:shadow-md"
    >
      <div className="relative flex w-[34%] min-w-[5.5rem] max-w-[11rem] shrink-0 items-center justify-center bg-gradient-to-br from-[var(--bg)] to-[var(--bg-elevated)] px-2 py-3 sm:w-[38%] sm:min-w-[7.5rem] sm:px-3 sm:py-4">
        <img
          src={img}
          alt={board ?? device.name}
          className="max-h-16 w-full object-contain transition duration-300 group-hover:scale-[1.03] sm:max-h-20"
          onError={(e) => {
            e.currentTarget.src = mikrotikFallbackImageUrl('router')
          }}
        />
        <span
          className={[
            'absolute right-2 top-2 h-2.5 w-2.5 rounded-full ring-2 ring-[var(--bg-elevated)]',
            statusDotClass(status),
          ].join(' ')}
          title={connectionStatusLabel[status] ?? status}
        />
      </div>
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-2 border-l border-[var(--border)] px-4 py-3">
        <div>
          <p className="truncate font-medium">{device.name}</p>
          <p className="truncate text-xs text-[var(--text-muted)]">
            {board ?? device.subtype ?? 'Router'}
            {device.mgmtHost ? ` · ${device.mgmtHost}` : ''}
          </p>
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-4">
          <div>
            <dt className="text-[var(--text-muted)]">CPU</dt>
            <dd className="font-medium tabular-nums">
              {device.metricCpuLoad != null
                ? `${device.metricCpuLoad}%`
                : '—'}
            </dd>
          </div>
          <div>
            <dt className="text-[var(--text-muted)]">RAM</dt>
            <dd className="truncate font-medium tabular-nums">
              {ramUsedLabel(device)}
            </dd>
          </div>
          <div>
            <dt className="text-[var(--text-muted)]">Uptime</dt>
            <dd className="truncate font-medium tabular-nums">
              {device.metricUptime ?? '—'}
            </dd>
          </div>
          <div>
            <dt className="text-[var(--text-muted)]">Temp</dt>
            <dd className="font-medium tabular-nums">
              {device.metricTemperature != null
                ? `${device.metricTemperature} °C`
                : '—'}
            </dd>
          </div>
        </dl>
      </div>
    </button>
  )
}

export function SwitchDeviceCard({
  device,
  onClick,
}: {
  device: TopologyDevice
  onClick: () => void
}) {
  const board = device.metricBoardName
  const img =
    mikrotikBoardImageUrl(board) ?? mikrotikFallbackImageUrl('switch')
  const status = (device.connectionStatus ?? 'unknown') as ConnectionStatus
  const family = device.subtype
    ? switchSubtypeLabel[device.subtype as SwitchSubtype] ?? device.subtype
    : 'Switch'
  // SwOS has no CPU/RAM counters, so those cells would always be empty.
  const swos = isMikrotikSwosDevice(device.type, device.subtype)

  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex w-full min-w-0 items-stretch overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] text-left transition hover:border-[var(--accent)] hover:shadow-md"
    >
      <div className="relative flex w-[34%] min-w-[5.5rem] max-w-[11rem] shrink-0 items-center justify-center bg-gradient-to-br from-[var(--bg)] to-[var(--bg-elevated)] px-2 py-3 sm:w-[38%] sm:min-w-[7.5rem] sm:px-3 sm:py-4">
        <img
          src={img}
          alt={board ?? device.name}
          className="max-h-16 w-full object-contain transition duration-300 group-hover:scale-[1.03] sm:max-h-20"
          onError={(e) => {
            e.currentTarget.src = mikrotikFallbackImageUrl('switch')
          }}
        />
        <span
          className={[
            'absolute right-2 top-2 h-2.5 w-2.5 rounded-full ring-2 ring-[var(--bg-elevated)]',
            statusDotClass(status),
          ].join(' ')}
          title={connectionStatusLabel[status] ?? status}
        />
      </div>
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-2 border-l border-[var(--border)] px-4 py-3">
        <div>
          <p className="truncate font-medium">{device.name}</p>
          <p className="truncate text-xs text-[var(--text-muted)]">
            {board ?? family}
            {device.mgmtHost ? ` · ${device.mgmtHost}` : ''}
          </p>
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-4">
          <div>
            <dt className="text-[var(--text-muted)]">CPU</dt>
            <dd className="font-medium tabular-nums">
              {device.metricCpuLoad != null
                ? `${device.metricCpuLoad}%`
                : swos
                  ? 'n/d'
                  : '—'}
            </dd>
          </div>
          <div>
            <dt className="text-[var(--text-muted)]">RAM</dt>
            <dd className="truncate font-medium tabular-nums">
              {swos && device.metricTotalMemory == null
                ? 'n/d'
                : ramUsedLabel(device)}
            </dd>
          </div>
          <div>
            <dt className="text-[var(--text-muted)]">Uptime</dt>
            <dd className="truncate font-medium tabular-nums">
              {device.metricUptime ?? '—'}
            </dd>
          </div>
          <div>
            <dt className="text-[var(--text-muted)]">Temp</dt>
            <dd className="font-medium tabular-nums">
              {device.metricTemperature != null
                ? `${device.metricTemperature} °C`
                : swos
                  ? 'n/d'
                  : '—'}
            </dd>
          </div>
        </dl>
      </div>
    </button>
  )
}

export function OltDeviceCard({
  device,
  onClick,
}: {
  device: TopologyDevice
  onClick: () => void
}) {
  const status = (device.connectionStatus ??
    'unknown') as ConnectionStatus
  const family =
    device.subtype
      ? oltSubtypeLabel[device.subtype as OltSubtype] ?? device.subtype
      : 'OLT'
  const board = device.metricBoardName
  const img = oltBoardImageUrl(device.subtype, board)
  const mode = device.mgmtConnectionMode === 'secure' ? 'VPN' : 'Pública'

  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex w-full min-w-0 items-stretch overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] text-left transition hover:border-[var(--accent)] hover:shadow-md"
    >
      <div className="relative flex w-[34%] min-w-[5.5rem] max-w-[11rem] shrink-0 items-center justify-center bg-gradient-to-br from-[var(--bg)] to-[var(--bg-elevated)] px-2 py-3 sm:w-[38%] sm:min-w-[7.5rem] sm:px-3 sm:py-4">
        <img
          src={img}
          alt={board ?? family}
          className="max-h-16 w-full object-contain transition duration-300 group-hover:scale-[1.03] sm:max-h-20"
          onError={(e) => {
            e.currentTarget.src = device.subtype?.startsWith('huawei_')
              ? '/olt/huawei-olt.svg'
              : 'https://raio.smartolt.com/content/img/ZTE-C320.png'
          }}
        />
        <span
          className={[
            'absolute right-2 top-2 h-2.5 w-2.5 rounded-full ring-2 ring-[var(--bg-elevated)]',
            statusDotClass(status),
          ].join(' ')}
          title={connectionStatusLabel[status] ?? status}
        />
      </div>
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-2 border-l border-[var(--border)] px-4 py-3">
        <div>
          <p className="truncate font-medium">{device.name}</p>
          <p className="truncate text-xs text-[var(--text-muted)]">
            {board ?? family}
            {device.mgmtHost ? ` · ${device.mgmtHost}` : ''}
            {` · ${mode}`}
            {device.technicianMode ? ' · Técnico' : ''}
          </p>
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-4">
          <div>
            <dt className="text-[var(--text-muted)]">CPU</dt>
            <dd className="font-medium tabular-nums">
              {device.metricCpuLoad != null
                ? `${device.metricCpuLoad}%`
                : '—'}
            </dd>
          </div>
          <div>
            <dt className="text-[var(--text-muted)]">RAM</dt>
            <dd className="truncate font-medium tabular-nums">
              {ramUsedLabel(device)}
            </dd>
          </div>
          <div>
            <dt className="text-[var(--text-muted)]">Uptime</dt>
            <dd className="truncate font-medium tabular-nums">
              {device.metricUptime ?? '—'}
            </dd>
          </div>
          <div>
            <dt className="text-[var(--text-muted)]">Temp</dt>
            <dd className="font-medium tabular-nums">
              {device.metricTemperature != null
                ? `${device.metricTemperature} °C`
                : '—'}
            </dd>
          </div>
        </dl>
      </div>
    </button>
  )
}
