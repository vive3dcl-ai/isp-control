import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { apiFetch } from '../lib/api'
import { formatMoney, useCompanyCurrency } from '../lib/currency'
import { PanelShell } from '../components/PanelShell'
import {
  OltDeviceCard,
  RouterDeviceCard,
} from '../components/DashboardNetworkCards'
import { RouterMetricsModal } from '../components/RouterMetricsModal'
import type { TopologyDevice } from '../lib/topology'

interface DashboardAlert {
  id: string
  severity: 'info' | 'warning' | 'critical'
  title: string
  message: string
}

interface DashboardData {
  message: string
  tenantSlug?: string
  clientCount: number
  activeServices: number
  suspendedServices: number
  salesThisMonth: number
  estimatedEarnings: number
  alertsCount: number
  alerts: DashboardAlert[]
}

interface TopologyGraph {
  devices: TopologyDevice[]
}

export function TenantDashboardPage() {
  const { user } = useAuth()
  const currency = useCompanyCurrency()
  const [metricsDevice, setMetricsDevice] = useState<TopologyDevice | null>(
    null,
  )

  const { data, error, isLoading } = useQuery({
    queryKey: ['app', 'dashboard'],
    queryFn: () => apiFetch<DashboardData>('/app/dashboard'),
  })

  const topologyQuery = useQuery({
    queryKey: ['app', 'topology'],
    queryFn: () => apiFetch<TopologyGraph>('/app/topology'),
    refetchInterval: 10_000,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
    retry: 3,
    placeholderData: (prev) => prev,
  })

  const { routers, olts } = useMemo(() => {
    const devices = topologyQuery.data?.devices ?? []
    return {
      routers: devices.filter((d) => d.type === 'router' && d.isActive),
      olts: devices.filter((d) => d.type === 'olt' && d.isActive),
    }
  }, [topologyQuery.data?.devices])

  // Keep open metrics modal in sync with live topology polls
  useEffect(() => {
    if (!metricsDevice?.id) return
    const fresh = topologyQuery.data?.devices.find(
      (d) => d.id === metricsDevice.id,
    )
    if (fresh) setMetricsDevice(fresh)
  }, [topologyQuery.data?.devices, metricsDevice?.id])

  return (
    <PanelShell
      title="Dashboard"
      subtitle={user?.tenantSlug ? `Tenant: ${user.tenantSlug}` : 'Tu espacio'}
      variant="tenant"
    >
      {error && (
        <p className="mb-4 text-sm text-[var(--danger)]">{error.message}</p>
      )}
      {isLoading && (
        <p className="text-[var(--text-muted)]">Cargando…</p>
      )}
      {data && (
        <div>
          <p className="text-lg text-[var(--text)]">{data.message}</p>
          <dl className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Link
              to="/app/clients"
              className="rounded-xl border border-[var(--border)] bg-[var(--bg)] p-4 transition hover:border-[var(--accent)]"
            >
              <dt className="text-sm text-[var(--text-muted)]">
                Clientes activos
              </dt>
              <dd className="mt-1 text-xl font-medium">
                {data.clientCount ?? 0}
              </dd>
            </Link>
            <div className="rounded-xl border border-[var(--border)] bg-[var(--bg)] p-4">
              <dt className="text-sm text-[var(--text-muted)]">
                Servicios activos
              </dt>
              <dd className="mt-1 text-xl font-medium">
                {data.activeServices ?? 0}
              </dd>
            </div>
            <div className="rounded-xl border border-[var(--border)] bg-[var(--bg)] p-4">
              <dt className="text-sm text-[var(--text-muted)]">
                Servicios suspendidos
              </dt>
              <dd className="mt-1 text-xl font-medium">
                {data.suspendedServices ?? 0}
              </dd>
            </div>
            <Link
              to="/app/settings?tab=facturacion"
              className="rounded-xl border border-[var(--border)] bg-[var(--bg)] p-4 transition hover:border-[var(--accent)]"
            >
              <dt className="text-sm text-[var(--text-muted)]">
                Ventas del mes
              </dt>
              <dd className="mt-1 text-xl font-medium">
                {formatMoney(data.salesThisMonth ?? 0, currency)}
              </dd>
              <p className="mt-1 text-[11px] text-[var(--text-muted)]">
                Facturas pagadas este mes
              </p>
            </Link>
            <Link
              to="/app/settings?tab=facturacion"
              className="rounded-xl border border-[var(--border)] bg-[var(--bg)] p-4 transition hover:border-[var(--accent)]"
            >
              <dt className="text-sm text-[var(--text-muted)]">
                Ganancias estimadas
              </dt>
              <dd className="mt-1 text-xl font-medium">
                {formatMoney(data.estimatedEarnings ?? 0, currency)}
              </dd>
              <p className="mt-1 text-[11px] text-[var(--text-muted)]">
                Facturas emitidas pendientes de cobro
              </p>
            </Link>
            <div className="rounded-xl border border-[var(--border)] bg-[var(--bg)] p-4">
              <dt className="text-sm text-[var(--text-muted)]">Alertas</dt>
              <dd className="mt-1 text-xl font-medium">
                {data.alertsCount ?? 0}
              </dd>
              <p className="mt-1 text-[11px] text-[var(--text-muted)]">
                {(data.alertsCount ?? 0) === 0
                  ? 'Sin alertas por ahora'
                  : 'Requieren atención'}
              </p>
            </div>
          </dl>

          <div className="mt-10 grid gap-4 lg:grid-cols-2">
            <section className="rounded-xl border border-[var(--border)] bg-[var(--bg)] p-4">
              <div className="mb-3">
                <h2 className="text-base font-semibold">Routers</h2>
                <p className="text-sm text-[var(--text-muted)]">
                  Recursos en vivo · clic para ver gráficos
                </p>
              </div>
              {topologyQuery.isLoading && (
                <p className="text-sm text-[var(--text-muted)]">Cargando red…</p>
              )}
              {!topologyQuery.isLoading && routers.length === 0 && (
                <p className="rounded-lg border border-dashed border-[var(--border)] px-4 py-8 text-center text-sm text-[var(--text-muted)]">
                  No hay routers en la topología.{' '}
                  <Link to="/app/topology" className="text-[var(--accent)]">
                    Agregar en Topología
                  </Link>
                </p>
              )}
              {routers.length > 0 && (
                <div className="grid gap-3">
                  {routers.map((d) => (
                    <RouterDeviceCard
                      key={d.id}
                      device={d}
                      onClick={() => setMetricsDevice(d)}
                    />
                  ))}
                </div>
              )}
            </section>

            <section className="rounded-xl border border-[var(--border)] bg-[var(--bg)] p-4">
              <div className="mb-3">
                <h2 className="text-base font-semibold">OLT</h2>
                <p className="text-sm text-[var(--text-muted)]">
                  Recursos en vivo · clic para ver gráficos
                </p>
              </div>
              {!topologyQuery.isLoading && olts.length === 0 && (
                <p className="rounded-lg border border-dashed border-[var(--border)] px-4 py-8 text-center text-sm text-[var(--text-muted)]">
                  No hay OLT registrados aún.{' '}
                  <Link to="/app/topology" className="text-[var(--accent)]">
                    Agregar en Topología
                  </Link>
                </p>
              )}
              {olts.length > 0 && (
                <div className="grid gap-3">
                  {olts.map((d) => (
                    <OltDeviceCard
                      key={d.id}
                      device={d}
                      onClick={() => setMetricsDevice(d)}
                    />
                  ))}
                </div>
              )}
            </section>
          </div>
        </div>
      )}

      <RouterMetricsModal
        open={!!metricsDevice}
        device={metricsDevice}
        onClose={() => setMetricsDevice(null)}
      />
    </PanelShell>
  )
}
