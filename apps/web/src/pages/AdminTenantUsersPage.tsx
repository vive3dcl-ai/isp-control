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

const STATUS_TONE: Record<string, string> = {
  stored: 'bg-[var(--bg)] text-[var(--text-muted)]',
  invited: 'bg-sky-500/15 text-sky-300',
  active: 'bg-emerald-500/15 text-emerald-300',
  disabled: 'bg-[var(--danger)]/15 text-[var(--danger)]',
}

function personName(u: PortalUserRow) {
  return (
    [u.firstName, u.lastName].filter(Boolean).join(' ').trim() ||
    u.name ||
    '—'
  )
}

function addressLine(u: PortalUserRow) {
  return [u.street, u.city, u.zipCode].filter(Boolean).join(', ')
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

  function RowActions({ u }: { u: PortalUserRow }) {
    if (u.status !== 'disabled') {
      return (
        <button
          type="button"
          className="rounded-md border border-[var(--danger)]/50 px-2.5 py-1 text-xs text-[var(--danger)] hover:bg-[var(--danger)]/10"
          onClick={() =>
            statusMutation.mutate({
              id: u.id,
              next: 'disabled',
            })
          }
        >
          Deshabilitar
        </button>
      )
    }
    return (
      <button
        type="button"
        className="rounded-md border border-emerald-500/40 px-2.5 py-1 text-xs text-emerald-300 hover:bg-emerald-500/10"
        onClick={() =>
          statusMutation.mutate({
            id: u.id,
            next: 'stored',
          })
        }
      >
        Rehabilitar
      </button>
    )
  }

  return (
    <PanelShell
      title="Clientes Tenant"
      subtitle="Clientes de todos los tenants"
      variant="admin"
    >
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        <select
          value={tenantId}
          onChange={(e) => setTenantId(e.target.value)}
          className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm sm:w-auto"
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
          className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm sm:w-auto"
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
          className="w-full min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm"
        />
      </div>

      {usersQuery.error && (
        <p className="mb-4 text-sm text-[var(--danger)]">
          {usersQuery.error.message}
        </p>
      )}

      {/* Mobile: tarjetas */}
      <div className="space-y-3 pb-6 md:hidden">
        {usersQuery.isLoading && (
          <p className="text-sm text-[var(--text-muted)]">Cargando…</p>
        )}
        {!usersQuery.isLoading && rows.length === 0 && (
          <p className="rounded-xl border border-dashed border-[var(--border)] px-4 py-10 text-center text-sm text-[var(--text-muted)]">
            Sin clientes guardados. Se crean al guardar un cliente en el CRM del
            tenant.
          </p>
        )}
        {rows.map((u) => (
          <article
            key={u.id}
            className="rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-base font-semibold">
                  {personName(u)}
                </p>
                <p className="mt-0.5 truncate text-sm text-[var(--text-muted)]">
                  {tenantName(u.tenantId, u.tenantName)}
                  {u.tenantSlug ? ` · /${u.tenantSlug}` : ''}
                </p>
              </div>
              <span
                className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-medium ${STATUS_TONE[u.status] ?? STATUS_TONE.stored}`}
              >
                {STATUS_LABEL[u.status] ?? u.status}
              </span>
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
              <div className="col-span-2">
                <dt className="text-[var(--text-muted)]">Empresa cliente</dt>
                <dd className="mt-0.5 truncate">{u.companyName || '—'}</dd>
              </div>
              <div>
                <dt className="text-[var(--text-muted)]">Email</dt>
                <dd className="mt-0.5 truncate">{u.email || '—'}</dd>
              </div>
              <div>
                <dt className="text-[var(--text-muted)]">Teléfono</dt>
                <dd className="mt-0.5 truncate">{u.phone || '—'}</dd>
              </div>
              <div className="col-span-2">
                <dt className="text-[var(--text-muted)]">Dirección</dt>
                <dd className="mt-0.5">{addressLine(u) || '—'}</dd>
              </div>
            </dl>
            {(u.isLead || u.archivedAt || !u.isActive) && (
              <p className="mt-2 text-[11px] text-[var(--text-muted)]">
                {[
                  u.isLead ? 'Lead' : null,
                  u.archivedAt ? 'Archivado' : null,
                  !u.isActive ? 'Inactivo CRM' : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            )}
            <div className="mt-3 border-t border-[var(--border)] pt-3">
              <RowActions u={u} />
            </div>
          </article>
        ))}
      </div>

      {/* Desktop: tabla a ancho completo */}
      <div className="hidden w-full overflow-x-auto overflow-hidden rounded-xl border border-[var(--border)] md:block">
        <table className="w-full table-fixed text-left text-sm">
          <colgroup>
            <col className="w-[14%]" />
            <col className="w-[14%]" />
            <col className="w-[14%]" />
            <col className="w-[16%]" />
            <col className="w-[18%]" />
            <col className="w-[10%]" />
            <col className="w-[8%]" />
            <col className="w-[6%]" />
          </colgroup>
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
            {rows.map((u) => (
              <tr key={u.id} className="border-t border-[var(--border)]">
                <td className="px-4 py-3">
                  <div className="truncate">
                    {tenantName(u.tenantId, u.tenantName)}
                  </div>
                  {u.tenantSlug ? (
                    <span className="mt-0.5 block truncate text-xs text-[var(--text-muted)]">
                      /{u.tenantSlug}
                    </span>
                  ) : null}
                </td>
                <td className="px-4 py-3">
                  <div className="truncate font-medium">{personName(u)}</div>
                  {u.documentNumber ? (
                    <div className="truncate text-xs text-[var(--text-muted)]">
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
                  <div className="truncate">{u.companyName || '—'}</div>
                  {u.companyTaxId ? (
                    <div className="truncate text-xs text-[var(--text-muted)]">
                      {u.companyTaxId}
                    </div>
                  ) : null}
                </td>
                <td className="px-4 py-3 text-[var(--text-muted)]">
                  <div className="truncate">{u.email || '—'}</div>
                  <div className="truncate text-xs">{u.phone || ''}</div>
                </td>
                <td className="px-4 py-3 text-[var(--text-muted)]">
                  <div className="truncate">{addressLine(u) || '—'}</div>
                  {u.latitude != null && u.longitude != null ? (
                    <div className="text-[10px]">
                      {u.latitude.toFixed(5)}, {u.longitude.toFixed(5)}
                    </div>
                  ) : null}
                </td>
                <td className="px-4 py-3">
                  <div>{STATUS_LABEL[u.status] ?? u.status}</div>
                  {u.archivedAt ? (
                    <span className="text-xs text-amber-300">(archivado)</span>
                  ) : null}
                  {!u.isActive ? (
                    <span className="text-xs text-[var(--text-muted)]">
                      inactivo
                    </span>
                  ) : null}
                </td>
                <td className="px-4 py-3 text-[var(--text-muted)]">
                  {new Date(u.createdAt).toLocaleDateString()}
                </td>
                <td className="px-4 py-3">
                  <RowActions u={u} />
                </td>
              </tr>
            ))}
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
    </PanelShell>
  )
}
