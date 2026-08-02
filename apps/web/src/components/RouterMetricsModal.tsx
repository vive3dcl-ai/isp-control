import { useEffect, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { apiFetch } from '../lib/api'
import { formatBytes, type TopologyDevice } from '../lib/topology'
import {
  mikrotikBoardImageUrl,
  mikrotikFallbackImageUrl,
} from '../lib/mikrotikBoardImage'
import { oltBoardImageUrl } from '../lib/oltBoardImage'
import { ModalPortal } from './ModalPortal'


interface MetricHistory {
  deviceId: string
  name: string
  boardName?: string | null
  hours: number
  current: {
    cpuLoad?: number | null
    freeMemory?: string | null
    totalMemory?: string | null
    uptime?: string | null
    temperature?: number | null
    connectionStatus?: string
  }
  samples: Array<{
    at: string
    cpuLoad: number | null
    memoryUsedPct: number | null
    temperature: number | null
    uptimeSeconds: number | null
  }>
}

function formatClock(iso: string) {
  const d = new Date(iso)
  return d.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatUptimeHours(seconds: number | null) {
  if (seconds == null || !Number.isFinite(seconds)) return null
  return Math.round((seconds / 3600) * 10) / 10
}

export function RouterMetricsModal({
  open,
  device,
  onClose,
}: {
  open: boolean
  device: TopologyDevice | null
  onClose: () => void
}) {
  const historyQuery = useQuery({
    queryKey: ['app', 'topology', 'metrics', device?.id],
    queryFn: () =>
      apiFetch<MetricHistory>(
        `/app/topology/devices/${device!.id}/metrics?hours=6`,
      ),
    enabled: open && !!device?.id,
    refetchInterval: open ? 20_000 : false,
  })

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const chartData = useMemo(() => {
    const samples = historyQuery.data?.samples ?? []
    return samples.map((s) => ({
      t: formatClock(s.at),
      at: s.at,
      cpu: s.cpuLoad,
      ram: s.memoryUsedPct,
      temp: s.temperature,
      uptimeH: formatUptimeHours(s.uptimeSeconds),
    }))
  }, [historyQuery.data?.samples])

  if (!open || !device) return null

  const board =
    historyQuery.data?.boardName ?? device.metricBoardName ?? null
  const isOlt = device.type === 'olt'
  const isSwitch = device.type === 'switch'
  // OLTs are polled over SNMP only, so a missing RO community means no samples.
  const needsSnmp =
    isOlt && /SNMP sin community/i.test(device.metricSummary ?? '')
  const img = isOlt
    ? oltBoardImageUrl(device.subtype, board)
    : mikrotikBoardImageUrl(board) ??
      mikrotikFallbackImageUrl(isSwitch ? 'switch' : 'router')
  const fallbackImg = isOlt
    ? device.subtype?.startsWith('huawei_')
      ? '/olt/huawei-olt.svg'
      : 'https://raio.smartolt.com/content/img/ZTE-C320.png'
    : mikrotikFallbackImageUrl(isSwitch ? 'switch' : 'router')
  const cur = historyQuery.data?.current

  return (
    <ModalPortal><div className="fixed inset-0 z-[110] modal-backdrop flex items-stretch justify-center overflow-hidden bg-black/60 sm:items-center sm:p-4">
      <div
        role="dialog"
        aria-modal="true"
        className="flex h-[100dvh] max-h-[100dvh] w-full max-w-3xl flex-col overflow-hidden rounded-none border-0 sm:h-auto sm:max-h-[min(92dvh,920px)] sm:rounded-xl sm:border border-[var(--border)] bg-[var(--bg-elevated)] shadow-xl"
      >
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-[var(--border)] px-5 py-4">
          <div className="flex min-w-0 items-center gap-4">
            <img
              src={img}
              alt={board ?? device.name}
              className="h-14 w-28 object-contain"
              onError={(e) => {
                e.currentTarget.src = fallbackImg
              }}
            />
            <div className="min-w-0">
              <h2 className="truncate text-lg font-semibold">{device.name}</h2>
              <p className="text-sm text-[var(--text-muted)]">
                {board ??
                  (isOlt ? 'OLT' : isSwitch ? 'Switch' : 'Modelo desconocido')}
                {cur?.uptime ? ` · up ${cur.uptime}` : ''}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2 py-1 text-[var(--text-muted)] hover:bg-[var(--bg)]"
          >
            ✕
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <MetricStat
              label="CPU"
              value={
                cur?.cpuLoad != null ? `${cur.cpuLoad}%` : '—'
              }
            />
            <MetricStat
              label="RAM usada"
              value={
                cur?.freeMemory != null && cur?.totalMemory != null
                  ? `${formatBytes(
                      Number(cur.totalMemory) - Number(cur.freeMemory),
                    )} / ${formatBytes(cur.totalMemory)}`
                  : '—'
              }
            />
            <MetricStat
              label="Temperatura"
              value={
                cur?.temperature != null ? `${cur.temperature} °C` : '—'
              }
            />
            <MetricStat label="Uptime" value={cur?.uptime ?? '—'} />
          </dl>

          {historyQuery.isLoading && (
            <p className="text-sm text-[var(--text-muted)]">
              Cargando historial…
            </p>
          )}
          {historyQuery.error && (
            <p className="text-sm text-[var(--danger)]">
              {historyQuery.error.message}
            </p>
          )}

          {chartData.length === 0 && !historyQuery.isLoading ? (
            <p className="text-sm text-[var(--text-muted)]">
              {needsSnmp
                ? 'Sin community SNMP de solo lectura no se pueden tomar muestras. Configúrala en Topología para habilitar los gráficos.'
                : 'Aún no hay muestras históricas. Se irán llenando con el poller (~cada 15 s).'}
            </p>
          ) : (
            <div className="space-y-6">
              <ChartBlock title="CPU (%)">
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="t" tick={{ fontSize: 11 }} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} width={36} />
                  <Tooltip />
                  <Line
                    type="monotone"
                    dataKey="cpu"
                    name="CPU"
                    stroke="var(--accent)"
                    dot={false}
                    strokeWidth={2}
                  />
                </LineChart>
              </ChartBlock>

              <ChartBlock title="RAM usada (%)">
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="t" tick={{ fontSize: 11 }} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} width={36} />
                  <Tooltip />
                  <Line
                    type="monotone"
                    dataKey="ram"
                    name="RAM"
                    stroke="#0ea5e9"
                    dot={false}
                    strokeWidth={2}
                  />
                </LineChart>
              </ChartBlock>

              <ChartBlock title="Temperatura (°C)">
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="t" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} width={36} />
                  <Tooltip />
                  <Line
                    type="monotone"
                    dataKey="temp"
                    name="Temp"
                    stroke="#f59e0b"
                    dot={false}
                    strokeWidth={2}
                  />
                </LineChart>
              </ChartBlock>

              <ChartBlock title="Uptime (horas)">
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="t" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} width={40} />
                  <Tooltip />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="uptimeH"
                    name="Uptime h"
                    stroke="#22c55e"
                    dot={false}
                    strokeWidth={2}
                  />
                </LineChart>
              </ChartBlock>
            </div>
          )}
        </div>
      </div>
    </div></ModalPortal>
  )
}

function MetricStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2">
      <dt className="text-xs text-[var(--text-muted)]">{label}</dt>
      <dd className="mt-0.5 truncate text-sm font-medium tabular-nums">
        {value}
      </dd>
    </div>
  )
}

function ChartBlock({
  title,
  children,
}: {
  title: string
  children: React.ReactElement
}) {
  return (
    <div>
      <p className="mb-2 text-xs font-medium text-[var(--text-muted)]">
        {title}
      </p>
      <div className="h-44 w-full">
        <ResponsiveContainer width="100%" height="100%">
          {children}
        </ResponsiveContainer>
      </div>
    </div>
  )
}
