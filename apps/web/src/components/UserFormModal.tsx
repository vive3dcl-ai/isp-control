import { useEffect, useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'
import {
  assignableRoles,
  TENANT_ROLE_LABEL,
  type TenantAppUser,
} from '../lib/users'
import type { TenantUserRole } from '../lib/api'
import { ModalPortal } from './ModalPortal'


const inputClass =
  'w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 outline-none ring-[var(--accent)] focus:ring-2'

type UserForm = {
  name: string
  email: string
  password: string
  role: TenantUserRole
  isActive: boolean
}

export function UserFormModal({
  open,
  onClose,
  user,
  actorRole,
}: {
  open: boolean
  onClose: () => void
  user?: TenantAppUser | null
  actorRole?: string | null
}) {
  const queryClient = useQueryClient()
  const editing = !!user
  const roles = assignableRoles(actorRole)
  const [form, setForm] = useState<UserForm>({
    name: '',
    email: '',
    password: '',
    role: 'user',
    isActive: true,
  })
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setError(null)
    if (user) {
      setForm({
        name: user.name,
        email: user.email,
        password: '',
        role: user.role,
        isActive: user.isActive,
      })
    } else {
      setForm({
        name: '',
        email: '',
        password: '',
        role: roles.includes('user') ? 'user' : roles[0],
        isActive: true,
      })
    }
  }, [open, user, actorRole])

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (editing && user) {
        const body: Record<string, unknown> = {
          name: form.name.trim(),
          email: form.email.trim(),
          role: form.role,
          isActive: form.isActive,
        }
        if (form.password.trim()) {
          body.password = form.password
        }
        return apiFetch<TenantAppUser>(`/app/users/${user.id}`, {
          method: 'PATCH',
          body: JSON.stringify(body),
        })
      }
      return apiFetch<TenantAppUser>('/app/users', {
        method: 'POST',
        body: JSON.stringify({
          name: form.name.trim(),
          email: form.email.trim(),
          password: form.password,
          role: form.role,
        }),
      })
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['app', 'users'] })
      onClose()
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : 'No se pudo guardar')
    },
  })

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!editing && form.password.length < 8) {
      setError('La contraseña debe tener al menos 8 caracteres')
      return
    }
    if (editing && form.password && form.password.length < 8) {
      setError('La contraseña debe tener al menos 8 caracteres')
      return
    }
    saveMutation.mutate()
  }

  if (!open) return null

  return (
    <ModalPortal><div className="fixed inset-0 z-[100] modal-backdrop flex items-stretch justify-center overflow-hidden bg-black/50 sm:items-center sm:p-4">
      <button
        type="button"
        aria-label="Cerrar"
        className="absolute inset-0"
        onClick={onClose}
      />
      <form
        onSubmit={onSubmit}
        className="relative z-10 w-full max-w-md space-y-4 rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-5 shadow-xl"
      >
        <div>
          <h2 className="text-lg font-semibold">
            {editing ? 'Editar usuario' : 'Nuevo usuario'}
          </h2>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            Acceso al panel de la empresa.
          </p>
        </div>

        <div>
          <label className="mb-1 block text-xs text-[var(--text-muted)]">
            Nombre
          </label>
          <input
            required
            minLength={2}
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            className={inputClass}
          />
        </div>

        <div>
          <label className="mb-1 block text-xs text-[var(--text-muted)]">
            Email
          </label>
          <input
            required
            type="email"
            value={form.email}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            className={inputClass}
          />
        </div>

        <div>
          <label className="mb-1 block text-xs text-[var(--text-muted)]">
            {editing ? 'Nueva contraseña (opcional)' : 'Contraseña'}
          </label>
          <input
            required={!editing}
            type="password"
            minLength={editing ? undefined : 8}
            value={form.password}
            onChange={(e) =>
              setForm((f) => ({ ...f, password: e.target.value }))
            }
            className={inputClass}
            autoComplete="new-password"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs text-[var(--text-muted)]">
            Rol
          </label>
          <select
            value={form.role}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                role: e.target.value as TenantUserRole,
              }))
            }
            className={inputClass}
          >
            {roles.map((r) => (
              <option key={r} value={r}>
                {TENANT_ROLE_LABEL[r]}
              </option>
            ))}
            {editing &&
              user &&
              !roles.includes(user.role) && (
                <option value={user.role}>
                  {TENANT_ROLE_LABEL[user.role]}
                </option>
              )}
          </select>
        </div>

        {editing && (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(e) =>
                setForm((f) => ({ ...f, isActive: e.target.checked }))
              }
            />
            Usuario activo
          </label>
        )}

        {error && <p className="text-sm text-[var(--danger)]">{error}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm hover:bg-[var(--bg)]"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={saveMutation.isPending}
            className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-60"
          >
            {saveMutation.isPending ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </form>
    </div></ModalPortal>
  )
}
