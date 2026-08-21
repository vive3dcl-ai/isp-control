import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { apiFetch } from '../lib/api'
import { formatMoney, useCompanyCurrency } from '../lib/currency'
import { buildOnuAlertHref } from '../lib/notification-nav'
import { PanelShell } from '../components/PanelShell'
import {
  OltDeviceCard,
  RouterDeviceCard,
  SwitchDeviceCard,
} from '../components/DashboardNetworkCards'
import { RouterMetricsModal } from '../components/RouterMetricsModal'
import type { TopologyDevice } from '../lib/topology'

interface DashboardAlert {
  id: string
  severity: 'info' | 'warning' | 'critical'
  title: string
  message: string
  onuId?: string | null
  oltId?: string | null
}

interface DashboardData {
  message: string
  tenantSlug?: string
  clientCount: number
  activeServices: number
  suspendedClients: number
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
  const [alertsOpen, setAlertsOpen] = useState(false)
  const alertsRef = useRef<HTMLDivElement>(null)

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

  const { routers, olts, switches } = useMemo(() => {
    const devices = topologyQuery.data?.devices ?? []
    return {
      routers: devices.filter((d) => d.type === 'router' && d.isActive),
      olts: devices.filter((d) => d.type === 'olt' && d.isActive),
      switches: devices.filter((d) => d.type === 'switch' && d.isActive),
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

  useEffect(() => {
    if (!alertsOpen) return
    function onDocClick(e: MouseEvent) {
      if (!alertsRef.current?.contains(e.target as Node)) setAlertsOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setAlertsOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [alertsOpen])

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
            <Link
              to="/app/settings?tab=onus"
              className="rounded-xl border border-[var(--border)] bg-[var(--bg)] p-4 transition hover:border-[var(--accent)]"
            >
              <dt className="text-sm text-[var(--text-muted)]">
                Servicios activos
              </dt>
              <dd className="mt-1 text-xl font-medium">
                {data.activeServices ?? 0}
              </dd>
            </Link>
            <Link
              to="/app/clients?status=suspended"
              className="rounded-xl border border-[var(--border)] bg-[var(--bg)] p-4 transition hover:border-[var(--accent)]"
            >
              <dt className="text-sm text-[var(--text-muted)]">
                Clientes suspendidos
              </dt>
              <dd className="mt-1 text-xl font-medium">
                {data.suspendedClients ?? 0}
              </dd>
            </Link>
            <Link
              to="/app/accounting?view=sales"
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
              to="/app/accounting?view=receivables"
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
            <div className="relative" ref={alertsRef}>
              <button
                type="button"
                onClick={() => setAlertsOpen((v) => !v)}
                aria-expanded={alertsOpen}
                className="w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] p-4 text-left transition hover:border-[var(--accent)]"
              >
                <dt className="text-sm text-[var(--text-muted)]">Alertas</dt>
                <dd className="mt-1 text-xl font-medium">
                  {data.alertsCount ?? 0}
                </dd>
                <p className="mt-1 text-[11px] text-[var(--text-muted)]">
                  {(data.alertsCount ?? 0) === 0
                    ? 'Sin alertas por ahora'
                    : 'Clic para ver detalle'}
                </p>
              </button>
              {alertsOpen && (data.alerts?.length ?? 0) > 0 && (
                <div className="absolute left-0 right-0 z-20 mt-2 max-h-72 overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] shadow-lg">
                  {data.alerts.map((a) => (
                    <Link
                      key={a.id}
                      to={
                        a.onuId
                          ? buildOnuAlertHref(a.onuId)
                          : '/app/settings?tab=onus'
                      }
                      onClick={() => setAlertsOpen(false)}
                      className="block border-b border-[var(--border)] px-3 py-2.5 transition last:border-0 hover:bg-[var(--bg)]"
                    >
                      <p className="text-sm font-medium leading-snug">
                        {a.title}
                      </p>
                      <p className="mt-0.5 line-clamp-2 text-xs text-[var(--text-muted)]">
                        {a.message}
                      </p>
                    </Link>
                  ))}
                </div>
              )}
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

            <section className="rounded-xl border border-[var(--border)] bg-[var(--bg)] p-4">
              <div className="mb-3">
                <h2 className="text-base font-semibold">Switches</h2>
                <p className="text-sm text-[var(--text-muted)]">
                  Recursos en vivo · clic para ver gráficos
                </p>
              </div>
              {!topologyQuery.isLoading && switches.length === 0 && (
                <p className="rounded-lg border border-dashed border-[var(--border)] px-4 py-8 text-center text-sm text-[var(--text-muted)]">
                  No hay switches registrados aún.{' '}
                  <Link to="/app/topology" className="text-[var(--accent)]">
                    Agregar en Topología
                  </Link>
                </p>
              )}
              {switches.length > 0 && (
                <div className="grid gap-3">
                  {switches.map((d) => (
                    <SwitchDeviceCard
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
