import { useEffect, useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { apiFetch } from '../lib/api'
import type { CreateTenantInput, CreateTenantResponse } from '../lib/tenants'

function slugify(name: string) {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

const inputClass =
  'w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 outline-none ring-[var(--accent)] focus:ring-2'

export function CreateTenantModal({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [name, setName] = useState('')
  const [legalName, setLegalName] = useState('')
  const [phone, setPhone] = useState('')
  const [address, setAddress] = useState('')
  const [slug, setSlug] = useState('')
  const [slugTouched, setSlugTouched] = useState(false)
  const [ownerName, setOwnerName] = useState('')
  const [ownerEmail, setOwnerEmail] = useState('')
  const [ownerPassword, setOwnerPassword] = useState('')

  useEffect(() => {
    if (!open) return
    setName('')
    setLegalName('')
    setPhone('')
    setAddress('')
    setSlug('')
    setSlugTouched(false)
    setOwnerName('')
    setOwnerEmail('')
    setOwnerPassword('')
  }, [open])

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const createMutation = useMutation({
    mutationFn: (payload: CreateTenantInput) =>
      apiFetch<CreateTenantResponse>('/admin/tenants', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'tenants'] })
      void queryClient.invalidateQueries({ queryKey: ['admin', 'dashboard'] })
      onClose()
      navigate(`/admin/tenants/${result.tenant.id}`)
    },
  })

  if (!open) return null

  function onNameChange(value: string) {
    setName(value)
    if (!slugTouched) setSlug(slugify(value))
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    createMutation.mutate({
      name,
      legalName,
      phone,
      address,
      slug: slug || undefined,
      ownerName,
      ownerEmail,
      ownerPassword,
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
        aria-labelledby="create-tenant-title"
        className="relative z-10 max-h-[min(92vh,100dvh)] w-full max-w-lg overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-[var(--border)] px-5 py-4">
          <div>
            <h2 id="create-tenant-title" className="text-lg font-semibold">
              Nueva empresa
            </h2>
            <p className="mt-0.5 text-sm text-[var(--text-muted)]">
              Datos comerciales + schema + owner
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
              onChange={(e) => onNameChange(e.target.value)}
              className={inputClass}
              placeholder="Acme Telecom"
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
              placeholder="Acme Telecom C.A."
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
              placeholder="+58 212 5551234"
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
              placeholder="Av. Principal, Ciudad"
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-sm text-[var(--text-muted)]">
              Slug (schema: tenant_&#123;slug&#125;)
            </span>
            <input
              required
              minLength={2}
              pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
              value={slug}
              onChange={(e) => {
                setSlugTouched(true)
                setSlug(e.target.value.toLowerCase())
              }}
              className={`${inputClass} font-mono text-sm`}
              placeholder="acme-telecom"
            />
          </label>

          <div className="border-t border-[var(--border)] pt-4">
            <p className="mb-3 text-sm font-medium">Usuario owner</p>
            <label className="mb-3 block">
              <span className="mb-1.5 block text-sm text-[var(--text-muted)]">
                Nombre
              </span>
              <input
                required
                minLength={2}
                value={ownerName}
                onChange={(e) => setOwnerName(e.target.value)}
                className={inputClass}
              />
            </label>
            <label className="mb-3 block">
              <span className="mb-1.5 block text-sm text-[var(--text-muted)]">
                Email
              </span>
              <input
                type="email"
                required
                value={ownerEmail}
                onChange={(e) => setOwnerEmail(e.target.value)}
                className={inputClass}
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm text-[var(--text-muted)]">
                Contraseña
              </span>
              <input
                type="password"
                required
                minLength={8}
                value={ownerPassword}
                onChange={(e) => setOwnerPassword(e.target.value)}
                className={inputClass}
              />
            </label>
          </div>

          {createMutation.error && (
            <p className="rounded-lg border border-[var(--danger)]/40 bg-[var(--danger)]/10 px-3 py-2 text-sm text-[var(--danger)]">
              {createMutation.error.message}
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
              disabled={createMutation.isPending}
              className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-60"
            >
              {createMutation.isPending ? 'Creando…' : 'Crear empresa'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
