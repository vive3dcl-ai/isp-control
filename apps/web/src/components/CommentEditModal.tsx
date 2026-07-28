import { useEffect, useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'
import { ModalPortal } from './ModalPortal'


const inputClass =
  'w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 outline-none ring-[var(--accent)] focus:ring-2'

export function CommentEditModal({
  open,
  title,
  portId,
  interfaceName,
  initialComment,
  onClose,
}: {
  open: boolean
  title: string
  portId: string | null
  interfaceName?: string | null
  initialComment: string
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [comment, setComment] = useState(initialComment)

  useEffect(() => {
    if (open) setComment(initialComment)
  }, [open, initialComment, portId, interfaceName])

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const saveMutation = useMutation({
    mutationFn: () => {
      const qs = interfaceName
        ? `?interface=${encodeURIComponent(interfaceName)}`
        : ''
      return apiFetch(`/app/topology/ports/${portId}/comment${qs}`, {
        method: 'PATCH',
        body: JSON.stringify({ comment }),
      })
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['app', 'topology'] })
      onClose()
    },
  })

  if (!open || !portId) return null

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    saveMutation.mutate()
  }

  return (
    <ModalPortal><div className="fixed inset-0 z-[70] modal-backdrop flex items-stretch justify-center overflow-hidden bg-black/60 sm:items-center sm:p-4">
      <form
        role="dialog"
        aria-modal="true"
        onSubmit={onSubmit}
        className="flex h-[100dvh] max-h-[100dvh] w-full max-w-md flex-col overflow-hidden rounded-none border-0 sm:h-auto sm:max-h-[min(92dvh,920px)] sm:rounded-xl sm:border border-[var(--border)] bg-[var(--bg-elevated)] shadow-xl"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-[var(--border)] px-5 py-4">
          <h2 className="text-lg font-semibold">Editar comentario</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2 py-1 text-[var(--text-muted)] hover:bg-[var(--bg)]"
          >
            ✕
          </button>
        </div>

        <div className="space-y-3 px-5 py-4">
          <p className="text-sm text-[var(--text-muted)]">{title}</p>
          <label className="block text-sm">
            <span className="mb-1 block text-[var(--text-muted)]">
              Comentario
            </span>
            <textarea
              className={inputClass}
              rows={3}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              autoFocus
              maxLength={500}
            />
          </label>
          {saveMutation.error && (
            <p className="text-sm text-[var(--danger)]">
              {saveMutation.error.message}
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
            disabled={saveMutation.isPending}
            className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-60"
          >
            {saveMutation.isPending ? 'Guardando…' : 'Guardar en el equipo'}
          </button>
        </div>
      </form>
    </div></ModalPortal>
  )
}

/** Pencil icon button for opening the comment editor */
export function CommentEditButton({
  onClick,
  disabled,
}: {
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title="Editar comentario"
      aria-label="Editar comentario"
      className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-[var(--text-muted)] hover:bg-[var(--bg)] hover:text-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-40"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 20 20"
        fill="currentColor"
        className="h-3.5 w-3.5"
        aria-hidden
      >
        <path d="M2.695 14.763l-1.262 3.154a.5.5 0 00.65.65l3.155-1.262a4 4 0 001.343-.885L17.5 5.5a2.121 2.121 0 00-3-3L3.58 13.42a4 4 0 00-.885 1.343z" />
      </svg>
    </button>
  )
}
