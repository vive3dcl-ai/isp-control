import { useEffect, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'
import type {
  MercadoPagoConfig,
  MercadoPagoEnvironment,
  PlatformPaymentMethod,
} from '../lib/modules'
import { ModalPortal } from './ModalPortal'

const inputClass =
  'w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm outline-none ring-[var(--accent)] focus:ring-2'

export type MercadoPagoScope =
  | { kind: 'tenant' }
  | { kind: 'platform'; methodId: string }

/**
 * Configuración Mercado Pago.
 * Plataforma y tenant usan endpoints y almacenamiento distintos;
 * nunca comparten credenciales.
 */
export function MercadoPagoConfigModal({
  open,
  canWrite,
  scope,
  onClose,
}: {
  open: boolean
  canWrite: boolean
  scope: MercadoPagoScope
  onClose: () => void
}) {
  // Remount al cambiar de contexto para no filtrar estado entre plataforma/tenant.
  const instanceKey =
    scope.kind === 'platform'
      ? `platform:${scope.methodId}`
      : 'tenant'

  if (!open) return null

  return (
    <MercadoPagoConfigForm
      key={instanceKey}
      canWrite={canWrite}
      scope={scope}
      onClose={onClose}
    />
  )
}

function MercadoPagoConfigForm({
  canWrite,
  scope,
  onClose,
}: {
  canWrite: boolean
  scope: MercadoPagoScope
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [environment, setEnvironment] =
    useState<MercadoPagoEnvironment>('sandbox')
  const [publicKey, setPublicKey] = useState('')
  const [accessToken, setAccessToken] = useState('')
  const [webhookSecret, setWebhookSecret] = useState('')
  const [hasAccessToken, setHasAccessToken] = useState(false)
  const [hasWebhookSecret, setHasWebhookSecret] = useState(false)
  const [enabled, setEnabled] = useState(false)

  const isPlatform = scope.kind === 'platform'

  const queryKey = isPlatform
    ? (['admin', 'payment-methods', scope.methodId] as const)
    : (['app', 'settings', 'modules', 'mercadopago'] as const)

  const query = useQuery({
    queryKey,
    queryFn: async () => {
      if (scope.kind === 'tenant') {
        return apiFetch<MercadoPagoConfig>('/app/settings/modules/mercadopago')
      }
      return apiFetch<PlatformPaymentMethod>(
        `/admin/payment-methods/${scope.methodId}`,
      )
    },
  })

  useEffect(() => {
    if (!query.data) return
    setEnvironment(query.data.environment)
    setPublicKey(query.data.publicKey ?? '')
    setAccessToken('')
    setWebhookSecret('')
    setHasAccessToken(!!query.data.hasAccessToken)
    setHasWebhookSecret(!!query.data.hasWebhookSecret)
    if ('enabled' in query.data) setEnabled(!!query.data.enabled)
  }, [query.data])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const mutation = useMutation({
    mutationFn: async (): Promise<{
      hasAccessToken: boolean
      hasWebhookSecret: boolean
    }> => {
      const body = {
        environment,
        publicKey,
        accessToken: accessToken || undefined,
        webhookSecret: webhookSecret || undefined,
        ...(isPlatform ? { enabled } : {}),
      }
      if (scope.kind === 'tenant') {
        return apiFetch<MercadoPagoConfig>('/app/settings/modules/mercadopago', {
          method: 'PATCH',
          body: JSON.stringify(body),
        })
      }
      return apiFetch<PlatformPaymentMethod>(
        `/admin/payment-methods/${scope.methodId}`,
        {
          method: 'PATCH',
          body: JSON.stringify(body),
        },
      ).then((m) => ({
        hasAccessToken: !!m.hasAccessToken,
        hasWebhookSecret: !!m.hasWebhookSecret,
      }))
    },
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: [...queryKey] })
      if (scope.kind === 'tenant') {
        void queryClient.invalidateQueries({
          queryKey: ['app', 'settings', 'modules'],
        })
      } else {
        void queryClient.invalidateQueries({
          queryKey: ['admin', 'payment-methods'],
        })
      }
      setHasAccessToken(!!data.hasAccessToken)
      setHasWebhookSecret(!!data.hasWebhookSecret)
      setAccessToken('')
      setWebhookSecret('')
      onClose()
    },
  })

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
            {isPlatform
              ? 'Mercado Pago — cuenta de la plataforma'
              : 'Mercado Pago — cuenta de tu empresa'}
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
          <div
            className={`rounded-lg border px-3 py-2 text-xs ${
              isPlatform
                ? 'border-sky-500/30 bg-sky-500/10 text-sky-200'
                : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
            }`}
          >
            {isPlatform ? (
              <>
                Credenciales <strong>solo de la plataforma</strong> (cobro de
                suscripciones a las empresas). No se comparten con ningún
                tenant.
              </>
            ) : (
              <>
                Credenciales <strong>solo de tu empresa</strong> (cobro a tus
                clientes). Independientes de la cuenta Mercado Pago de la
                plataforma.
              </>
            )}
          </div>

          <p className="text-sm text-[var(--text-muted)]">
            Integración <strong>Checkout Pro</strong>. Usa claves de{' '}
            {environment === 'sandbox' ? 'sandbox' : 'producción'} de{' '}
            <em>tu</em> aplicación en Mercado Pago
            {!isPlatform &&
            query.data &&
            'countryLabel' in query.data &&
            query.data.countryLabel
              ? ` (${query.data.countryLabel})`
              : ''}
            .
            {!isPlatform &&
              query.data &&
              'developersUrl' in query.data &&
              query.data.developersUrl && (
                <>
                  {' '}
                  Credenciales en{' '}
                  <a
                    href={query.data.developersUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[var(--accent)] underline"
                  >
                    Developers · {query.data.countryLabel}
                  </a>
                  .
                </>
              )}
          </p>

          {query.isLoading && (
            <p className="text-sm text-[var(--text-muted)]">Cargando…</p>
          )}
          {query.error && (
            <p className="text-sm text-[var(--danger)]">{query.error.message}</p>
          )}

          {isPlatform && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                disabled={!canWrite}
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
              />
              Método activo en la plataforma
            </label>
          )}

          <label className="block text-sm">
            <span className="mb-1 block text-[var(--text-muted)]">Entorno</span>
            <select
              disabled={!canWrite}
              className={inputClass}
              value={environment}
              onChange={(e) =>
                setEnvironment(e.target.value as MercadoPagoEnvironment)
              }
            >
              <option value="sandbox">Sandbox (pruebas)</option>
              <option value="production">Producción</option>
            </select>
          </label>

          <label className="block text-sm">
            <span className="mb-1 block text-[var(--text-muted)]">
              Public Key
            </span>
            <input
              required
              disabled={!canWrite}
              className={inputClass}
              placeholder={
                environment === 'sandbox' ? 'TEST-…' : 'APP_USR-…'
              }
              value={publicKey}
              onChange={(e) => setPublicKey(e.target.value)}
            />
          </label>

          <label className="block text-sm">
            <span className="mb-1 block text-[var(--text-muted)]">
              Access Token
              {hasAccessToken ? ' (dejar vacío para no cambiar)' : ''}
            </span>
            <input
              disabled={!canWrite}
              type="password"
              autoComplete="new-password"
              className={inputClass}
              value={accessToken}
              onChange={(e) => setAccessToken(e.target.value)}
              placeholder={hasAccessToken ? '••••••••' : 'APP_USR-…'}
              required={!hasAccessToken}
            />
          </label>

          <label className="block text-sm">
            <span className="mb-1 block text-[var(--text-muted)]">
              Webhook secret
              {hasWebhookSecret
                ? ' (opcional; vacío = no cambiar)'
                : ' (opcional)'}
            </span>
            <input
              disabled={!canWrite}
              type="password"
              autoComplete="new-password"
              className={inputClass}
              value={webhookSecret}
              onChange={(e) => setWebhookSecret(e.target.value)}
              placeholder={hasWebhookSecret ? '••••••••' : ''}
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
    </div></ModalPortal>
  )
}
