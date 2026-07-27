import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  portalServiceMetrics,
  portalServices,
  type PortalService,
} from '../lib/client-portal'

function MiniChart({
  samples,
  label,
  unit,
}: {
  samples: Array<{ value: number; sampledAt: string }>
  label: string
  unit: string
}) {
  const chart = useMemo(() => {
    if (!samples.length) return null
    const vals = samples.map((s) => s.value)
    const min = Math.min(...vals)
    const max = Math.max(...vals)
    const span = max - min || 1
    const w = 320
    const h = 80
    const pad = 6
    const points = samples
      .map((s, i) => {
        const x =
          pad +
          (samples.length === 1
            ? (w - pad * 2) / 2
            : (i / (samples.length - 1)) * (w - pad * 2))
        const y = pad + (1 - (s.value - min) / span) * (h - pad * 2)
        return `${x},${y}`
      })
      .join(' ')
    return { points, min, max, w, h, n: samples.length }
  }, [samples])

  if (!chart) {
    return (
      <p className="text-xs text-[var(--portal-muted)]">Sin datos aún</p>
    )
  }

  return (
    <div>
      <p className="mb-1 text-xs font-medium text-[var(--portal-muted)]">
        {label}
      </p>
      <svg
        viewBox={`0 0 ${chart.w} ${chart.h}`}
        className="h-20 w-full overflow-visible"
      >
        <polyline
          fill="none"
          stroke="var(--portal-accent)"
          strokeWidth="2"
          points={chart.points}
        />
      </svg>
      <p className="text-[10px] text-[var(--portal-muted)]">
        {chart.min.toFixed(1)} … {chart.max.toFixed(1)} {unit} · {chart.n}{' '}
        muestras
      </p>
    </div>
  )
}

function ServiceCard({ service }: { service: PortalService }) {
  const metrics = useQuery({
    queryKey: ['portal', 'metrics', service.id],
    queryFn: () => portalServiceMetrics(service.id, 24),
    enabled: !!service.onuId,
    refetchInterval: 60_000,
  })
  const samples = metrics.data?.samples ?? []
  const signal = samples.filter((s) => s.kind === 'signal')
  const down = samples
    .filter((s) => s.kind === 'rx_bps')
    .map((s) => ({ ...s, value: s.value / 1e6 }))
  const up = samples
    .filter((s) => s.kind === 'tx_bps')
    .map((s) => ({ ...s, value: s.value / 1e6 }))

  return (
    <article className="rounded-2xl border border-[var(--portal-border)] bg-[var(--portal-elevated)]/60 p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">{service.name}</h2>
          <p className="text-sm text-[var(--portal-muted)]">
            {[service.planName, service.status].filter(Boolean).join(' · ')}
          </p>
          {(service.street || service.city) && (
            <p className="mt-1 text-xs text-[var(--portal-muted)]">
              {[service.street, service.city].filter(Boolean).join(', ')}
            </p>
          )}
        </div>
        <div className="text-right text-sm">
          {service.signalDbm != null && (
            <p>
              Señal:{' '}
              <span className="font-medium">{service.signalDbm.toFixed(1)} dBm</span>
            </p>
          )}
          {service.onuSn && (
            <p className="text-xs text-[var(--portal-muted)]">SN {service.onuSn}</p>
          )}
        </div>
      </div>
      {service.onuId ? (
        <div className="grid gap-4 sm:grid-cols-3">
          <MiniChart samples={signal} label="Señal" unit="dBm" />
          <MiniChart samples={down} label="Descarga" unit="Mbps" />
          <MiniChart samples={up} label="Subida" unit="Mbps" />
        </div>
      ) : (
        <p className="text-sm text-[var(--portal-muted)]">
          Sin ONU vinculada todavía.
        </p>
      )}
    </article>
  )
}

export function PortalServicesPage() {
  const query = useQuery({
    queryKey: ['portal', 'services'],
    queryFn: portalServices,
  })

  return (
    <div>
      <h1 className="portal-brand mb-1 text-2xl font-semibold">Servicios</h1>
      <p className="mb-6 text-sm text-[var(--portal-muted)]">
        Consumo y señal de las últimas 24 horas
      </p>
      {query.isLoading && (
        <p className="text-[var(--portal-muted)]">Cargando…</p>
      )}
      {query.isError && (
        <p className="text-red-400">
          {query.error instanceof Error ? query.error.message : 'Error'}
        </p>
      )}
      <div className="space-y-4">
        {(query.data ?? []).map((s) => (
          <ServiceCard key={s.id} service={s} />
        ))}
        {!query.isLoading && !(query.data ?? []).length && (
          <p className="text-[var(--portal-muted)]">No tienes servicios aún.</p>
        )}
      </div>
    </div>
  )
}
