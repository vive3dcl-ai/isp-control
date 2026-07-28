import { useEffect, useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'
import type { Tenant } from '../lib/tenants'
import {
  ModalShell,
  modalBodyClass,
  modalFooterClass,
  modalHeaderClass,
} from './ModalShell'

export function DeleteTenantModal({
  tenant,
  onClose,
}: {
  tenant: Tenant | null
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [confirmationSlug, setConfirmationSlug] = useState('')
  const [ack, setAck] = useState(false)

  useEffect(() => {
    if (!tenant) return
    setConfirmationSlug('')
    setAck(false)
  }, [tenant])

  const deleteMutation = useMutation({
    mutationFn: () =>
      apiFetch<{ ok: boolean }>(`/admin/tenants/${tenant!.id}`, {
        method: 'DELETE',
        body: JSON.stringify({ confirmationSlug }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'tenants'] })
      void queryClient.invalidateQueries({ queryKey: ['admin', 'dashboard'] })
      onClose()
    },
  })

  const slugMatches = !!tenant && confirmationSlug.trim() === tenant.slug
  const canDelete = slugMatches && ack && !deleteMutation.isPending

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!canDelete) return
    deleteMutation.mutate()
  }

  return (
    <ModalShell
      open={!!tenant}
      onClose={onClose}
      panelClassName="max-w-md border-[var(--danger)]/40 sm:border-[var(--danger)]/40"
      labelledBy="delete-tenant-title"
    >
      <div className={modalHeaderClass}>
        <div>
          <h2
            id="delete-tenant-title"
            className="text-lg font-semibold text-[var(--danger)]"
          >
            Eliminar empresa
          </h2>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            Esta acción es permanente: borra el schema{' '}
            <span className="font-mono text-[var(--text)]">
              {tenant?.schemaName}
            </span>
            , usuarios y registros asociados.
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
          <p className="text-sm">
            Empresa: <strong>{tenant?.name}</strong>
          </p>

          <label className="block">
            <span className="mb-1.5 block text-sm text-[var(--text-muted)]">
              Escribe el slug{' '}
              <span className="font-mono text-[var(--text)]">
                {tenant?.slug}
              </span>{' '}
              para confirmar
            </span>
            <input
              autoFocus
              autoComplete="off"
              value={confirmationSlug}
              onChange={(e) => setConfirmationSlug(e.target.value)}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 font-mono text-sm outline-none ring-[var(--danger)] focus:ring-2"
              placeholder={tenant?.slug}
            />
          </label>

          <label className="flex items-start gap-2 text-sm text-[var(--text-muted)]">
            <input
              type="checkbox"
              checked={ack}
              onChange={(e) => setAck(e.target.checked)}
              className="mt-1"
            />
            <span>
              Entiendo que no se puede deshacer y se perderán todos los datos
              de esta empresa.
            </span>
          </label>

          {deleteMutation.error && (
            <p className="rounded-lg border border-[var(--danger)]/40 bg-[var(--danger)]/10 px-3 py-2 text-sm text-[var(--danger)]">
              {deleteMutation.error.message}
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
            disabled={!canDelete}
            className="rounded-lg bg-[var(--danger)] px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
          >
            {deleteMutation.isPending
              ? 'Eliminando…'
              : 'Eliminar definitivamente'}
          </button>
        </div>
      </form>
    </ModalShell>
  )
}
