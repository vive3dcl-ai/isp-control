import { useCallback, useEffect, useRef, useState } from 'react'
import { apiFetch } from '../lib/api'

export type AiModelsListResponse = {
  models: string[]
  live: boolean
  warning?: string
}

type UseAiModelsListArgs = {
  /** POST path, e.g. /admin/settings/ai/models */
  endpoint: string
  provider: string
  /** Key typed in the form (not yet saved). */
  apiKeyDraft: string
  /** True if a key is already stored server-side. */
  hasSavedApiKey: boolean
  /** When false, skip fetching (e.g. tenant mode=internal). */
  enabled?: boolean
  presets?: string[]
}

/**
 * Carga modelos al abrir (si hay key guardada) y al blur de una key nueva /
 * cambio de proveedor.
 */
export function useAiModelsList({
  endpoint,
  provider,
  apiKeyDraft,
  hasSavedApiKey,
  enabled = true,
  presets = [],
}: UseAiModelsListArgs) {
  const [models, setModels] = useState<string[]>(presets)
  const [live, setLive] = useState(false)
  const [loading, setLoading] = useState(false)
  const [warning, setWarning] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const seq = useRef(0)
  const presetsRef = useRef(presets)
  presetsRef.current = presets

  const fetchModels = useCallback(
    async (opts?: { apiKey?: string }) => {
      if (!enabled || !provider) return
      const key = opts?.apiKey?.trim() ?? ''
      const fallback = presetsRef.current
      if (!key && !hasSavedApiKey) {
        setModels(fallback)
        setLive(false)
        setWarning(null)
        setError(null)
        return
      }
      const id = ++seq.current
      setLoading(true)
      setError(null)
      try {
        const res = await apiFetch<AiModelsListResponse>(endpoint, {
          method: 'POST',
          body: JSON.stringify({
            provider,
            apiKey: key || undefined,
          }),
        })
        if (id !== seq.current) return
        setModels(res.models?.length ? res.models : fallback)
        setLive(!!res.live)
        setWarning(res.warning ?? null)
      } catch (err) {
        if (id !== seq.current) return
        setModels(fallback)
        setLive(false)
        setWarning(null)
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        if (id === seq.current) setLoading(false)
      }
    },
    [endpoint, enabled, hasSavedApiKey, provider],
  )

  useEffect(() => {
    void fetchModels()
  }, [fetchModels])

  function onApiKeyBlur() {
    if (apiKeyDraft.trim()) {
      void fetchModels({ apiKey: apiKeyDraft })
    } else if (hasSavedApiKey) {
      void fetchModels()
    }
  }

  return {
    models,
    live,
    loading,
    warning,
    error,
    refetch: fetchModels,
    onApiKeyBlur,
  }
}
