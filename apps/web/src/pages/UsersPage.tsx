import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthContext'
import { apiFetch } from '../lib/api'
import {
  canManageUsers,
  TENANT_ROLE_LABEL,
  type TenantAppUser,
} from '../lib/users'
import { PanelShell } from '../components/PanelShell'
import { UserFormModal } from '../components/UserFormModal'
import { useNotify } from '../components/NotifyProvider'
import {
  ListSearchInput,
  matchesSearch,
} from '../components/ListSearchInput'

export function UsersPage() {
  const { user } = useAuth()
  const { alert, confirm } = useNotify()
  const queryClient = useQueryClient()
  const canManage = canManageUsers(user?.tenantRole)
  const [createOpen, setCreateOpen] = useState(false)
  const [editing, setEditing] = useState<TenantAppUser | null>(null)
  const [search, setSearch] = useState('')

  const usersQuery = useQuery({
    queryKey: ['app', 'users'],
    queryFn: () => apiFetch<TenantAppUser[]>('/app/users'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/app/users/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['app', 'users'] })
    },
    onError: (err) => {
      void alert(err instanceof Error ? err.message : 'No se pudo eliminar', {
        title: 'Error',
        variant: 'error',
      })
    },
  })

  async function onDelete(u: TenantAppUser) {
    const ok = await confirm(
      `¿Eliminar a ${u.name} (${u.email})? No podrá iniciar sesión.`,
      { title: 'Eliminar usuario', confirmLabel: 'Eliminar' },
    )
    if (ok) deleteMutation.mutate(u.id)
  }

  const users = useMemo(() => {
    const all = usersQuery.data ?? []
    return all.filter((u) =>
      matchesSearch(
        search,
        u.name,
        u.email,
        u.role,
        TENANT_ROLE_LABEL[u.role] ?? u.role,
        u.isActive ? 'activo' : 'inactivo',
      ),
    )
  }, [usersQuery.data, search])

  return (
    <PanelShell
      title="Usuarios"
      subtitle="Acceso al panel de la empresa"
      variant="tenant"
    >
      <div className="mb-4 flex flex-col gap-3 md:mb-6 md:flex-row md:items-center md:justify-between">
        <ListSearchInput
          value={search}
          onChange={setSearch}
          placeholder="Buscar nombre, email, rol…"
          className="md:max-w-sm"
        />
        {canManage && (
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="hidden shrink-0 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)] md:inline-flex"
          >
            Nuevo usuario
          </button>
        )}
      </div>

      {usersQuery.error && (
        <p className="mb-4 text-sm text-[var(--danger)]">
          {usersQuery.error.message}
        </p>
      )}

      {/* Mobile: tarjetas */}
      <div className="space-y-3 pb-28 md:hidden">
        {usersQuery.isLoading && (
          <p className="text-sm text-[var(--text-muted)]">Cargando…</p>
        )}
        {!usersQuery.isLoading && users.length === 0 && (
          <p className="rounded-xl border border-dashed border-[var(--border)] px-4 py-10 text-center text-sm text-[var(--text-muted)]">
            {search.trim()
              ? 'Sin resultados para esa búsqueda.'
              : canManage
                ? 'Sin usuarios. Toca + para crear el primero.'
                : 'Sin usuarios todavía.'}
          </p>
        )}
        {users.map((u) => (
          <article
            key={u.id}
            className="rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2.5"
          >
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1 truncate text-sm font-semibold">
                {u.name}
              </div>
              <UserStatusBadge active={u.isActive} />
              {canManage && (
                <button
                  type="button"
                  onClick={() => setEditing(u)}
                  className="shrink-0 text-xs font-medium text-[var(--accent)] hover:underline"
                >
                  Editar
                </button>
              )}
            </div>
            <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-[var(--text-muted)]">
              <span className="min-w-0 truncate">{u.email}</span>
              <span className="shrink-0 text-right">
                {TENANT_ROLE_LABEL[u.role] ?? u.role}
              </span>
            </div>
            {canManage && u.id !== user?.id && (
              <div className="mt-2 flex justify-end">
                <button
                  type="button"
                  onClick={() => void onDelete(u)}
                  disabled={deleteMutation.isPending}
                  className="text-[11px] text-[var(--danger)] hover:underline disabled:opacity-50"
                >
                  Eliminar
                </button>
              </div>
            )}
          </article>
        ))}
      </div>

      {/* Desktop: tabla */}
      <div className="hidden w-full overflow-x-auto overflow-hidden rounded-xl border border-[var(--border)] md:block">
        <table className="w-full table-fixed text-left text-sm">
          <colgroup>
            <col className="w-[22%]" />
            <col className="w-[28%]" />
            <col className="w-[18%]" />
            <col className="w-[14%]" />
            {canManage && <col className="w-[18%]" />}
          </colgroup>
          <thead className="bg-[var(--bg)] text-[var(--text-muted)]">
            <tr>
              <th className="px-4 py-3 font-medium">Nombre</th>
              <th className="px-4 py-3 font-medium">Email</th>
              <th className="px-4 py-3 font-medium">Rol</th>
              <th className="px-4 py-3 font-medium">Estado</th>
              {canManage && (
                <th className="px-4 py-3 font-medium">Acciones</th>
              )}
            </tr>
          </thead>
          <tbody>
            {usersQuery.isLoading && (
              <tr>
                <td
                  colSpan={canManage ? 5 : 4}
                  className="px-4 py-6 text-[var(--text-muted)]"
                >
                  Cargando…
                </td>
              </tr>
            )}
            {!usersQuery.isLoading && users.length === 0 && (
              <tr>
                <td
                  colSpan={canManage ? 5 : 4}
                  className="px-4 py-6 text-center text-[var(--text-muted)]"
                >
                  {search.trim()
                    ? 'Sin resultados para esa búsqueda.'
                    : 'No hay usuarios todavía.'}
                </td>
              </tr>
            )}
            {users.map((u) => (
              <tr key={u.id} className="border-t border-[var(--border)]">
                <td className="truncate px-4 py-3 font-medium">{u.name}</td>
                <td className="truncate px-4 py-3 text-[var(--text-muted)]">
                  {u.email}
                </td>
                <td className="truncate px-4 py-3">
                  {TENANT_ROLE_LABEL[u.role] ?? u.role}
                </td>
                <td className="px-4 py-3">
                  <UserStatusBadge active={u.isActive} />
                </td>
                {canManage && (
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => setEditing(u)}
                        className="rounded-md bg-[var(--accent)] px-2.5 py-1 text-xs font-medium text-white hover:bg-[var(--accent-hover)]"
                      >
                        Editar
                      </button>
                      {u.id !== user?.id && (
                        <button
                          type="button"
                          onClick={() => void onDelete(u)}
                          disabled={deleteMutation.isPending}
                          className="rounded-md border border-[var(--border)] px-2.5 py-1 text-xs text-[var(--danger)] hover:border-[var(--danger)]"
                        >
                          Eliminar
                        </button>
                      )}
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {canManage && (
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          aria-label="Nuevo usuario"
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
      )}

      <UserFormModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        actorRole={user?.tenantRole}
      />
      <UserFormModal
        open={!!editing}
        onClose={() => setEditing(null)}
        user={editing}
        actorRole={user?.tenantRole}
      />
    </PanelShell>
  )
}

function UserStatusBadge({ active }: { active: boolean }) {
  if (active) {
    return (
      <span className="inline-flex shrink-0 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
        Activo
      </span>
    )
  }
  return (
    <span className="inline-flex shrink-0 rounded-full bg-[var(--danger)]/15 px-2 py-0.5 text-[10px] font-medium text-[var(--danger)]">
      Inactivo
    </span>
  )
}
