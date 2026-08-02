import { useMemo } from 'react'
import { bpsToMbps, formatBps, formatSignal } from '../lib/onu-connected'

export type MetricSample = { value: number; sampledAt: string }

/**
 * Ventanas de lectura. El endpoint devuelve 24 h de una vez, así que recortar
 * aquí no cuesta una petición extra y permite ver el muestreo rápido: con la
 * modal abierta se guarda un punto cada ~3 s, y en 24 h eso es invisible.
 */
export const METRIC_WINDOWS = [
  { key: '15m', label: '15 min', ms: 15 * 60_000 },
  { key: '1h', label: '1 h', ms: 60 * 60_000 },
  { key: '6h', label: '6 h', ms: 6 * 60 * 60_000 },
  { key: '24h', label: '24 h', ms: 24 * 60 * 60_000 },
] as const

export type MetricWindowKey = (typeof METRIC_WINDOWS)[number]['key']

export function metricWindowMs(key: MetricWindowKey): number {
  return METRIC_WINDOWS.find((w) => w.key === key)?.ms ?? 60 * 60_000
}

type Pt = { t: number; v: number }

const W = 560
const H = 160
const PAD_L = 46
const PAD_R = 10
const PAD_T = 10
const PAD_B = 22
const PLOT_W = W - PAD_L - PAD_R
const PLOT_H = H - PAD_T - PAD_B

function toPoints(samples: MetricSample[], since: number): Pt[] {
  const out: Pt[] = []
  for (const s of samples) {
    const t = Date.parse(s.sampledAt)
    if (!Number.isFinite(t) || t < since) continue
    if (!Number.isFinite(s.value)) continue
    out.push({ t, v: s.value })
  }
  return out.sort((a, b) => a.t - b.t)
}

/**
 * Agrupa en cubos de tiempo, no por índice. Muestrear por índice mezcla tramos
 * de 1 min con tramos de 3 s y deforma el eje: los últimos minutos se comían
 * media gráfica y el resto quedaba aplastado.
 */
function bucketize(
  points: Pt[],
  from: number,
  to: number,
  buckets: number,
  reduce: 'max' | 'avg',
): Pt[] {
  if (points.length <= buckets) return points
  const span = Math.max(to - from, 1)
  const acc = new Map<number, { sum: number; max: number; n: number; t: number }>()
  for (const p of points) {
    const b = Math.min(buckets - 1, Math.floor(((p.t - from) / span) * buckets))
    const cur = acc.get(b)
    if (!cur) acc.set(b, { sum: p.v, max: p.v, n: 1, t: p.t })
    else {
      cur.sum += p.v
      cur.n += 1
      if (p.v > cur.max) cur.max = p.v
      cur.t = p.t
    }
  }
  return [...acc.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, v]) => ({ t: v.t, v: reduce === 'max' ? v.max : v.sum / v.n }))
}

/**
 * Corta la línea cuando hay un hueco real de muestreo. Sin esto, un corte de
 * horas se dibuja como una recta que parece tráfico que nunca existió.
 */
function segments(points: Pt[]): Pt[][] {
  if (points.length < 2) return points.length ? [points] : []
  const deltas = points
    .slice(1)
    .map((p, i) => p.t - points[i]!.t)
    .sort((a, b) => a - b)
  const median = deltas[Math.floor(deltas.length / 2)] || 60_000
  const limit = Math.max(median * 4, 90_000)
  const out: Pt[][] = []
  let cur: Pt[] = [points[0]!]
  for (let i = 1; i < points.length; i++) {
    if (points[i]!.t - points[i - 1]!.t > limit) {
      out.push(cur)
      cur = []
    }
    cur.push(points[i]!)
  }
  if (cur.length) out.push(cur)
  return out
}

function hhmm(ms: number): string {
  return new Date(ms).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })
}

function Axes({
  from,
  to,
  yLabels,
}: {
  from: number
  to: number
  yLabels: string[]
}) {
  return (
    <>
      {yLabels.map((label, i) => {
        const y = PAD_T + (i / (yLabels.length - 1)) * PLOT_H
        return (
          <g key={label + i}>
            <line
              x1={PAD_L}
              x2={PAD_L + PLOT_W}
              y1={y}
              y2={y}
              stroke="currentColor"
              className="text-[var(--border)]"
              strokeWidth="1"
            />
            <text
              x={PAD_L - 6}
              y={y + 3}
              textAnchor="end"
              className="fill-[var(--text-muted)]"
              fontSize="10"
            >
              {label}
            </text>
          </g>
        )
      })}
      <text
        x={PAD_L}
        y={H - 6}
        className="fill-[var(--text-muted)]"
        fontSize="10"
      >
        {hhmm(from)}
      </text>
      <text
        x={PAD_L + PLOT_W}
        y={H - 6}
        textAnchor="end"
        className="fill-[var(--text-muted)]"
        fontSize="10"
      >
        {hhmm(to)}
      </text>
    </>
  )
}

