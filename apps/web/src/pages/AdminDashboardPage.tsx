import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { apiFetch } from '../lib/api'
import { PanelShell } from '../components/PanelShell'

interface DashboardData {
  message: string
  tenantCount: number
}

interface QueueStatus {
  redis: string
  queues: {
    system: Record<string, number>
    network: Record<string, number>
  }
}

export function AdminDashboardPage() {
  const dashboardQuery = useQuery({
    queryKey: ['admin', 'dashboard'],
    queryFn: () => apiFetch<DashboardData>('/admin/dashboard'),
  })

  const queuesQuery = useQuery({
    queryKey: ['admin', 'queues', 'status'],
    queryFn: () => apiFetch<QueueStatus>('/admin/queues/status'),
  })

  const error =
    dashboardQuery.error?.message || queuesQuery.error?.message || null
  const data = dashboardQuery.data

  return (
    <PanelShell
      title="Dashboard"
      subtitle="Resumen de la plataforma"
      variant="admin"
    >
      {error && (
        <p className="mb-4 text-sm text-[var(--danger)]">{error}</p>
      )}
      {dashboardQuery.isLoading && (
        <p className="mb-4 text-[var(--text-muted)]">Cargando…</p>
      )}
      {data && (
        <div className="mb-8">
          <p className="text-lg text-[var(--text)]">{data.message}</p>
          <p className="mt-1 text-[var(--text-muted)]">
            Empresas registradas: {data.tenantCount}
          </p>
        </div>
      )}

      {queuesQuery.data && (
        <div className="mb-8 rounded-xl border border-[var(--border)] bg-[var(--bg)] p-4">
          <p className="text-sm text-[var(--text-muted)]">
            Redis / colas:{' '}
            <span className="text-[var(--success)]">
              {queuesQuery.data.redis}
            </span>
          </p>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            system waiting={queuesQuery.data.queues.system.waiting ?? 0} ·
            network waiting={queuesQuery.data.queues.network.waiting ?? 0}
          </p>
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        <Link
          to="/admin/tenants"
          className="rounded-lg bg-[var(--accent)] px-4 py-2.5 text-sm font-medium text-white hover:bg-[var(--accent-hover)]"
        >
          Administrar empresas
        </Link>
      </div>
    </PanelShell>
  )
}
