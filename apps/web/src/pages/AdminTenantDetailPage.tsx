import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { apiFetch } from '../lib/api'
import type { Tenant, TenantDetail, TenantStatus } from '../lib/tenants'
import { PanelShell } from '../components/PanelShell'

const statusLabel: Record<TenantStatus, string> = {
  active: 'Activa',
  inactive: 'Inactiva',
  suspended: 'Suspendida',
}

export function AdminTenantDetailPage() {
  const { id = '' } = useParams()
  const queryClient = useQueryClient()

  const detailQuery = useQuery({
    queryKey: ['admin', 'tenants', id],
    queryFn: () => apiFetch<TenantDetail>(`/admin/tenants/${id}`),
    enabled: Boolean(id),
  })

  const statusMutation = useMutation({
    mutationFn: (status: TenantStatus) =>
      apiFetch<Tenant>(`/admin/tenants/${id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'tenants'] })
      void queryClient.invalidateQueries({
        queryKey: ['admin', 'tenants', id],
      })
    },
  })

  const tenant = detailQuery.data

  return (
    <PanelShell
      title={tenant?.name ?? 'Empresa'}
      subtitle="Detalle del tenant"
      variant="admin"
    >
      <Link
        to="/admin/tenants"
        className="mb-6 inline-block text-sm text-[var(--accent)] hover:underline"
      >
        ← Volver a empresas
      </Link>

      {detailQuery.error && (
        <p className="mb-4 text-sm text-[var(--danger)]">
          {detailQuery.error.message}
        </p>
      )}
      {detailQuery.isLoading && (
        <p className="text-[var(--text-muted)]">Cargando…</p>
      )}

      {tenant && (
        <div className="space-y-6">
          <dl className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-[var(--border)] bg-[var(--bg)] p-4">
              <dt className="text-sm text-[var(--text-muted)]">Nombre</dt>
              <dd className="mt-1">{tenant.name}</dd>
            </div>
            <div className="rounded-xl border border-[var(--border)] bg-[var(--bg)] p-4">
              <dt className="text-sm text-[var(--text-muted)]">Razón social</dt>
              <dd className="mt-1">{tenant.legalName || '—'}</dd>
            </div>
            <div className="rounded-xl border border-[var(--border)] bg-[var(--bg)] p-4">
              <dt className="text-sm text-[var(--text-muted)]">Teléfono</dt>
              <dd className="mt-1">{tenant.phone || '—'}</dd>
            </div>
            <div className="rounded-xl border border-[var(--border)] bg-[var(--bg)] p-4 sm:col-span-2">
              <dt className="text-sm text-[var(--text-muted)]">Dirección</dt>
              <dd className="mt-1">{tenant.address || '—'}</dd>
            </div>
            <div className="rounded-xl border border-[var(--border)] bg-[var(--bg)] p-4">
              <dt className="text-sm text-[var(--text-muted)]">Slug</dt>
              <dd className="mt-1 font-mono">{tenant.slug}</dd>
            </div>
            <div className="rounded-xl border border-[var(--border)] bg-[var(--bg)] p-4">
              <dt className="text-sm text-[var(--text-muted)]">Schema</dt>
              <dd className="mt-1 font-mono text-sm">{tenant.schemaName}</dd>
            </div>
            <div className="rounded-xl border border-[var(--border)] bg-[var(--bg)] p-4">
              <dt className="text-sm text-[var(--text-muted)]">Estado</dt>
              <dd className="mt-2 flex items-center gap-3">
                <span>{statusLabel[tenant.status]}</span>
                <select
                  className="rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] px-2 py-1 text-xs"
                  value={tenant.status}
                  disabled={statusMutation.isPending}
                  onChange={(e) =>
                    statusMutation.mutate(e.target.value as TenantStatus)
                  }
                >
                  <option value="active">Activa</option>
                  <option value="inactive">Inactiva</option>
                  <option value="suspended">Suspendida</option>
                </select>
              </dd>
            </div>
            <div className="rounded-xl border border-[var(--border)] bg-[var(--bg)] p-4">
              <dt className="text-sm text-[var(--text-muted)]">Creada</dt>
              <dd className="mt-1 text-sm">
                {new Date(tenant.createdAt).toLocaleString()}
              </dd>
            </div>
          </dl>

          <div>
            <h2 className="mb-3 text-sm font-semibold tracking-wide text-[var(--text-muted)] uppercase">
              Usuarios en directory
            </h2>
            <div className="overflow-hidden rounded-xl border border-[var(--border)]">
              <table className="w-full text-left text-sm">
                <thead className="bg-[var(--bg)] text-[var(--text-muted)]">
                  <tr>
                    <th className="px-4 py-3 font-medium">Email</th>
                    <th className="px-4 py-3 font-medium">Rol</th>
                  </tr>
                </thead>
                <tbody>
                  {tenant.users.map((u) => (
                    <tr key={u.id} className="border-t border-[var(--border)]">
                      <td className="px-4 py-3">{u.email}</td>
                      <td className="px-4 py-3">{u.role}</td>
                    </tr>
                  ))}
                  {tenant.users.length === 0 && (
                    <tr>
                      <td
                        colSpan={2}
                        className="px-4 py-6 text-center text-[var(--text-muted)]"
                      >
                        Sin usuarios en directory
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </PanelShell>
  )
}
