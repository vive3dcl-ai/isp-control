import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'
import {
  formatClp,
  type ModuleCatalogItem,
} from '../lib/modules'
import { PanelShell } from '../components/PanelShell'

const inputClass =
  'rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-sm outline-none ring-[var(--accent)] focus:ring-2'

/** Configuración global de módulos de pago (precios, etc.). SMTP no aparece. */
export function AdminModulesPage() {
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState<ModuleCatalogItem[]>([])
  const [msg, setMsg] = useState<string | null>(null)

  const query = useQuery({
    queryKey: ['admin', 'modules', 'catalog'],
    queryFn: () =>
      apiFetch<ModuleCatalogItem[]>('/admin/modules/catalog'),
  })

  useEffect(() => {
    if (!query.data) return
    setDraft(query.data.filter((m) => m.billable))
  }, [query.data])

  const mutation = useMutation({
    mutationFn: async () => {
      const results: ModuleCatalogItem[] = []
      for (const m of draft) {
        if (m.priceMonthly == null) {
          throw new Error(`Define un precio para ${m.name}`)
        }
        const updated = await apiFetch<ModuleCatalogItem>(
          `/admin/modules/${m.id}/pricing`,
          {
            method: 'PATCH',
            body: JSON.stringify({
              priceMonthly: Number(m.priceMonthly),
              priceCurrency: 'USD',
            }),
          },
        )
        results.push(updated)
      }
      return results
    },
    onSuccess: (results) => {
      setDraft(results.filter((m) => m.billable))
      setMsg('Precios guardados')
      void queryClient.invalidateQueries({
        queryKey: ['admin', 'modules', 'catalog'],
      })
    },
    onError: (err: Error) => setMsg(err.message),
  })

  function setPrice(id: string, priceMonthly: number | null) {
    setMsg(null)
    setDraft((prev) =>
      prev.map((m) => {
        if (m.id !== id) return m
        const next = { ...m, priceMonthly, priceCurrency: 'USD' as string | null }
        if (next.priceMonthly != null && next.fxRate != null) {
          next.priceClp = Math.round(next.priceMonthly * next.fxRate)
        }
        return next
      }),
    )
  }

  return (
    <PanelShell
      title="Módulos"
      subtitle="Configuración global de add-ons de pago"
      variant="admin"
    >
      <p className="mb-5 max-w-2xl text-sm text-[var(--text-muted)]">
        Aquí defines el precio mensual de los módulos de pago de la plataforma.
        La activación por empresa se hace en Empresas → Acciones → Módulos.
        SMTP es obligatorio e incluido: no aparece en esta lista.
      </p>

      {query.isLoading && (
        <p className="text-sm text-[var(--text-muted)]">Cargando…</p>
      )}
      {query.error && (
        <p className="mb-4 text-sm text-[var(--danger)]">{query.error.message}</p>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {draft.map((m) => (
          <article
            key={m.id}
            className="flex flex-col rounded-xl border border-[var(--border)] bg-[var(--bg)] p-4"
          >
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold">{m.name}</h3>
              <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-amber-300">
                De pago
              </span>
              {m.id === 'mercadopago' && (
                <span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-sky-300">
                  Checkout Pro
                </span>
              )}
              {m.id === 'mapa_red' && (
                <span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-sky-300">
                  OpenStreetMap
                </span>
              )}
              {m.id === 'whatsapp' && (
                <span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-sky-300">
                  API + Baileys
                </span>
              )}
              {m.id === 'onu_unlock' && (
                <span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-sky-300">
                  ONU TR069
                </span>
              )}
              {m.id === 'client_portal' && (
                <span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-sky-300">
                  Self-service
                </span>
              )}
            </div>
            <p className="mb-3 flex-1 text-xs text-[var(--text-muted)]">
              {m.description}
            </p>
            {m.id === 'whatsapp' &&
              m.baileysSlotsMax != null &&
              m.baileysSlotsUsed != null && (
                <p className="mb-3 text-xs text-amber-200/90">
                  Cupo Baileys: {m.baileysSlotsUsed}/{m.baileysSlotsMax} (Cloud
                  API no resta)
                </p>
              )}
            {m.availableCountries && m.availableCountries.length > 0 && (
              <p className="mb-3 text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
                Países: {m.availableCountries.join(' · ')}
              </p>
            )}
            <div className="mt-auto space-y-2">
              <label className="flex flex-wrap items-center gap-2 text-xs">
                <span className="text-[var(--text-muted)]">Precio / mes</span>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  className={`${inputClass} w-28`}
                  disabled={mutation.isPending}
                  value={m.priceMonthly ?? ''}
                  onChange={(e) =>
                    setPrice(
                      m.id,
                      e.target.value === '' ? null : Number(e.target.value),
                    )
                  }
                />
                <span className="font-mono text-[var(--text-muted)]">USD</span>
              </label>
              <p className="text-xs text-[var(--text-muted)]">
                Ref. Chile:{' '}
                <strong className="text-[var(--text)]">
                  {formatClp(m.priceClp) ?? '—'}
                </strong>
                {m.fxRate != null && (
                  <>
                    {' '}
                    · tasa {m.fxRate.toFixed(2)} CLP/USD
                    {m.fxRateDate ? ` (${m.fxRateDate})` : ''}
                    {m.fxStale ? ' · tasa previa' : ''}
                  </>
                )}
              </p>
            </div>
          </article>
        ))}
      </div>

      {!query.isLoading && draft.length === 0 && (
        <p className="text-sm text-[var(--text-muted)]">
          No hay módulos de pago en el catálogo.
        </p>
      )}

      {msg && (
        <p
          className={`mt-4 text-sm ${
            msg.includes('guardados')
              ? 'text-emerald-400'
              : 'text-[var(--danger)]'
          }`}
        >
          {msg}
        </p>
      )}

      {draft.length > 0 && (
        <div className="mt-5">
          <button
            type="button"
            disabled={mutation.isPending}
            onClick={() => mutation.mutate()}
            className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-60"
          >
            {mutation.isPending ? 'Guardando…' : 'Guardar precios'}
          </button>
        </div>
      )}
    </PanelShell>
  )
}
