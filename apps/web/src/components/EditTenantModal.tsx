import { useEffect, useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'
import type { Tenant, TenantStatus, UpdateTenantInput } from '../lib/tenants'
import {
  ModalShell,
  modalBodyClass,
  modalFooterClass,
  modalHeaderClass,
} from './ModalShell'

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
  const [isInternalCompany, setIsInternalCompany] = useState(false)

  useEffect(() => {
    if (!tenant) return
    setName(tenant.name)
    setLegalName(tenant.legalName || '')
    setPhone(tenant.phone || '')
    setAddress(tenant.address || '')
    setStatus(tenant.status)
    setIsInternalCompany(!!tenant.isInternalCompany)
  }, [tenant])

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

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    updateMutation.mutate({
      name: name.trim(),
      legalName: legalName.trim(),
      phone: phone.trim(),
      address: address.trim(),
      status,
      isInternalCompany,
    })
  }

  return (
    <ModalShell
      open={!!tenant}
      onClose={onClose}
      panelClassName="max-w-md"
      labelledBy="edit-tenant-title"
    >
      <div className={modalHeaderClass}>
        <div>
          <h2 id="edit-tenant-title" className="text-lg font-semibold">
            Editar empresa
          </h2>
          <p className="mt-0.5 font-mono text-xs text-[var(--text-muted)]">
            {tenant?.slug}
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

      <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
        <div className={`${modalBodyClass} space-y-4`}>
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
              disabled={isInternalCompany}
            >
              <option value="active">Activa</option>
              <option value="inactive">Inactiva</option>
              <option value="suspended">Suspendida</option>
            </select>
          </label>

          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-3">
            <input
              type="checkbox"
              className="mt-1"
              checked={isInternalCompany}
              onChange={(e) => {
                const on = e.target.checked
                setIsInternalCompany(on)
                if (on) setStatus('active')
              }}
            />
            <span>
              <span className="block text-sm font-medium text-[var(--text)]">
                Empresa interna
              </span>
              <span className="mt-0.5 block text-xs text-[var(--text-muted)]">
                Queda siempre activa, sin mora ni cobros de suscripción.
              </span>
            </span>
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
        </div>

        <div className={modalFooterClass}>
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
    </ModalShell>
  )
}
