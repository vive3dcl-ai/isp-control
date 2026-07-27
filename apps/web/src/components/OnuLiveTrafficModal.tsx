import { useEffect, useMemo, useRef, useState } from 'react'
import { apiFetch } from '../lib/api'
import {
  bpsToMbps,
  type OnuLiveTrafficResponse,
} from '../lib/onu-connected'

type Point = {
  at: number
  uploadMbps: number
  downloadMbps: number
  uploadPps: number
  downloadPps: number
  uploadAvgSize: number | null
  downloadAvgSize: number | null
}

const POLL_MS = 1_500
const MAX_POINTS = 80

function fmtMbps(n: number): string {
  if (!Number.isFinite(n)) return '0'
  if (n < 0.01) return n.toFixed(3)
  if (n < 10) return n.toFixed(2)
  return n.toFixed(1)
}

type Props = {
  oltId: string
  onuIf: string
  onClose: () => void
}

export function OnuLiveTrafficModal({ oltId, onuIf, onClose }: Props) {
  const [points, setPoints] = useState<Point[]>([])
  const [error, setError] = useState<string | null>(null)
  const [connected, setConnected] = useState(false)
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)
  const abortRef = useRef(false)
  const inFlight = useRef(false)

  useEffect(() => {
    abortRef.current = false
    setPoints([])
    setError(null)
    setConnected(false)

    const tick = async () => {
      if (abortRef.current || inFlight.current) return
      inFlight.current = true
      try {
        const r = await apiFetch<OnuLiveTrafficResponse>(
          `/app/onus/live-traffic?oltId=${encodeURIComponent(oltId)}&onuIf=${encodeURIComponent(onuIf)}`,
        )
        if (abortRef.current) return
        setConnected(true)
        setError(null)
        const point: Point = {
          at: new Date(r.probedAt).getTime() || Date.now(),
          uploadMbps: bpsToMbps(r.uploadBps ?? 0),
          downloadMbps: bpsToMbps(r.downloadBps ?? 0),
          uploadPps: r.uploadPps ?? 0,
          downloadPps: r.downloadPps ?? 0,
          uploadAvgSize: r.uploadAvgSize,
          downloadAvgSize: r.downloadAvgSize,
        }
        setPoints((prev) => [...prev, point].slice(-MAX_POINTS))
      } catch (e) {
        if (abortRef.current) return
        setError(e instanceof Error ? e.message : String(e))
        setConnected(false)
      } finally {
        inFlight.current = false
      }
    }

    void tick()
    const id = window.setInterval(() => void tick(), POLL_MS)
    return () => {
      abortRef.current = true
      window.clearInterval(id)
    }
  }, [oltId, onuIf])

  const latest = points.at(-1) ?? null
  const maxUp = useMemo(
    () => Math.max(0, ...points.map((p) => p.uploadMbps)),
    [points],
  )
  const maxDown = useMemo(
    () => Math.max(0, ...points.map((p) => p.downloadMbps)),
    [points],
  )

  const chart = useMemo(() => {
    const w = 560
    const h = 220
    const padL = 44
    const padR = 12
    const padT = 12
    const padB = 28
    const plotW = w - padL - padR
    const plotH = h - padT - padB
    const yMax = Math.max(maxUp, maxDown, 0.1)
    const n = points.length
    const xAt = (i: number) =>
      padL + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW)
    const yAt = (v: number) => padT + ((yMax - v) / yMax) * plotH
    const toPath = (key: 'uploadMbps' | 'downloadMbps') =>
      points
        .map((p, i) => `${xAt(i).toFixed(1)},${yAt(p[key]).toFixed(1)}`)
        .join(' ')
    const gridYs = [0, 0.25, 0.5, 0.75, 1].map((f) => ({
      y: padT + (1 - f) * plotH,
      label: fmtMbps(yMax * f),
    }))
    return { w, h, padL, padT, padB, plotW, plotH, yMax, toPath, gridYs, xAt }
  }, [points, maxUp, maxDown])

  const tip = hoverIdx != null ? points[hoverIdx] : latest

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-black/70 p-4 sm:items-center">
      <div className="max-h-[min(92vh,100dvh)] overflow-y-auto w-full max-w-3xl rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] shadow-xl">
        <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-3">
          <div>
            <h3 className="flex items-center gap-2 text-lg font-semibold">
              Tráfico en vivo
              <span
                className={[
                  'rounded px-1.5 py-0.5 text-[10px] font-bold tracking-wide',
                  connected
                    ? 'bg-red-600/90 text-white'
                    : 'bg-[var(--bg)] text-[var(--text-muted)]',
                ].join(' ')}
              >
                {connected ? 'LIVE' : '…'}
              </span>
            </h3>
            <p className="mt-0.5 font-mono text-xs text-[var(--text-muted)]">
              {onuIf}
            </p>
          </div>
          <button
            type="button"
            className="rounded-md px-2 py-1 text-[var(--text-muted)] hover:bg-[var(--bg)]"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          {error && (
            <p className="text-sm text-[var(--danger)]">{error}</p>
          )}
          {!error && points.length === 0 && (
            <p className="text-sm text-[var(--text-muted)]">
              Conectando a la OLT…
            </p>
          )}

          <div className="relative rounded-lg border border-[var(--border)] bg-[var(--bg)] p-3">
            <svg
              viewBox={`0 0 ${chart.w} ${chart.h}`}
              className="h-56 w-full"
              role="img"
              aria-label="Tráfico en vivo"
              onMouseLeave={() => setHoverIdx(null)}
              onMouseMove={(e) => {
                if (points.length === 0) return
                const rect = e.currentTarget.getBoundingClientRect()
                const x = ((e.clientX - rect.left) / rect.width) * chart.w
                let best = 0
                let bestDist = Infinity
                for (let i = 0; i < points.length; i++) {
                  const d = Math.abs(chart.xAt(i) - x)
                  if (d < bestDist) {
                    bestDist = d
                    best = i
                  }
                }
                setHoverIdx(best)
              }}
            >
              {chart.gridYs.map((g) => (
                <g key={g.y}>
                  <line
                    x1={chart.padL}
                    x2={chart.padL + chart.plotW}
                    y1={g.y}
                    y2={g.y}
                    stroke="currentColor"
                    className="text-[var(--border)]"
                    strokeWidth="1"
                  />
                  <text
                    x={chart.padL - 6}
                    y={g.y + 3}
                    textAnchor="end"
                    className="fill-[var(--text-muted)]"
                    fontSize="10"
                  >
                    {g.label}
                  </text>
                </g>
              ))}
              <text
                x={12}
                y={chart.h / 2}
                textAnchor="middle"
                transform={`rotate(-90 12 ${chart.h / 2})`}
                className="fill-[var(--text-muted)]"
                fontSize="11"
              >
                Mbps
              </text>
              {points.length > 0 && (
                <>
                  <polyline
                    fill="none"
                    stroke="#f97316"
                    strokeWidth="2"
                    points={chart.toPath('uploadMbps')}
                  />
                  <polyline
                    fill="none"
                    stroke="#38bdf8"
                    strokeWidth="2"
                    points={chart.toPath('downloadMbps')}
                  />
                </>
              )}
              {hoverIdx != null && points[hoverIdx] && (
                <line
                  x1={chart.xAt(hoverIdx)}
                  x2={chart.xAt(hoverIdx)}
                  y1={chart.padT}
                  y2={chart.padT + chart.plotH}
                  stroke="currentColor"
                  className="text-[var(--text-muted)]"
                  strokeDasharray="3 3"
                  strokeWidth="1"
                />
              )}
            </svg>

            {tip && (
              <div className="pointer-events-none absolute right-4 top-4 rounded border border-[var(--border)] bg-[var(--bg-elevated)]/95 px-3 py-2 text-xs shadow">
                <p className="mb-1 font-mono text-[var(--text-muted)]">
                  {new Date(tip.at).toLocaleTimeString()}
                </p>
                <p>
                  <span className="text-orange-400">▲ Upload</span>{' '}
                  {fmtMbps(tip.uploadMbps)}
                </p>
                <p>
                  <span className="text-sky-400">▼ Download</span>{' '}
                  {fmtMbps(tip.downloadMbps)}
                </p>
              </div>
            )}
          </div>

          <div className="grid gap-3 text-sm sm:grid-cols-2">
            <div className="rounded-lg border border-[var(--border)] px-3 py-2">
              <p className="mb-1 font-medium text-orange-400">▲ Upload</p>
              <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs sm:text-sm">
                <dt className="text-[var(--text-muted)]">U Speed</dt>
                <dd>{fmtMbps(latest?.uploadMbps ?? 0)} Mbps</dd>
                <dt className="text-[var(--text-muted)]">Max</dt>
                <dd>{fmtMbps(maxUp)} Mbps</dd>
                <dt className="text-[var(--text-muted)]">Pps</dt>
                <dd>{latest?.uploadPps ?? 0}</dd>
                <dt className="text-[var(--text-muted)]">Avg size</dt>
                <dd>{latest?.uploadAvgSize ?? 0}</dd>
              </dl>
            </div>
            <div className="rounded-lg border border-[var(--border)] px-3 py-2">
              <p className="mb-1 font-medium text-sky-400">▼ Download</p>
              <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs sm:text-sm">
                <dt className="text-[var(--text-muted)]">D Speed</dt>
                <dd>{fmtMbps(latest?.downloadMbps ?? 0)} Mbps</dd>
                <dt className="text-[var(--text-muted)]">Max</dt>
                <dd>{fmtMbps(maxDown)} Mbps</dd>
                <dt className="text-[var(--text-muted)]">Pps</dt>
                <dd>{latest?.downloadPps ?? 0}</dd>
                <dt className="text-[var(--text-muted)]">Avg size</dt>
                <dd>{latest?.downloadAvgSize ?? 0}</dd>
              </dl>
            </div>
          </div>

          <p className="text-xs text-[var(--text-muted)]">
            Muestreo cada ~{POLL_MS / 1000}s mientras este cuadro está abierto.
            Cerrar detiene la consulta a la OLT.
          </p>
        </div>

        <div className="flex justify-end border-t border-[var(--border)] px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-500"
          >
            Desconectar
          </button>
        </div>
      </div>
    </div>
  )
}
