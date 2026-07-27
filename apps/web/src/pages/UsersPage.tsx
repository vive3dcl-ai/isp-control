import { useState } from 'react'
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

export function UsersPage() {
  const { user } = useAuth()
  const { alert, confirm } = useNotify()
  const queryClient = useQueryClient()
  const canManage = canManageUsers(user?.tenantRole)
  const [createOpen, setCreateOpen] = useState(false)
  const [editing, setEditing] = useState<TenantAppUser | null>(null)

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

  const users = usersQuery.data ?? []

  return (
    <PanelShell
      title="Usuarios"
      subtitle="Acceso al panel de la empresa"
      variant="tenant"
    >
      <div className="mb-6 flex items-center justify-between gap-3">
        <p className="text-sm text-[var(--text-muted)]">
          Administra quién puede entrar al panel y con qué rol.
        </p>
        {canManage && (
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="shrink-0 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)]"
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

      <div className="overflow-x-auto overflow-hidden rounded-xl border border-[var(--border)]">
        <table className="w-full min-w-[640px] text-left text-sm">
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
                  className="px-4 py-6 text-[var(--text-muted)]"
                >
                  No hay usuarios.
                </td>
              </tr>
            )}
            {users.map((u) => (
              <tr key={u.id} className="border-t border-[var(--border)]">
                <td className="px-4 py-3 font-medium">{u.name}</td>
                <td className="px-4 py-3 text-[var(--text-muted)]">
                  {u.email}
                </td>
                <td className="px-4 py-3">
                  {TENANT_ROLE_LABEL[u.role] ?? u.role}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={[
                      'inline-flex rounded-full px-2 py-0.5 text-xs font-medium',
                      u.isActive
                        ? 'bg-emerald-500/15 text-emerald-300'
                        : 'bg-[var(--danger)]/15 text-[var(--danger)]',
                    ].join(' ')}
                  >
                    {u.isActive ? 'Activo' : 'Inactivo'}
                  </span>
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
