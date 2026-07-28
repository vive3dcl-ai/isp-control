import { useEffect, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'
import type { WhatsAppConfig, WhatsAppProvider } from '../lib/modules'
import { ModalPortal } from './ModalPortal'


const inputClass =
  'w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm outline-none ring-[var(--accent)] focus:ring-2'

export function WhatsAppConfigModal({
  open,
  canWrite,
  onClose,
}: {
  open: boolean
  canWrite: boolean
  onClose: () => void
}) {
  if (!open) return null
  return (
    <WhatsAppConfigForm canWrite={canWrite} onClose={onClose} />
  )
}

function WhatsAppConfigForm({
  canWrite,
  onClose,
}: {
  canWrite: boolean
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [provider, setProvider] = useState<WhatsAppProvider>('cloud_api')
  const [phoneNumberId, setPhoneNumberId] = useState('')
  const [businessAccountId, setBusinessAccountId] = useState('')
  const [accessToken, setAccessToken] = useState('')
  const [webhookVerifyToken, setWebhookVerifyToken] = useState('')
  const [templateName, setTemplateName] = useState('factura_pdf')
  const [templateLanguage, setTemplateLanguage] = useState('es')
  const [hasAccessToken, setHasAccessToken] = useState(false)
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [statusMsg, setStatusMsg] = useState<string | null>(null)

  const query = useQuery({
    queryKey: ['app', 'settings', 'modules', 'whatsapp'],
    queryFn: () =>
      apiFetch<WhatsAppConfig>('/app/settings/modules/whatsapp'),
  })

  const statusQuery = useQuery({
    queryKey: ['app', 'settings', 'modules', 'whatsapp', 'baileys-status'],
    queryFn: () =>
      apiFetch<WhatsAppConfig>('/app/settings/modules/whatsapp/baileys/status'),
    enabled: provider === 'baileys',
    refetchInterval: provider === 'baileys' ? 4000 : false,
  })

  useEffect(() => {
    if (!query.data) return
    setProvider(query.data.provider)
    setPhoneNumberId(query.data.phoneNumberId ?? '')
    setBusinessAccountId(query.data.businessAccountId ?? '')
    setAccessToken('')
    setWebhookVerifyToken(query.data.webhookVerifyToken ?? '')
    setTemplateName(query.data.templateName || 'factura_pdf')
    setTemplateLanguage(query.data.templateLanguage || 'es')
    setHasAccessToken(!!query.data.hasAccessToken)
  }, [query.data])

  useEffect(() => {
    const data = statusQuery.data ?? query.data
    if (!data) return
    if (data.qrDataUrl) setQrDataUrl(data.qrDataUrl)
    else if (data.baileysStatus === 'connected') setQrDataUrl(null)
  }, [statusQuery.data, query.data])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const saveMutation = useMutation({
    mutationFn: () =>
      apiFetch<WhatsAppConfig>('/app/settings/modules/whatsapp', {
        method: 'PATCH',
        body: JSON.stringify({
          provider,
          phoneNumberId,
          businessAccountId,
          accessToken: accessToken || undefined,
          webhookVerifyToken,
          templateName,
          templateLanguage,
        }),
      }),
    onSuccess: (data) => {
      void queryClient.setQueryData(
        ['app', 'settings', 'modules', 'whatsapp'],
        data,
      )
      void queryClient.invalidateQueries({
        queryKey: ['app', 'settings', 'modules'],
      })
      setHasAccessToken(!!data.hasAccessToken)
      setAccessToken('')
      setStatusMsg('Configuración guardada')
    },
  })

  const startMutation = useMutation({
    mutationFn: () =>
      apiFetch<WhatsAppConfig>(
        '/app/settings/modules/whatsapp/baileys/start',
        { method: 'POST' },
      ),
    onSuccess: (data) => {
      void queryClient.setQueryData(
        ['app', 'settings', 'modules', 'whatsapp'],
        data,
      )
      void queryClient.invalidateQueries({
        queryKey: ['app', 'settings', 'modules', 'whatsapp', 'baileys-status'],
      })
      setQrDataUrl(data.qrDataUrl ?? null)
      setStatusMsg(
        data.baileysStatus === 'connected'
          ? 'WhatsApp conectado'
          : 'Escanea el QR con WhatsApp',
      )
    },
  })

  const logoutMutation = useMutation({
    mutationFn: () =>
      apiFetch<WhatsAppConfig>(
        '/app/settings/modules/whatsapp/baileys/logout',
        { method: 'POST' },
      ),
    onSuccess: (data) => {
      void queryClient.setQueryData(
        ['app', 'settings', 'modules', 'whatsapp'],
        data,
      )
      setQrDataUrl(null)
      setStatusMsg('Sesión Baileys cerrada')
    },
  })

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    setStatusMsg(null)
    saveMutation.mutate()
  }

  const live = statusQuery.data ?? query.data
  const slots = live?.baileysSlots
  const baileysStatus = live?.baileysStatus ?? 'disconnected'

  return (
    <ModalPortal><div className="fixed inset-0 z-[100] modal-backdrop flex items-stretch justify-center overflow-hidden bg-black/60 sm:items-center sm:p-4">
      <div
        role="dialog"
        aria-modal="true"
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-5 shadow-xl"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">WhatsApp</h2>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              Cloud API (oficial) o Baileys (QR). Cupo Baileys de plataforma:{' '}
              {slots ? `${slots.used}/${slots.max}` : '—'}.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-[var(--border)] px-2 py-1 text-xs hover:bg-[var(--bg)]"
          >
            Cerrar
          </button>
        </div>

        {query.isLoading && (
          <p className="text-sm text-[var(--text-muted)]">Cargando…</p>
        )}
        {query.error && (
          <p className="mb-3 text-sm text-[var(--danger)]">
            {query.error.message}
          </p>
        )}

        {query.data && (
          <form onSubmit={onSubmit} className="space-y-4">
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Proveedor</legend>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="radio"
                  disabled={!canWrite}
                  checked={provider === 'cloud_api'}
                  onChange={() => setProvider('cloud_api')}
                  className="mt-1"
                />
                <span>
                  <span className="font-medium">Cloud API</span>
                  <span className="mt-0.5 block text-[11px] text-[var(--text-muted)]">
                    Oficial Meta. No resta cupo Baileys.
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="radio"
                  disabled={!canWrite}
                  checked={provider === 'baileys'}
                  onChange={() => setProvider('baileys')}
                  className="mt-1"
                />
                <span>
                  <span className="font-medium">Baileys (QR)</span>
                  <span className="mt-0.5 block text-[11px] text-amber-200/90">
                    No oficial: puede fallar o pedir QR de nuevo. Máximo{' '}
                    {slots?.max ?? 30} empresas en la plataforma.
                  </span>
                </span>
              </label>
            </fieldset>

            {provider === 'cloud_api' && (
              <div className="space-y-3 rounded-lg border border-[var(--border)] p-3">
                <label className="block text-sm">
                  <span className="mb-1 block text-[var(--text-muted)]">
                    Phone number ID
                  </span>
                  <input
                    disabled={!canWrite}
                    className={inputClass}
                    value={phoneNumberId}
                    onChange={(e) => setPhoneNumberId(e.target.value)}
                  />
                </label>
                <label className="block text-sm">
                  <span className="mb-1 block text-[var(--text-muted)]">
                    Business account ID
                  </span>
                  <input
                    disabled={!canWrite}
                    className={inputClass}
                    value={businessAccountId}
                    onChange={(e) => setBusinessAccountId(e.target.value)}
                  />
                </label>
                <label className="block text-sm">
                  <span className="mb-1 block text-[var(--text-muted)]">
                    Access token
                    {hasAccessToken ? ' (guardado)' : ''}
                  </span>
                  <input
                    disabled={!canWrite}
                    type="password"
                    autoComplete="off"
                    className={inputClass}
                    value={accessToken}
                    onChange={(e) => setAccessToken(e.target.value)}
                    placeholder={
                      hasAccessToken ? 'Dejar vacío para no cambiar' : ''
                    }
                  />
                </label>
                <label className="block text-sm">
                  <span className="mb-1 block text-[var(--text-muted)]">
                    Webhook verify token
                  </span>
                  <input
                    disabled={!canWrite}
                    className={inputClass}
                    value={webhookVerifyToken}
                    onChange={(e) => setWebhookVerifyToken(e.target.value)}
                  />
                </label>
                <div className="grid gap-3 sm:grid-cols-[1fr_7rem]">
                  <label className="block text-sm">
                    <span className="mb-1 block text-[var(--text-muted)]">
                      Plantilla aprobada para facturas
                    </span>
                    <input
                      disabled={!canWrite}
                      className={inputClass}
                      value={templateName}
                      onChange={(e) => setTemplateName(e.target.value)}
                      placeholder="factura_pdf"
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="mb-1 block text-[var(--text-muted)]">
                      Idioma
                    </span>
                    <input
                      disabled={!canWrite}
                      className={inputClass}
                      value={templateLanguage}
                      onChange={(e) => setTemplateLanguage(e.target.value)}
                      placeholder="es"
                    />
                  </label>
                </div>
                <p className="text-[11px] text-[var(--text-muted)]">
                  En Meta debe existir una plantilla aprobada con encabezado
                  tipo documento. Esto permite enviar facturas fuera de la
                  ventana de atención de 24 horas.
                </p>
              </div>
            )}

            {provider === 'baileys' && (
              <div className="space-y-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
                <p className="text-xs text-amber-100/90">
                  Estado: <strong>{baileysStatus}</strong>
                  {live?.lastDisconnectReason
                    ? ` — ${live.lastDisconnectReason}`
                    : ''}
                </p>
                {qrDataUrl && (
                  <div className="flex justify-center rounded-lg bg-white p-3">
                    <img
                      src={qrDataUrl}
                      alt="QR WhatsApp"
                      className="h-56 w-56"
                    />
                  </div>
                )}
                {canWrite && (
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={
                        startMutation.isPending || saveMutation.isPending
                      }
                      onClick={() => {
                        setStatusMsg(null)
                        // Guardar provider=baileys antes de start
                        saveMutation.mutate(undefined, {
                          onSuccess: () => startMutation.mutate(),
                        })
                      }}
                      className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-60"
                    >
                      {startMutation.isPending
                        ? 'Conectando…'
                        : 'Conectar / mostrar QR'}
                    </button>
                    <button
                      type="button"
                      disabled={logoutMutation.isPending}
                      onClick={() => {
                        setStatusMsg(null)
                        logoutMutation.mutate()
                      }}
                      className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs hover:bg-[var(--bg)] disabled:opacity-60"
                    >
                      Cerrar sesión
                    </button>
                  </div>
                )}
              </div>
            )}

            {statusMsg && (
              <p className="text-sm text-emerald-400">{statusMsg}</p>
            )}
            {(saveMutation.error ||
              startMutation.error ||
              logoutMutation.error) && (
              <p className="text-sm text-[var(--danger)]">
                {(saveMutation.error ||
                  startMutation.error ||
                  logoutMutation.error
                )?.message}
              </p>
            )}

            {canWrite && (
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm hover:bg-[var(--bg)]"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saveMutation.isPending}
                  className="rounded-lg bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-60"
                >
                  {saveMutation.isPending ? 'Guardando…' : 'Guardar'}
                </button>
              </div>
            )}
          </form>
        )}
      </div>
    </div></ModalPortal>
  )
}
