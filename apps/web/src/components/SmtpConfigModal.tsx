import { useEffect, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'
import type { SmtpConfig } from '../lib/modules'
import { ModalPortal } from './ModalPortal'


const inputClass =
  'w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm outline-none ring-[var(--accent)] focus:ring-2'

export function SmtpConfigModal({
  open,
  canWrite,
  onClose,
  scope = 'tenant',
}: {
  open: boolean
  canWrite: boolean
  onClose: () => void
  /** tenant = SMTP del ISP; platform = SMTP de la plataforma (avisos admin). */
  scope?: 'tenant' | 'platform'
}) {
  const queryClient = useQueryClient()
  const [host, setHost] = useState('')
  const [port, setPort] = useState('587')
  const [secure, setSecure] = useState(false)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [fromEmail, setFromEmail] = useState('')
  const [fromName, setFromName] = useState('')
  const [hasPassword, setHasPassword] = useState(false)

  const isPlatform = scope === 'platform'
  const endpoint = isPlatform
    ? '/admin/settings/smtp'
    : '/app/settings/modules/smtp'
  const queryKey = isPlatform
    ? (['admin', 'settings', 'smtp'] as const)
    : (['app', 'settings', 'modules', 'smtp'] as const)

  const query = useQuery({
    queryKey,
    queryFn: () => apiFetch<SmtpConfig>(endpoint),
    enabled: open,
  })

  useEffect(() => {
    if (!query.data) return
    setHost(query.data.host)
    setPort(String(query.data.port || 587))
    setSecure(!!query.data.secure)
    setUsername(query.data.username)
    setPassword('')
    setFromEmail(query.data.fromEmail)
    setFromName(query.data.fromName)
    setHasPassword(query.data.hasPassword)
  }, [query.data])

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const mutation = useMutation({
    mutationFn: () =>
      apiFetch<SmtpConfig>(endpoint, {
        method: 'PATCH',
        body: JSON.stringify({
          host,
          port: Number(port) || 587,
          secure,
          username,
          password: password || undefined,
          fromEmail,
          fromName,
        }),
      }),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey })
      if (!isPlatform) {
        void queryClient.invalidateQueries({
          queryKey: ['app', 'settings', 'modules'],
        })
      }
      setHasPassword(data.hasPassword)
      setPassword('')
      onClose()
    },
  })

  if (!open) return null

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!canWrite) return
    mutation.mutate()
  }

  return (
    <ModalPortal><div className="fixed inset-0 z-[100] modal-backdrop flex items-stretch justify-center overflow-hidden bg-black/60 sm:items-center sm:p-4">
      <div
        role="dialog"
        aria-modal="true"
        className="h-[100dvh] max-h-[100dvh] overflow-y-auto overscroll-contain w-full max-w-lg rounded-none border-0 sm:h-auto sm:max-h-[min(92dvh,920px)] sm:rounded-xl sm:border border-[var(--border)] bg-[var(--bg-elevated)] shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
          <h2 className="text-lg font-semibold">
            {isPlatform ? 'SMTP de la plataforma' : 'Configurar SMTP'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2 py-1 text-[var(--text-muted)] hover:bg-[var(--bg)]"
          >
            ✕
          </button>
        </div>

        <form onSubmit={onSubmit} className="space-y-3 px-5 py-4">
          <p className="text-sm text-[var(--text-muted)]">
            {isPlatform
              ? 'Correo de la plataforma para avisos a administradores (p. ej. vencimiento de módulos).'
              : 'Credenciales del servidor de correo propio de la empresa. Se usarán para envío de facturas y avisos.'}
          </p>

          {query.isLoading && (
            <p className="text-sm text-[var(--text-muted)]">Cargando…</p>
          )}
          {query.error && (
            <p className="text-sm text-[var(--danger)]">{query.error.message}</p>
          )}

          <label className="block text-sm">
            <span className="mb-1 block text-[var(--text-muted)]">Host</span>
            <input
              required
              disabled={!canWrite}
              className={inputClass}
              placeholder="smtp.ejemplo.com"
              value={host}
              onChange={(e) => setHost(e.target.value)}
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="mb-1 block text-[var(--text-muted)]">Puerto</span>
              <input
                required
                disabled={!canWrite}
                type="number"
                min={1}
                max={65535}
                className={inputClass}
                value={port}
                onChange={(e) => setPort(e.target.value)}
              />
            </label>
            <label className="flex items-end gap-2 pb-2 text-sm">
              <input
                type="checkbox"
                disabled={!canWrite}
                checked={secure}
                onChange={(e) => setSecure(e.target.checked)}
              />
              TLS / SSL (secure)
            </label>
          </div>
          <label className="block text-sm">
            <span className="mb-1 block text-[var(--text-muted)]">Usuario</span>
            <input
              disabled={!canWrite}
              className={inputClass}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-[var(--text-muted)]">
              Contraseña
              {hasPassword ? ' (dejar vacío para no cambiar)' : ''}
            </span>
            <input
              disabled={!canWrite}
              type="password"
              autoComplete="new-password"
              className={inputClass}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={hasPassword ? '••••••••' : ''}
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="mb-1 block text-[var(--text-muted)]">
                Remitente (email)
              </span>
              <input
                required
                disabled={!canWrite}
                type="email"
                className={inputClass}
                value={fromEmail}
                onChange={(e) => setFromEmail(e.target.value)}
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-[var(--text-muted)]">
                Nombre remitente
              </span>
              <input
                disabled={!canWrite}
                className={inputClass}
                value={fromName}
                onChange={(e) => setFromName(e.target.value)}
              />
            </label>
          </div>

          {mutation.error && (
            <p className="text-sm text-[var(--danger)]">
              {mutation.error.message}
            </p>
          )}

          <div className="flex justify-end gap-2 border-t border-[var(--border)] pt-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm"
            >
              Cancelar
            </button>
            {canWrite && (
              <button
                type="submit"
                disabled={mutation.isPending}
                className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-60"
              >
                {mutation.isPending ? 'Guardando…' : 'Guardar'}
              </button>
            )}
          </div>
        </form>
      </div>
    </div></ModalPortal>
  )
}
