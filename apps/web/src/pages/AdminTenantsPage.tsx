import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { apiFetch } from '../lib/api'
import { useAuth } from '../auth/AuthContext'
import type { Tenant, TenantStatus } from '../lib/tenants'
import { PanelShell } from '../components/PanelShell'
import { CreateTenantModal } from '../components/CreateTenantModal'
import { EditTenantModal } from '../components/EditTenantModal'
import { DeleteTenantModal } from '../components/DeleteTenantModal'
import { TenantModulesModal } from '../components/TenantModulesModal'
import { useNotify } from '../components/NotifyProvider'

const statusLabel: Record<TenantStatus, string> = {
  active: 'Activa',
  inactive: 'Inactiva',
  suspended: 'Suspendida',
}

export function AdminTenantsPage() {
  const navigate = useNavigate()
  const { user, enterTenant } = useAuth()
  const { alert } = useNotify()
  const canDelete = user?.role === 'superadmin'
  const [enteringId, setEnteringId] = useState<string | null>(null)

  const [createOpen, setCreateOpen] = useState(false)
  const [editTenant, setEditTenant] = useState<Tenant | null>(null)
  const [deleteTenant, setDeleteTenant] = useState<Tenant | null>(null)
  const [modulesTenant, setModulesTenant] = useState<Tenant | null>(null)

  const tenantsQuery = useQuery({
    queryKey: ['admin', 'tenants'],
    queryFn: () => apiFetch<Tenant[]>('/admin/tenants'),
  })

  const tenants = tenantsQuery.data ?? []

  async function onEnter(tenantId: string) {
    setEnteringId(tenantId)
    try {
      await enterTenant(tenantId)
      navigate('/app', { replace: true })
    } catch (err) {
      await alert(err instanceof Error ? err.message : 'No se pudo ingresar', {
        title: 'No se pudo ingresar',
        variant: 'error',
      })
    } finally {
      setEnteringId(null)
    }
  }

  return (
    <PanelShell
      title="Empresas"
      subtitle="Administración multi-tenant"
      variant="admin"
    >
      <div className="mb-6 flex items-center justify-between gap-3">
        <p className="text-sm text-[var(--text-muted)]">
          Cada empresa obtiene su propio schema PostgreSQL y usuario owner.
        </p>
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          className="shrink-0 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)]"
        >
          Nueva empresa
        </button>
      </div>

      {tenantsQuery.error && (
        <p className="mb-4 text-sm text-[var(--danger)]">
          {tenantsQuery.error.message}
        </p>
      )}

      <div className="overflow-x-auto overflow-hidden rounded-xl border border-[var(--border)]">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="bg-[var(--bg)] text-[var(--text-muted)]">
            <tr>
              <th className="px-4 py-3 font-medium">Nombre</th>
              <th className="px-4 py-3 font-medium">Razón social</th>
              <th className="px-4 py-3 font-medium">Teléfono</th>
              <th className="px-4 py-3 font-medium">Slug</th>
              <th className="px-4 py-3 font-medium">Estado</th>
              <th className="px-4 py-3 font-medium">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {tenants.map((t) => (
              <tr key={t.id} className="border-t border-[var(--border)]">
                <td className="px-4 py-3">
                  <Link
                    to={`/admin/tenants/${t.id}`}
                    className="text-[var(--accent)] hover:underline"
                  >
                    {t.name}
                  </Link>
                </td>
                <td className="px-4 py-3 text-[var(--text-muted)]">
                  {t.legalName || '—'}
                </td>
                <td className="px-4 py-3">{t.phone || '—'}</td>
                <td className="px-4 py-3 font-mono text-xs">{t.slug}</td>
                <td className="px-4 py-3">{statusLabel[t.status]}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      onClick={() => setEditTenant(t)}
                      className="rounded-md border border-[var(--border)] px-2.5 py-1 text-xs hover:border-[var(--accent)] hover:text-[var(--accent)]"
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      onClick={() => setModulesTenant(t)}
                      className="rounded-md border border-[var(--border)] px-2.5 py-1 text-xs hover:border-[var(--accent)] hover:text-[var(--accent)]"
                    >
                      Módulos
                    </button>
                    <button
                      type="button"
                      disabled={enteringId === t.id}
                      onClick={() => void onEnter(t.id)}
                      className="rounded-md border border-[var(--border)] px-2.5 py-1 text-xs hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-60"
                    >
                      {enteringId === t.id ? 'Entrando…' : 'Ingresar'}
                    </button>
                    {canDelete && (
                      <button
                        type="button"
                        onClick={() => setDeleteTenant(t)}
                        className="rounded-md border border-[var(--danger)]/50 px-2.5 py-1 text-xs text-[var(--danger)] hover:bg-[var(--danger)]/10"
                      >
                        Eliminar
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {tenants.length === 0 && !tenantsQuery.isLoading && (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-6 text-center text-[var(--text-muted)]"
                >
                  Sin empresas. Crea la primera.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <CreateTenantModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
      />
      <EditTenantModal
        tenant={editTenant}
        onClose={() => setEditTenant(null)}
      />
      <DeleteTenantModal
        tenant={deleteTenant}
        onClose={() => setDeleteTenant(null)}
      />
      <TenantModulesModal
        tenant={modulesTenant}
        onClose={() => setModulesTenant(null)}
      />
    </PanelShell>
  )
}
