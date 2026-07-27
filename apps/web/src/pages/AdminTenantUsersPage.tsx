import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'
import { PanelShell } from '../components/PanelShell'
import { useNotify } from '../components/NotifyProvider'

type PortalUserRow = {
  id: string
  tenantId: string
  tenantName: string | null
  tenantSlug: string | null
  clientId: string
  email: string
  name: string
  firstName: string
  lastName: string
  companyName: string
  documentType: string
  documentNumber: string
  isCompany: boolean
  companyTaxId: string
  isLead: boolean
  phone: string
  street: string
  city: string
  zipCode: string
  latitude: number | null
  longitude: number | null
  note: string
  isActive: boolean
  zoneId: string | null
  status: string
  archivedAt: string | null
  createdAt: string
  updatedAt: string
}

type TenantOption = { id: string; name: string; slug: string }

const STATUS_LABEL: Record<string, string> = {
  stored: 'Guardado',
  invited: 'Invitado',
  active: 'Activo',
  disabled: 'Deshabilitado',
}

export function AdminTenantUsersPage() {
  const { alert } = useNotify()
  const queryClient = useQueryClient()
  const [tenantId, setTenantId] = useState('')
  const [status, setStatus] = useState('')
  const [q, setQ] = useState('')

  const tenantsQuery = useQuery({
    queryKey: ['admin', 'tenants'],
    queryFn: () => apiFetch<TenantOption[]>('/admin/tenants'),
  })

  const usersQuery = useQuery({
    queryKey: ['admin', 'client-portal-users', tenantId, status, q],
    queryFn: () => {
      const params = new URLSearchParams()
      if (tenantId) params.set('tenantId', tenantId)
      if (status) params.set('status', status)
      if (q.trim()) params.set('q', q.trim())
      const qs = params.toString()
      return apiFetch<PortalUserRow[]>(
        `/admin/client-portal-users${qs ? `?${qs}` : ''}`,
      )
    },
  })

  const statusMutation = useMutation({
    mutationFn: ({ id, next }: { id: string; next: string }) =>
      apiFetch(`/admin/client-portal-users/${id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: next }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ['admin', 'client-portal-users'],
      })
    },
    onError: (err: Error) => void alert(err.message),
  })

  const rows = usersQuery.data ?? []
  const tenantName = useMemo(() => {
    const map = new Map(
      (tenantsQuery.data ?? []).map((t) => [t.id, t.name] as const),
    )
    return (id: string, fallback: string | null) => map.get(id) || fallback || id
  }, [tenantsQuery.data])

  return (
    <PanelShell variant="admin">
      <div className="p-6">
        <h1 className="mb-1 text-xl font-semibold">Clientes Tenant</h1>
        <p className="mb-6 text-sm text-[var(--text-muted)]">
          Clientes de todos los tenants (nombre, empresa, dirección y datos de
          contacto). Sin servicios. Se conservan aunque el tenant archive o
          borre el CRM.
        </p>

        <div className="mb-4 flex flex-wrap gap-3">
          <select
            value={tenantId}
            onChange={(e) => setTenantId(e.target.value)}
            className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm"
          >
            <option value="">Todas las empresas</option>
            {(tenantsQuery.data ?? []).map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm"
          >
            <option value="">Todos los estados</option>
            <option value="stored">Guardado</option>
            <option value="invited">Invitado</option>
            <option value="active">Activo</option>
            <option value="disabled">Deshabilitado</option>
          </select>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar nombre, empresa, email, ciudad…"
            className="min-w-[200px] flex-1 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm"
          />
        </div>

        {usersQuery.error && (
          <p className="mb-3 text-sm text-[var(--danger)]">
            {usersQuery.error.message}
          </p>
        )}

        <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
          <table className="w-full min-w-[1100px] text-left text-sm">
            <thead className="bg-[var(--bg)] text-[var(--text-muted)]">
              <tr>
                <th className="px-4 py-3 font-medium">Empresa</th>
                <th className="px-4 py-3 font-medium">Nombre</th>
                <th className="px-4 py-3 font-medium">Empresa cliente</th>
                <th className="px-4 py-3 font-medium">Contacto</th>
                <th className="px-4 py-3 font-medium">Dirección</th>
                <th className="px-4 py-3 font-medium">Estado</th>
                <th className="px-4 py-3 font-medium">Creado</th>
                <th className="px-4 py-3 font-medium">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {usersQuery.isLoading && (
                <tr>
                  <td
                    colSpan={8}
                    className="px-4 py-8 text-center text-[var(--text-muted)]"
                  >
                    Cargando…
                  </td>
                </tr>
              )}
              {rows.map((u) => {
                const person = [u.firstName, u.lastName]
                  .filter(Boolean)
                  .join(' ')
                  .trim()
                const address = [u.street, u.city, u.zipCode]
                  .filter(Boolean)
                  .join(', ')
                return (
                  <tr key={u.id} className="border-t border-[var(--border)]">
                    <td className="px-4 py-3">
                      {tenantName(u.tenantId, u.tenantName)}
                      {u.tenantSlug ? (
                        <span className="mt-0.5 block text-xs text-[var(--text-muted)]">
                          /{u.tenantSlug}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium">
                        {person || u.name || '—'}
                      </div>
                      {u.documentNumber ? (
                        <div className="text-xs text-[var(--text-muted)]">
                          {u.documentType ? `${u.documentType} ` : ''}
                          {u.documentNumber}
                        </div>
                      ) : null}
                      {u.isLead ? (
                        <span className="mt-0.5 inline-block text-[10px] text-amber-300">
                          Lead
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      {u.companyName || (u.isCompany ? '—' : '—')}
                      {u.companyTaxId ? (
                        <div className="text-xs text-[var(--text-muted)]">
                          {u.companyTaxId}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-[var(--text-muted)]">
                      <div>{u.email || '—'}</div>
                      <div className="text-xs">{u.phone || ''}</div>
                    </td>
                    <td className="px-4 py-3 text-[var(--text-muted)]">
                      {address || '—'}
                      {u.latitude != null && u.longitude != null ? (
                        <div className="text-[10px]">
                          {u.latitude.toFixed(5)}, {u.longitude.toFixed(5)}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      {STATUS_LABEL[u.status] ?? u.status}
                      {u.archivedAt ? (
                        <span className="ml-1 text-xs text-amber-300">
                          (archivado)
                        </span>
                      ) : null}
                      {!u.isActive ? (
                        <span className="ml-1 text-xs text-[var(--text-muted)]">
                          inactivo
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-[var(--text-muted)]">
                      {new Date(u.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3">
                      {u.status !== 'disabled' ? (
                        <button
                          type="button"
                          className="text-xs text-red-300 hover:underline"
                          onClick={() =>
                            statusMutation.mutate({
                              id: u.id,
                              next: 'disabled',
                            })
                          }
                        >
                          Deshabilitar
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="text-xs text-emerald-300 hover:underline"
                          onClick={() =>
                            statusMutation.mutate({
                              id: u.id,
                              next: 'stored',
                            })
                          }
                        >
                          Rehabilitar
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
              {!usersQuery.isLoading && !rows.length && (
                <tr>
                  <td
                    colSpan={8}
                    className="px-4 py-8 text-center text-[var(--text-muted)]"
                  >
                    Sin clientes guardados. Se crean al guardar un cliente en el
                    CRM del tenant.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </PanelShell>
  )
}
