import { useMemo, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'
import type {
  AuthorizeOnuResponse,
  UncfgOnu,
} from '../lib/onu-connected'
import type { OnuTypesResponse } from '../lib/onu-settings'

const inputClass =
  'w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm outline-none ring-[var(--accent)] focus:ring-2'

function vendorFromSn(sn: string): 'huawei' | 'zte' | 'fiberhome' | 'other' {
  const p = sn.trim().toUpperCase().slice(0, 4)
  if (p === 'HWTC') return 'huawei'
  if (p === 'ZTEG' || p.startsWith('ZTE')) return 'zte'
  if (p === 'FHTT') return 'fiberhome'
  return 'other'
}

type Props = {
  orphan: UncfgOnu
  onClose: () => void
  onAuthorized: () => void
}

export function OnuAuthorizeModal({ orphan, onClose, onAuthorized }: Props) {
  const queryClient = useQueryClient()
  const [onuId, setOnuId] = useState(
    orphan.suggestedOnuId != null ? String(orphan.suggestedOnuId) : '1',
  )
  const [onuType, setOnuType] = useState('')
  const [customType, setCustomType] = useState(false)
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<string[]>([])

  const snVendor = vendorFromSn(orphan.sn)

  const typesQuery = useQuery({
    queryKey: ['app', 'settings', 'onus', 'types'],
    queryFn: () => apiFetch<OnuTypesResponse>('/app/settings/onus/types'),
  })

  const typeOptions = useMemo(() => {
    // Solo tipos que el tenant tiene en Ajustes → ONUs (no el dump de la OLT)
    const all = typesQuery.data?.types ?? []
    const ponFiltered = all.filter(
      (t) => !orphan.ponType || t.ponType === orphan.ponType,
    )
    return [...ponFiltered].sort((a, b) => {
      const av = (a.vendor || '').toLowerCase() === snVendor ? 0 : 1
      const bv = (b.vendor || '').toLowerCase() === snVendor ? 0 : 1
      return av - bv || a.name.localeCompare(b.name)
    })
  }, [typesQuery.data?.types, orphan.ponType, snVendor])

  // Default: Auto — no preseleccionar para no forzar un type de la lista
  const authorizeMutation = useMutation({
    mutationFn: () =>
      apiFetch<AuthorizeOnuResponse>('/app/onus/authorize', {
        method: 'POST',
        body: JSON.stringify({
          oltId: orphan.oltId,
          oltIf: orphan.oltIf,
          onuId: onuId.trim(),
          sn: orphan.sn,
          onuType: onuType.trim() || null,
          name: name.trim() || null,
        }),
      }),
    onMutate: () => {
      setError(null)
      setProgress([
        `Detectando vendor por SN (${snVendor})…`,
        'Sincronizando perfiles ONU con la OLT…',
        'Probando types hasta que la OLT acepte…',
        'Luego se leerá SW info del modelo real…',
      ])
    },
    onSuccess: (r) => {
      const fromApi = (r.steps ?? [])
        .filter((s) => s.status === 'ok' || s.status === 'info')
        .map((s) => s.message)
      setProgress(
        fromApi.length
          ? fromApi
          : [r.message || 'ONU autorizada'],
      )
      void queryClient.invalidateQueries({ queryKey: ['app', 'onus'] })
      void queryClient.invalidateQueries({
        queryKey: ['app', 'settings', 'onus'],
      })
      window.setTimeout(() => {
        onAuthorized()
        onClose()
      }, 900)
    },
    onError: (e: Error) => {
      setProgress([])
      setError(e.message)
    },
  })

  function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!onuId.trim() || !/^\d+$/.test(onuId.trim())) {
      setError('ONU ID debe ser un número')
      return
    }
    authorizeMutation.mutate()
  }

  const busy = authorizeMutation.isPending

  return (
    <div className="fixed inset-0 z-[90] flex items-start justify-center overflow-y-auto bg-black/60 p-4 sm:items-center">
      <form
        onSubmit={submit}
        className="max-h-[min(92vh,100dvh)] overflow-y-auto relative w-full max-w-lg rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] shadow-xl"
      >
        {busy ? (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 rounded-xl bg-[var(--bg-elevated)]/95 px-6 text-center">
            <div className="h-9 w-9 animate-spin rounded-full border-2 border-[var(--accent)] border-t-transparent" />
            <p className="text-sm font-medium">Autorizando ONU…</p>
            <ul className="max-h-40 w-full space-y-1 overflow-y-auto text-left text-xs text-[var(--text-muted)]">
              {progress.map((line, i) => (
                <li key={`${i}-${line.slice(0, 24)}`}>· {line}</li>
              ))}
            </ul>
            <p className="text-xs text-[var(--text-muted)]">
              Puede tardar 1–3 min mientras se prueban perfiles en la OLT.
            </p>
          </div>
        ) : null}

        <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-3">
          <h3 className="text-lg font-semibold">Autorizar ONU</h3>
          <button
            type="button"
            className="rounded-md px-2 py-1 text-[var(--text-muted)] hover:bg-[var(--bg)]"
            onClick={onClose}
            disabled={busy}
          >
            ✕
          </button>
        </div>

        <div className="space-y-3 px-5 py-4 text-sm">
          {error && <p className="text-[var(--danger)]">{error}</p>}

          <label className="block">
            <span className="text-xs text-[var(--text-muted)]">OLT</span>
            <input
              className={`${inputClass} mt-1 opacity-80`}
              value={orphan.oltName}
              readOnly
            />
          </label>

          <label className="block">
            <span className="text-xs text-[var(--text-muted)]">Puerto PON</span>
            <input
              className={`${inputClass} mt-1 font-mono text-xs opacity-80`}
              value={orphan.oltIf}
              readOnly
            />
          </label>

          <label className="block">
            <span className="text-xs text-[var(--text-muted)]">Serial (SN)</span>
            <input
              className={`${inputClass} mt-1 font-mono opacity-80`}
              value={orphan.sn}
              readOnly
            />
            <span className="mt-1 block text-xs text-[var(--text-muted)]">
              Vendor por SN: {snVendor}
            </span>
          </label>

          <label className="block">
            <span className="text-xs text-[var(--text-muted)]">ONU ID</span>
            <input
              className={`${inputClass} mt-1`}
              value={onuId}
              onChange={(e) => setOnuId(e.target.value)}
              inputMode="numeric"
              required
              disabled={busy}
            />
            {orphan.suggestedOnuId != null ? (
              <span className="mt-1 block text-xs text-[var(--text-muted)]">
                Sugerido (siguiente libre): {orphan.suggestedOnuId}
              </span>
            ) : null}
          </label>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs text-[var(--text-muted)]">
                Tipo preferido (opcional)
              </span>
              <button
                type="button"
                className="text-xs text-[var(--accent)] hover:underline"
                disabled={busy}
                onClick={() => {
                  setCustomType((v) => !v)
                  if (!customType) setOnuType('')
                }}
              >
                {customType ? 'Elegir de la lista' : 'Escribir tipo OLT'}
              </button>
            </div>
            {customType ? (
              <input
                className={inputClass}
                value={onuType}
                onChange={(e) => setOnuType(e.target.value)}
                placeholder="Ej. HG8245H — o vacío para auto"
                disabled={busy}
              />
            ) : (
              <select
                className={inputClass}
                value={onuType}
                onChange={(e) => setOnuType(e.target.value)}
                disabled={busy}
              >
                <option value="">Auto (probar por vendor)…</option>
                {typeOptions.map((t) => (
                  <option key={t.id} value={t.name}>
                    {t.name}
                    {t.vendor ? ` · ${t.vendor}` : ''}
                    {t.ponType ? ` (${t.ponType})` : ''}
                  </option>
                ))}
              </select>
            )}
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              La lista son solo tus tipos de Ajustes → ONUs. Si falta el modelo,
              Auto prueba en silencio el catálogo / OLT; no se mezclan aquí.
            </p>
          </div>

          <label className="block">
            <span className="text-xs text-[var(--text-muted)]">
              Nombre (opcional)
            </span>
            <input
              className={`${inputClass} mt-1`}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Cliente / etiqueta"
              disabled={busy}
            />
          </label>
        </div>

        <div className="flex justify-end gap-2 border-t border-[var(--border)] px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm hover:bg-[var(--bg)] disabled:opacity-60"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-60"
          >
            {busy ? 'Autorizando…' : 'Autorizar'}
          </button>
        </div>
      </form>
    </div>
  )
}
