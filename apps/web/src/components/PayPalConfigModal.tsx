import { useEffect, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'
import type {
  PayPalEnvironment,
  PlatformPaymentMethod,
} from '../lib/modules'
import { ModalPortal } from './ModalPortal'

const inputClass =
  'w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm outline-none ring-[var(--accent)] focus:ring-2'

/**
 * Configuración PayPal (cuenta de la plataforma).
 * Independiente de Mercado Pago y de cualquier tenant.
 */
export function PayPalConfigModal({
  open,
  canWrite,
  methodId,
  onClose,
}: {
  open: boolean
  canWrite: boolean
  methodId: string
  onClose: () => void
}) {
  if (!open) return null

  return (
    <PayPalConfigForm
      key={methodId}
      canWrite={canWrite}
      methodId={methodId}
      onClose={onClose}
    />
  )
}

function PayPalConfigForm({
  canWrite,
  methodId,
  onClose,
}: {
  canWrite: boolean
  methodId: string
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [environment, setEnvironment] =
    useState<PayPalEnvironment>('sandbox')
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [webhookId, setWebhookId] = useState('')
  const [hasClientSecret, setHasClientSecret] = useState(false)
  const [hasWebhookId, setHasWebhookId] = useState(false)
  const [enabled, setEnabled] = useState(false)

  const queryKey = ['admin', 'payment-methods', methodId] as const

  const query = useQuery({
    queryKey,
    queryFn: () =>
      apiFetch<PlatformPaymentMethod>(`/admin/payment-methods/${methodId}`),
  })

  useEffect(() => {
    if (!query.data) return
    setEnvironment(query.data.environment)
    setClientId(query.data.clientId ?? '')
    setClientSecret('')
    setWebhookId('')
    setHasClientSecret(!!query.data.hasClientSecret)
    setHasWebhookId(!!query.data.hasWebhookId)
    setEnabled(!!query.data.enabled)
  }, [query.data])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const mutation = useMutation({
    mutationFn: async () => {
      return apiFetch<PlatformPaymentMethod>(
        `/admin/payment-methods/${methodId}`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            environment,
            clientId,
            clientSecret: clientSecret || undefined,
            webhookId: webhookId || undefined,
            enabled,
          }),
        },
      )
    },
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: [...queryKey] })
      void queryClient.invalidateQueries({
        queryKey: ['admin', 'payment-methods'],
      })
      setHasClientSecret(!!data.hasClientSecret)
      setHasWebhookId(!!data.hasWebhookId)
      setClientSecret('')
      setWebhookId('')
      onClose()
    },
  })

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!canWrite) return
    mutation.mutate()
  }

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-[100] modal-backdrop flex items-stretch justify-center overflow-hidden bg-black/60 sm:items-center sm:p-4">
        <div
          role="dialog"
          aria-modal="true"
          className="h-[100dvh] max-h-[100dvh] overflow-y-auto overscroll-contain w-full max-w-lg rounded-none border-0 sm:h-auto sm:max-h-[min(92dvh,920px)] sm:rounded-xl sm:border border-[var(--border)] bg-[var(--bg-elevated)] shadow-xl"
        >
          <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
            <h2 className="text-lg font-semibold">
              PayPal — cuenta de la plataforma
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
            <div className="rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-xs text-sky-200">
              Credenciales <strong>solo de la plataforma</strong> (cobro de
              suscripciones a las empresas). No se comparten con ningún tenant.
            </div>

            <p className="text-sm text-[var(--text-muted)]">
              Integración <strong>PayPal Checkout</strong> (Orders API). Usa
              Client ID y Secret de{' '}
              {environment === 'sandbox' ? 'sandbox' : 'producción'} en{' '}
              <a
                href={
                  environment === 'sandbox'
                    ? 'https://developer.paypal.com/dashboard/applications/sandbox'
                    : 'https://developer.paypal.com/dashboard/applications/live'
                }
                target="_blank"
                rel="noreferrer"
                className="text-[var(--accent)] underline"
              >
                PayPal Developer Dashboard
              </a>
              .
            </p>

            {query.isLoading && (
              <p className="text-sm text-[var(--text-muted)]">Cargando…</p>
            )}
            {query.error && (
              <p className="text-sm text-[var(--danger)]">
                {query.error.message}
              </p>
            )}

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                disabled={!canWrite}
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
              />
              Método activo en la plataforma
            </label>

            <label className="block text-sm">
              <span className="mb-1 block text-[var(--text-muted)]">
                Entorno
              </span>
              <select
                disabled={!canWrite}
                className={inputClass}
                value={environment}
                onChange={(e) =>
                  setEnvironment(e.target.value as PayPalEnvironment)
                }
              >
                <option value="sandbox">Sandbox (pruebas)</option>
                <option value="production">Producción</option>
              </select>
            </label>

            <label className="block text-sm">
              <span className="mb-1 block text-[var(--text-muted)]">
                Client ID
              </span>
              <input
                required
                disabled={!canWrite}
                className={inputClass}
                placeholder="AaBb…"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
              />
            </label>

            <label className="block text-sm">
              <span className="mb-1 block text-[var(--text-muted)]">
                Client Secret
                {hasClientSecret ? ' (dejar vacío para no cambiar)' : ''}
              </span>
              <input
                disabled={!canWrite}
                type="password"
                autoComplete="new-password"
                className={inputClass}
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
                placeholder={hasClientSecret ? '••••••••' : ''}
                required={!hasClientSecret}
              />
            </label>

            <label className="block text-sm">
              <span className="mb-1 block text-[var(--text-muted)]">
                Webhook ID
                {hasWebhookId
                  ? ' (opcional; vacío = no cambiar)'
                  : ' (opcional)'}
              </span>
              <input
                disabled={!canWrite}
                type="password"
                autoComplete="new-password"
                className={inputClass}
                value={webhookId}
                onChange={(e) => setWebhookId(e.target.value)}
                placeholder={hasWebhookId ? '••••••••' : 'WH-…'}
              />
            </label>

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
      </div>
    </ModalPortal>
  )
}
