import { useEffect, useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'
import type { Tenant, TenantStatus, UpdateTenantInput } from '../lib/tenants'

const inputClass =
  'w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 outline-none ring-[var(--accent)] focus:ring-2'

export function EditTenantModal({
  tenant,
  onClose,
}: {
  tenant: Tenant | null
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [legalName, setLegalName] = useState('')
  const [phone, setPhone] = useState('')
  const [address, setAddress] = useState('')
  const [status, setStatus] = useState<TenantStatus>('active')

  useEffect(() => {
    if (!tenant) return
    setName(tenant.name)
    setLegalName(tenant.legalName || '')
    setPhone(tenant.phone || '')
    setAddress(tenant.address || '')
    setStatus(tenant.status)
  }, [tenant])

  useEffect(() => {
    if (!tenant) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [tenant, onClose])

  const updateMutation = useMutation({
    mutationFn: (payload: UpdateTenantInput) =>
      apiFetch<Tenant>(`/admin/tenants/${tenant!.id}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'tenants'] })
      void queryClient.invalidateQueries({
        queryKey: ['admin', 'tenants', tenant!.id],
      })
      void queryClient.invalidateQueries({ queryKey: ['admin', 'dashboard'] })
      onClose()
    },
  })

  if (!tenant) return null

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    updateMutation.mutate({
      name: name.trim(),
      legalName: legalName.trim(),
      phone: phone.trim(),
      address: address.trim(),
      status,
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-3 sm:items-center sm:p-4">
      <button
        type="button"
        aria-label="Cerrar"
        className="absolute inset-0 bg-black/60"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        className="relative z-10 max-h-[min(92vh,100dvh)] w-full max-w-md overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-[var(--border)] px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold">Editar empresa</h2>
            <p className="mt-0.5 font-mono text-xs text-[var(--text-muted)]">
              {tenant.slug}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2 py-1 text-sm text-[var(--text-muted)] hover:text-[var(--text)]"
          >
            ✕
          </button>
        </div>

        <form onSubmit={onSubmit} className="space-y-4 px-5 py-4">
          <label className="block">
            <span className="mb-1.5 block text-sm text-[var(--text-muted)]">
              Nombre de la empresa
            </span>
            <input
              required
              minLength={2}
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputClass}
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-sm text-[var(--text-muted)]">
              Razón social
            </span>
            <input
              required
              minLength={2}
              value={legalName}
              onChange={(e) => setLegalName(e.target.value)}
              className={inputClass}
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-sm text-[var(--text-muted)]">
              Teléfono
            </span>
            <input
              required
              minLength={7}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className={inputClass}
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-sm text-[var(--text-muted)]">
              Dirección
            </span>
            <input
              required
              minLength={5}
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className={inputClass}
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-sm text-[var(--text-muted)]">
              Estado
            </span>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as TenantStatus)}
              className={inputClass}
            >
              <option value="active">Activa</option>
              <option value="inactive">Inactiva</option>
              <option value="suspended">Suspendida</option>
            </select>
          </label>

          <p className="text-xs text-[var(--text-muted)]">
            El slug y el schema no se pueden cambiar después de crear la
            empresa.
          </p>

          {updateMutation.error && (
            <p className="rounded-lg border border-[var(--danger)]/40 bg-[var(--danger)]/10 px-3 py-2 text-sm text-[var(--danger)]">
              {updateMutation.error.message}
            </p>
          )}

          <div className="flex justify-end gap-2 border-t border-[var(--border)] pt-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm text-[var(--text-muted)] hover:text-[var(--text)]"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={updateMutation.isPending}
              className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-60"
            >
              {updateMutation.isPending ? 'Guardando…' : 'Guardar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
