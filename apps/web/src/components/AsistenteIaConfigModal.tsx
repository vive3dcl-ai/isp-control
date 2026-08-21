import { useEffect, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'
import type {
  AsistenteIaConfig,
  AsistenteIaMode,
  AsistenteIaOwnProvider,
} from '../lib/modules'
import { useAiModelsList } from '../lib/use-ai-models-list'
import { AiModelPicker } from './AiModelPicker'
import { ModalPortal } from './ModalPortal'

const inputClass =
  'w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm outline-none ring-[var(--accent)] focus:ring-2'

export function AsistenteIaConfigModal({
  open,
  canWrite,
  onClose,
}: {
  open: boolean
  canWrite: boolean
  onClose: () => void
}) {
  if (!open) return null
  return <AsistenteIaConfigForm canWrite={canWrite} onClose={onClose} />
}

function AsistenteIaConfigForm({
  canWrite,
  onClose,
}: {
  canWrite: boolean
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [mode, setMode] = useState<AsistenteIaMode>('internal')
  const [provider, setProvider] = useState<AsistenteIaOwnProvider>('openai')
  const [model, setModel] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [enabled, setEnabled] = useState(true)
  const [hasApiKey, setHasApiKey] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const query = useQuery({
    queryKey: ['app', 'settings', 'modules', 'asistente-ia'],
    queryFn: () =>
      apiFetch<AsistenteIaConfig>('/app/settings/modules/asistente-ia'),
  })

  useEffect(() => {
    if (!query.data) return
    setMode(query.data.mode)
    setProvider(query.data.provider)
    setModel(query.data.model)
    setEnabled(query.data.enabled)
    setHasApiKey(!!query.data.hasApiKey)
    setApiKey('')
    if (query.data.internalAllowed === false && query.data.mode === 'internal') {
      setMode('own')
    }
  }, [query.data])

  const vendors = query.data?.vendors ?? []
  const vendor = vendors.find((v) => v.id === provider)
  const internalAllowed = query.data?.internalAllowed !== false


  const modelsList = useAiModelsList({
    endpoint: '/app/settings/modules/asistente-ia/models',
    provider,
    apiKeyDraft: apiKey,
    hasSavedApiKey: hasApiKey,
    enabled: mode === 'own',
    presets: vendor?.models ?? [],
  })

  const save = useMutation({
    mutationFn: () => {
      const nextMode =
        !internalAllowed && mode === 'internal' ? 'own' : mode
      return apiFetch<AsistenteIaConfig>('/app/settings/modules/asistente-ia', {
        method: 'PATCH',
        body: JSON.stringify({
          mode: nextMode,
          provider,
          model,
          apiKey: apiKey || undefined,
          enabled,
        }),
      })
    },
    onSuccess: () => {
      setMsg('Guardado')
      setApiKey('')
      void queryClient.invalidateQueries({
        queryKey: ['app', 'settings', 'modules'],
      })
      void queryClient.invalidateQueries({
        queryKey: ['app', 'settings', 'modules', 'asistente-ia'],
      })
    },
    onError: (err: Error) => setMsg(err.message),
  })

  const test = useMutation({
    mutationFn: () =>
      apiFetch<{
        ok: boolean
        provider: string
        model: string
        reply: string
        billedInternal: boolean
      }>('/app/settings/modules/asistente-ia/test', { method: 'POST' }),
    onSuccess: (r) => {
      setMsg(
        `Conexión OK · ${r.provider}/${r.model}` +
          (r.billedInternal ? ' (interno, cuenta en el cupo)' : ''),
      )
      void queryClient.invalidateQueries({
        queryKey: ['app', 'settings', 'modules', 'asistente-ia'],
      })
    },
    onError: (err: Error) => setMsg(err.message),
  })

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    setMsg(null)
    save.mutate()
  }

  const quota = query.data?.quota

  return (
    <ModalPortal>
      <div className="modal-backdrop fixed inset-0 z-[100] flex items-stretch justify-center overflow-hidden bg-black/60 sm:items-center sm:p-4">
        <form
          onSubmit={onSubmit}
          className="modal-panel relative z-10 flex h-full max-h-full w-full max-w-lg flex-col overflow-hidden border-[var(--border)] bg-[var(--bg-elevated)] text-[var(--text)] shadow-xl rounded-none border-0 sm:h-auto sm:max-h-[min(92dvh,920px)] sm:rounded-xl sm:border"
        >
          <div className="modal-safe-header flex shrink-0 items-start justify-between gap-2 border-b border-[var(--border)] px-4 py-3">
            <div>
              <h2 className="text-base font-semibold">Asistente IA</h2>
              <p className="text-xs text-[var(--text-muted)]">
                API propia o proveedor interno de la plataforma
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md px-2 py-1 text-[var(--text-muted)] hover:bg-[var(--bg)]"
            >
              ✕
            </button>
          </div>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
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
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
                disabled={!canWrite}
              />
              Habilitado
            </label>

            <fieldset className="space-y-2">
              <legend className="mb-1 text-xs font-medium text-[var(--text-muted)]">
                Proveedor
              </legend>
              <label
                className={[
                  'flex items-start gap-2 text-sm',
                  !internalAllowed ? 'opacity-55' : '',
                ].join(' ')}
              >
                <input
                  type="radio"
                  name="ai-mode"
                  checked={mode === 'internal'}
                  onChange={() => setMode('internal')}
                  disabled={!canWrite || !internalAllowed}
                />
                <span>
                  <strong>Interno</strong>
                  <span className="block text-xs text-[var(--text-muted)]">
                    {internalAllowed
                      ? 'Keys de ISP Control. Aplica cupos diarios (consultas y tokens). El modelo lo define Admin → Ajustes → IA.'
                      : 'No disponible para esta empresa. Contacta a soporte o usa API propia.'}
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="radio"
                  name="ai-mode"
                  checked={mode === 'own'}
                  onChange={() => setMode('own')}
                  disabled={!canWrite}
                />
                <span>
                  <strong>API propia</strong>
                  <span className="block text-xs text-[var(--text-muted)]">
                    OpenAI, Anthropic, Grok, Gemini, DeepSeek o LatinRouter. Sin
                    cupo de plataforma.
                  </span>
                </span>
              </label>
            </fieldset>

            {mode === 'own' && (
              <>
                <label className="block text-sm">
                  <span className="mb-1 block text-[var(--text-muted)]">
                    Vendor
                  </span>
                  <select
                    className={inputClass}
                    value={provider}
                    disabled={!canWrite}
                    onChange={(e) => {
                      const id = e.target.value as AsistenteIaOwnProvider
                      setProvider(id)
                      const v = vendors.find((x) => x.id === id)
                      if (v) setModel(v.defaultModel)
                    }}
                  >
                    {vendors.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm">
                  <span className="mb-1 block text-[var(--text-muted)]">
                    API key {hasApiKey ? '(guardada)' : ''}
                  </span>
                  <input
                    type="password"
                    autoComplete="off"
                    className={inputClass}
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    onBlur={() => modelsList.onApiKeyBlur()}
                    disabled={!canWrite}
                    placeholder={hasApiKey ? '••••••••' : 'sk-…'}
                  />
                </label>
                <div className="block text-sm">
                  <span className="mb-1 block text-[var(--text-muted)]">
                    Modelo
                  </span>
                  <AiModelPicker
                    className={inputClass}
                    value={model}
                    onChange={setModel}
                    models={modelsList.models}
                    loading={modelsList.loading}
                    live={modelsList.live}
                    warning={modelsList.warning}
                    error={modelsList.error}
                    disabled={!canWrite}
                  />
                </div>
              </>
            )}

            {mode === 'internal' && quota && (
              <div className="rounded-lg border border-[var(--border)] bg-[var(--bg)] p-3 text-xs text-[var(--text-muted)]">
                <p>
                  Plataforma:{' '}
                  {quota.platformEnabled
                    ? `${quota.platformProvider} / ${quota.platformModel}`
                    : 'deshabilitada'}
                </p>
                <p className="mt-1">
                  Consultas hoy: {quota.requestsUsed} / {quota.requestsLimit}
                </p>
                <p>
                  Tokens hoy: {quota.tokensUsed} / {quota.tokensLimit}
                </p>
                <p className="mt-1">El día se reinicia a las 00:00 UTC.</p>
              </div>
            )}

            {msg && (
              <p className="text-sm text-[var(--text-muted)]">{msg}</p>
            )}
          </div>

          <div className="modal-safe-footer flex shrink-0 flex-wrap justify-end gap-2 border-t border-[var(--border)] px-4 py-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm"
            >
              Cerrar
            </button>
            {canWrite && (
              <button
                type="button"
                disabled={test.isPending || save.isPending}
                onClick={() => {
                  setMsg(null)
                  test.mutate()
                }}
                className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm"
              >
                {test.isPending ? 'Probando…' : 'Probar conexión'}
              </button>
            )}
            {canWrite && (
              <button
                type="submit"
                disabled={save.isPending}
                className="rounded-lg bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-60"
              >
                {save.isPending ? 'Guardando…' : 'Guardar'}
              </button>
            )}
          </div>
        </form>
      </div>
    </ModalPortal>
  )
}