function Line({
  points,
  from,
  to,
  min,
  max,
  color,
}: {
  points: Pt[]
  from: number
  to: number
  min: number
  max: number
  color: string
}) {
  const span = Math.max(to - from, 1)
  const range = Math.max(max - min, 1e-6)
  const xAt = (t: number) => PAD_L + ((t - from) / span) * PLOT_W
  const yAt = (v: number) => PAD_T + ((max - v) / range) * PLOT_H
  return (
    <>
      {segments(points).map((seg, i) => (
        <polyline
          key={i}
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeLinejoin="round"
          points={seg
            .map((p) => `${xAt(p.t).toFixed(1)},${yAt(p.v).toFixed(1)}`)
            .join(' ')}
        />
      ))}
      {points.length === 1 && (
        <circle
          cx={xAt(points[0]!.t)}
          cy={yAt(points[0]!.v)}
          r="2.5"
          fill={color}
        />
      )}
    </>
  )
}

export function MetricWindowPicker({
  value,
  onChange,
}: {
  value: MetricWindowKey
  onChange: (key: MetricWindowKey) => void
}) {
  return (
    <div className="flex gap-1">
      {METRIC_WINDOWS.map((w) => (
        <button
          key={w.key}
          type="button"
          onClick={() => onChange(w.key)}
          className={[
            'rounded px-2 py-0.5 text-[11px] font-medium',
            value === w.key
              ? 'bg-[var(--accent)] text-white'
              : 'border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--bg)]',
          ].join(' ')}
        >
          {w.label}
        </button>
      ))}
    </div>
  )
}

export function SignalChart({
  samples,
  windowKey,
}: {
  samples: MetricSample[]
  windowKey: MetricWindowKey
}) {
  const chart = useMemo(() => {
    const to = Date.now()
    const from = to - metricWindowMs(windowKey)
    const pts = bucketize(toPoints(samples, from), from, to, 240, 'avg')
    if (!pts.length) return null
    const vals = pts.map((p) => p.v)
    const min = Math.floor(Math.min(...vals) - 1)
    const max = Math.ceil(Math.max(...vals) + 1)
    return { from, to, pts, min, max, last: pts.at(-1)!.v }
  }, [samples, windowKey])

  if (!chart) {
    return (
      <p className="text-xs text-[var(--text-muted)]">
        Sin muestras en esta ventana. La flota se lee cada ~1 min; con la ficha
        abierta, cada ~3 s.
      </p>
    )
  }

  const { from, to, min, max } = chart
  const labels = [max, (max + min) / 2, min].map((v) => v.toFixed(1))

  return (
    <div>
      <p className="mb-1 text-xs">
        <span className="text-[var(--accent)]">●</span> Señal actual{' '}
        <strong>{formatSignal(chart.last)}</strong>
      </p>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-36 w-full"
        role="img"
        aria-label="Señal óptica"
      >
        <Axes from={from} to={to} yLabels={labels} />
        <Line
          points={chart.pts}
          from={from}
          to={to}
          min={min}
          max={max}
          color="var(--accent)"
        />
      </svg>
      <p className="mt-1 text-xs text-[var(--text-muted)]">
        dBm · {chart.pts.length} puntos
      </p>
    </div>
  )
}

export function TrafficChart({
  download,
  upload,
  windowKey,
  liveDownloadBps,
  liveUploadBps,
}: {
  download: MetricSample[]
  upload: MetricSample[]
  windowKey: MetricWindowKey
  liveDownloadBps?: number | null
  liveUploadBps?: number | null
}) {
  const chart = useMemo(() => {
    const to = Date.now()
    const from = to - metricWindowMs(windowKey)
    // Cada sentido va por su lado: cruzarlos por marca de tiempo obligaba a
    // rellenar con cero el que faltaba y dibujaba caídas que no ocurrieron.
    const down = bucketize(toPoints(download, from), from, to, 240, 'max').map(
      (p) => ({ t: p.t, v: bpsToMbps(p.v) }),
    )
    const up = bucketize(toPoints(upload, from), from, to, 240, 'max').map(
      (p) => ({ t: p.t, v: bpsToMbps(p.v) }),
    )
    if (!down.length && !up.length) return null
    const max = Math.max(...down.map((p) => p.v), ...up.map((p) => p.v), 0.1)
    return { from, to, down, up, max }
  }, [download, upload, windowKey])

  if (!chart) {
    return (
      <p className="text-xs text-[var(--text-muted)]">
        Sin muestras en esta ventana. La flota se lee cada ~1 min; con la ficha
        abierta, cada ~3 s.
      </p>
    )
  }

  const { from, to, max } = chart
  const labels = [max, max / 2, 0].map((v) => v.toFixed(v >= 10 ? 0 : 2))

  return (
    <div>
      <div className="mb-1 flex flex-wrap gap-3 text-xs">
        <span>
          <span className="text-sky-400">●</span> Bajada{' '}
          <strong>
            {formatBps(liveDownloadBps ?? download.at(-1)?.value ?? null)}
          </strong>
        </span>
        <span>
          <span className="text-emerald-400">●</span> Subida{' '}
          <strong>
            {formatBps(liveUploadBps ?? upload.at(-1)?.value ?? null)}
          </strong>
        </span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-36 w-full"
        role="img"
        aria-label="Tráfico"
      >
        <Axes from={from} to={to} yLabels={labels} />
        <Line
          points={chart.down}
          from={from}
          to={to}
          min={0}
          max={max}
          color="#38bdf8"
        />
        <Line
          points={chart.up}
          from={from}
          to={to}
          min={0}
          max={max}
          color="#34d399"
        />
      </svg>
      <p className="mt-1 text-xs text-[var(--text-muted)]">
        Mbps · pico {max.toFixed(2)} · {chart.down.length + chart.up.length}{' '}
        puntos
      </p>
    </div>
  )
}
