import { useMemo, useState } from 'react'
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
import {
  ListSearchInput,
  matchesSearch,
} from '../components/ListSearchInput'

const statusLabel: Record<TenantStatus, string> = {
  active: 'Activa',
  inactive: 'Inactiva',
  suspended: 'Suspendida',
}

const statusTone: Record<TenantStatus, string> = {
  active: 'bg-emerald-500/15 text-emerald-700',
  inactive: 'bg-[var(--bg)] text-[var(--text-muted)]',
  suspended: 'bg-[var(--danger)]/15 text-[var(--danger)]',
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
  const [search, setSearch] = useState('')

  const tenantsQuery = useQuery({
    queryKey: ['admin', 'tenants'],
    queryFn: () => apiFetch<Tenant[]>('/admin/tenants'),
  })

  const tenants = useMemo(() => {
    const all = tenantsQuery.data ?? []
    return all.filter((t) =>
      matchesSearch(
        search,
        t.name,
        t.legalName,
        t.slug,
        t.phone,
        t.status,
        statusLabel[t.status],
      ),
    )
  }, [tenantsQuery.data, search])

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

  function TenantActions({ t }: { t: Tenant }) {
    return (
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
    )
  }

  return (
    <PanelShell
      title="Empresas"
      subtitle="Administración multi-tenant"
      variant="admin"
    >
      <div className="mb-4 flex flex-col gap-3 md:mb-6 md:flex-row md:items-center md:justify-between">
        <ListSearchInput
          value={search}
          onChange={setSearch}
          placeholder="Buscar empresa, slug, teléfono…"
          className="md:max-w-sm"
        />
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          className="hidden shrink-0 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)] md:inline-flex"
        >
          Nueva empresa
        </button>
      </div>

      {tenantsQuery.error && (
        <p className="mb-4 text-sm text-[var(--danger)]">
          {tenantsQuery.error.message}
        </p>
      )}

      {/* Mobile: tarjetas */}
      <div className="space-y-3 pb-28 md:hidden">
        {tenants.map((t) => (
          <article
            key={t.id}
            className="rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <Link
                  to={`/admin/tenants/${t.id}`}
                  className="block truncate text-base font-semibold text-[var(--accent)] hover:underline"
                >
                  {t.name}
                </Link>
                <p className="mt-0.5 truncate text-sm text-[var(--text-muted)]">
                  {t.legalName || 'Sin razón social'}
                </p>
              </div>
              <span
                className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-medium ${statusTone[t.status]}`}
              >
                {t.isInternalCompany ? 'Interna' : statusLabel[t.status]}
              </span>
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
              <div>
                <dt className="text-[var(--text-muted)]">Slug</dt>
                <dd className="mt-0.5 font-mono">{t.slug}</dd>
              </div>
              <div>
                <dt className="text-[var(--text-muted)]">Teléfono</dt>
                <dd className="mt-0.5">{t.phone || '—'}</dd>
              </div>
            </dl>
            <div className="mt-3 border-t border-[var(--border)] pt-3">
              <TenantActions t={t} />
            </div>
          </article>
        ))}
        {tenants.length === 0 && !tenantsQuery.isLoading && (
          <p className="rounded-xl border border-dashed border-[var(--border)] px-4 py-10 text-center text-sm text-[var(--text-muted)]">
            Sin empresas. Toca + para crear la primera.
          </p>
        )}
      </div>

      {/* Desktop: tabla */}
      <div className="hidden overflow-x-auto overflow-hidden rounded-xl border border-[var(--border)] md:block">
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
                <td className="px-4 py-3">
                  {t.isInternalCompany
                    ? 'Empresa interna'
                    : statusLabel[t.status]}
                </td>
                <td className="px-4 py-3">
                  <TenantActions t={t} />
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

      {/* FAB móvil */}
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          aria-label="Nueva empresa"
          className="app-fab-mobile fixed z-40 flex h-14 w-14 items-center justify-center rounded-full bg-[var(--accent)] text-white shadow-lg shadow-black/25 hover:bg-[var(--accent-hover)] md:hidden"
        >
          <svg
            width="28"
            height="28"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            aria-hidden
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>

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
