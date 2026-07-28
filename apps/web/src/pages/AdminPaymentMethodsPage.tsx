import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'
import type { PlatformPaymentMethod } from '../lib/modules'
import { PanelShell } from '../components/PanelShell'
import { MercadoPagoConfigModal } from '../components/MercadoPagoConfigModal'
import {
  ListSearchInput,
  matchesSearch,
} from '../components/ListSearchInput'

export function AdminPaymentMethodsPage() {
  const [editId, setEditId] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  const query = useQuery({
    queryKey: ['admin', 'payment-methods'],
    queryFn: () =>
      apiFetch<PlatformPaymentMethod[]>('/admin/payment-methods'),
  })

  const methods = useMemo(() => {
    const all = query.data ?? []
    return all.filter((m) =>
      matchesSearch(
        search,
        m.name,
        m.description,
        m.environment,
        m.enabled ? 'activo' : 'inactivo',
        m.configured ? 'configurado' : 'pendiente',
      ),
    )
  }, [query.data, search])

  return (
    <PanelShell
      title="Métodos de pago"
      subtitle="Cuenta de cobro de la plataforma"
      variant="admin"
    >
      {query.isLoading && (
        <p className="text-sm text-[var(--text-muted)]">Cargando…</p>
      )}
      {query.error && (
        <p className="mb-4 text-sm text-[var(--danger)]">{query.error.message}</p>
      )}

      <div className="mb-4">
        <ListSearchInput
          value={search}
          onChange={setSearch}
          placeholder="Buscar método…"
          className="md:max-w-sm"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {methods.map((m) => (
          <article
            key={m.id}
            className="flex flex-col rounded-xl border border-[var(--border)] bg-[var(--bg)] p-4"
          >
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold">{m.name}</h3>
              {m.enabled ? (
                <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-300">
                  Activo
                </span>
              ) : (
                <span className="rounded bg-zinc-500/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-400">
                  Inactivo
                </span>
              )}
              {m.configured ? (
                <span className="rounded bg-[var(--bg-elevated)] px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
                  Configurado
                </span>
              ) : (
                <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-amber-300">
                  Pendiente
                </span>
              )}
            </div>
            <p className="mb-2 flex-1 text-xs text-[var(--text-muted)]">
              {m.description}
            </p>
            <p className="mb-4 text-xs text-[var(--text-muted)]">
              Checkout Pro ·{' '}
              {m.environment === 'production' ? 'Producción' : 'Sandbox'}
            </p>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setEditId(m.id)}
                className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white hover:bg-[var(--accent-hover)]"
              >
                Configurar
              </button>
            </div>
          </article>
        ))}
      </div>

      {editId && (
        <MercadoPagoConfigModal
          open={!!editId}
          canWrite
          scope={{ kind: 'platform', methodId: editId }}
          onClose={() => setEditId(null)}
        />
      )}
    </PanelShell>
  )
}
