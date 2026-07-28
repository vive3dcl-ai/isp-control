import { useEffect, useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'
import type { NetworkNode } from '../lib/network-nodes'
import { AddressLocationFields } from './AddressLocationFields'
import { ModalPortal } from './ModalPortal'

const inputClass =
  'w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 outline-none ring-[var(--accent)] focus:ring-2'

type FormState = {
  name: string
  note: string
  isRented: boolean
  contactName: string
  contactPhone: string
  contactEmail: string
  street: string
  city: string
  zipCode: string
  latitude: number | null
  longitude: number | null
}

const empty: FormState = {
  name: '',
  note: '',
  isRented: false,
  contactName: '',
  contactPhone: '',
  contactEmail: '',
  street: '',
  city: '',
  zipCode: '',
  latitude: null,
  longitude: null,
}

function formFromNode(node: NetworkNode): FormState {
  return {
    name: node.name,
    note: node.note,
    isRented: node.isRented,
    contactName: node.contactName,
    contactPhone: node.contactPhone,
    contactEmail: node.contactEmail,
    street: node.street,
    city: node.city,
    zipCode: node.zipCode,
    latitude: node.latitude,
    longitude: node.longitude,
  }
}

export function NetworkNodeFormModal({
  open,
  onClose,
  node,
}: {
  open: boolean
  onClose: () => void
  node?: NetworkNode | null
}) {
  const queryClient = useQueryClient()
  const sessionKey = open ? (node?.id ?? 'new') : null
  const [loadedKey, setLoadedKey] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(empty)

  // Hidratar en el mismo render al abrir / cambiar de nodo (evita montar el mapa sin coords).
  if (open && sessionKey !== loadedKey) {
    setLoadedKey(sessionKey)
    setForm(node ? formFromNode(node) : empty)
  }
  if (!open && loadedKey !== null) {
    setLoadedKey(null)
  }

  const locationReady = open && loadedKey === sessionKey

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const mutation = useMutation({
    mutationFn: (payload: FormState) => {
      const body = {
        ...payload,
        contactName: payload.isRented ? payload.contactName : '',
        contactPhone: payload.isRented ? payload.contactPhone : '',
        contactEmail: payload.isRented ? payload.contactEmail : '',
      }
      if (node) {
        return apiFetch<NetworkNode>(`/app/network-nodes/${node.id}`, {
          method: 'PATCH',
          body: JSON.stringify(body),
        })
      }
      return apiFetch<NetworkNode>('/app/network-nodes', {
        method: 'POST',
        body: JSON.stringify(body),
      })
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['app', 'network-nodes'] })
      void queryClient.invalidateQueries({
        queryKey: ['app', 'network-map'],
      })
      onClose()
    },
  })

  if (!open) return null

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    mutation.mutate(form)
  }

  return (
    <ModalPortal><div className="fixed inset-0 z-[100] modal-backdrop flex items-stretch justify-center overflow-hidden bg-black/60 sm:items-center sm:p-4">
      <div
        role="dialog"
        aria-modal="true"
        className="flex h-[100dvh] max-h-[100dvh] w-full max-w-2xl flex-col overflow-hidden rounded-none border-0 sm:h-auto sm:max-h-[min(92dvh,920px)] sm:rounded-xl sm:border border-[var(--border)] bg-[var(--bg-elevated)] shadow-xl"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-[var(--border)] px-5 py-4">
          <h2 className="text-lg font-semibold">
            {node ? 'Editar nodo' : 'Nuevo nodo'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2 py-1 text-[var(--text-muted)] hover:bg-[var(--bg)]"
          >
            ✕
          </button>
        </div>

        <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-5 py-4">
            <label className="block text-sm">
              <span className="mb-1 block text-[var(--text-muted)]">Nombre</span>
              <input
                required
                className={inputClass}
                value={form.name}
                onChange={(e) => set('name', e.target.value)}
                placeholder="ej. POP Centro, Rack Cliente X"
              />
            </label>

            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.isRented}
                onChange={(e) => set('isRented', e.target.checked)}
              />
              Nodo físico arrendado
            </label>

            {form.isRented && (
              <div className="grid gap-3 rounded-lg border border-[var(--border)] bg-[var(--bg)] p-3 sm:grid-cols-2">
                <p className="text-xs text-[var(--text-muted)] sm:col-span-2">
                  Contacto del arrendador (opcional).
                </p>
                <label className="block text-sm sm:col-span-2">
                  <span className="mb-1 block text-[var(--text-muted)]">
                    Nombre de contacto
                  </span>
                  <input
                    className={inputClass}
                    value={form.contactName}
                    onChange={(e) => set('contactName', e.target.value)}
                  />
                </label>
                <label className="block text-sm">
                  <span className="mb-1 block text-[var(--text-muted)]">
                    Teléfono
                  </span>
                  <input
                    className={inputClass}
                    value={form.contactPhone}
                    onChange={(e) => set('contactPhone', e.target.value)}
                  />
                </label>
                <label className="block text-sm">
                  <span className="mb-1 block text-[var(--text-muted)]">
                    Email
                  </span>
                  <input
                    type="email"
                    className={inputClass}
                    value={form.contactEmail}
                    onChange={(e) => set('contactEmail', e.target.value)}
                  />
                </label>
              </div>
            )}

            {locationReady ? (
              <AddressLocationFields
                key={node?.id ?? 'new'}
                seedKey={node?.id ?? 'new'}
                value={{
                  street: form.street,
                  city: form.city,
                  zipCode: form.zipCode,
                  latitude: form.latitude,
                  longitude: form.longitude,
                }}
                onChange={(next) =>
                  setForm((prev) => ({
                    ...prev,
                    street: next.street,
                    city: next.city,
                    zipCode: next.zipCode,
                    latitude: next.latitude,
                    longitude: next.longitude,
                  }))
                }
              />
            ) : (
              <p className="text-sm text-[var(--text-muted)]">
                Cargando ubicación…
              </p>
            )}

            <label className="block text-sm">
              <span className="mb-1 block text-[var(--text-muted)]">Nota</span>
              <textarea
                className={inputClass}
                rows={2}
                value={form.note}
                onChange={(e) => set('note', e.target.value)}
              />
            </label>

            {mutation.error && (
              <p className="text-sm text-[var(--danger)]">
                {mutation.error.message}
              </p>
            )}
          </div>

          <div className="flex shrink-0 justify-end gap-2 border-t border-[var(--border)] px-5 py-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={mutation.isPending}
              className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-60"
            >
              {mutation.isPending ? 'Guardando…' : 'Guardar'}
            </button>
          </div>
        </form>
      </div>
    </div></ModalPortal>
  )
}
