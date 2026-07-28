import { useEffect, useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'
import { ModalPortal } from './ModalPortal'


const inputClass =
  'w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 outline-none ring-[var(--accent)] focus:ring-2'

export function CreateVlanModal({
  open,
  portId,
  portName,
  onClose,
}: {
  open: boolean
  portId: string | null
  portName: string
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [vlanId, setVlanId] = useState('')
  const [comment, setComment] = useState('')

  const parsedId = Number(vlanId)
  const ifacePreview =
    Number.isInteger(parsedId) && parsedId >= 1 && parsedId <= 4094
      ? `vlan_${parsedId}`
      : null

  useEffect(() => {
    if (open) {
      setVlanId('')
      setComment('')
    }
  }, [open, portId])

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const createMutation = useMutation({
    mutationFn: () =>
      apiFetch(`/app/topology/ports/${portId}/vlans`, {
        method: 'POST',
        body: JSON.stringify({
          vlanId: parsedId,
          comment: comment.trim() || undefined,
        }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['app', 'topology'] })
      onClose()
    },
  })

  if (!open || !portId) return null

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!ifacePreview) return
    createMutation.mutate()
  }

  return (
    <ModalPortal><div className="fixed inset-0 z-[110] modal-backdrop flex items-stretch justify-center overflow-hidden bg-black/60 sm:items-center sm:p-4">
      <form
        role="dialog"
        aria-modal="true"
        onSubmit={onSubmit}
        className="flex h-[100dvh] max-h-[100dvh] w-full max-w-md flex-col overflow-hidden rounded-none border-0 sm:h-auto sm:max-h-[min(92dvh,920px)] sm:rounded-xl sm:border border-[var(--border)] bg-[var(--bg-elevated)] shadow-xl"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-[var(--border)] px-5 py-4">
          <h2 className="text-lg font-semibold">Nueva VLAN</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2 py-1 text-[var(--text-muted)] hover:bg-[var(--bg)]"
          >
            ✕
          </button>
        </div>

        <div className="space-y-3 px-5 py-4">
          <p className="text-sm text-[var(--text-muted)]">
            En {portName}
            {ifacePreview ? (
              <>
                {' '}
                · interfaz <span className="font-medium text-[var(--text)]">{ifacePreview}</span>
              </>
            ) : null}
          </p>
          <label className="block text-sm">
            <span className="mb-1 block text-[var(--text-muted)]">VLAN ID</span>
            <input
              className={inputClass}
              type="number"
              min={1}
              max={4094}
              step={1}
              value={vlanId}
              onChange={(e) => setVlanId(e.target.value)}
              autoFocus
              required
              placeholder="ej. 10"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-[var(--text-muted)]">
              Comentario
            </span>
            <textarea
              className={inputClass}
              rows={3}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              maxLength={500}
              placeholder="Opcional"
            />
          </label>
          {createMutation.error && (
            <p className="text-sm text-[var(--danger)]">
              {createMutation.error.message}
            </p>
          )}
        </div>

        <div className="flex shrink-0 justify-end gap-2 border-t border-[var(--border)] px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm hover:border-[var(--accent)]"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={createMutation.isPending || !ifacePreview}
            className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-60"
          >
            {createMutation.isPending ? 'Creando…' : 'Crear en el equipo'}
          </button>
        </div>
      </form>
    </div></ModalPortal>
  )
}
