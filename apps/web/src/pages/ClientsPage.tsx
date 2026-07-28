import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { apiFetch } from '../lib/api'
import { canWriteCrm, clientDisplayName, type Client } from '../lib/crm'
import { PanelShell } from '../components/PanelShell'
import { ClientFormModal } from '../components/ClientFormModal'
import {
  ListSearchInput,
  matchesSearch,
} from '../components/ListSearchInput'

export function ClientsPage() {
  const { user } = useAuth()
  const canWrite = canWriteCrm(user?.tenantRole)
  const [createOpen, setCreateOpen] = useState(false)
  const [search, setSearch] = useState('')

  const clientsQuery = useQuery({
    queryKey: ['app', 'clients'],
    queryFn: () => apiFetch<Client[]>('/app/clients'),
  })

  const zonesQuery = useQuery({
    queryKey: ['app', 'zones'],
    queryFn: () =>
      apiFetch<Array<{ id: string; name: string }>>('/app/zones'),
    staleTime: 60_000,
  })

  const zoneName = (zoneId: string | null | undefined) => {
    if (!zoneId) return '—'
    return zonesQuery.data?.find((z) => z.id === zoneId)?.name ?? '—'
  }

  const clients = (clientsQuery.data ?? [])
    .filter((client) => client.isActive)
    .filter((c) =>
      matchesSearch(
        search,
        clientDisplayName(c),
        c.email,
        c.phone,
        c.city,
        c.companyName,
        zoneName(c.zoneId),
        c.isLead ? 'lead' : 'activo',
      ),
    )

  return (
    <PanelShell
      title="Clientes"
      subtitle="Residenciales y empresas"
      variant="tenant"
    >
      <div className="mb-4 flex flex-col gap-3 md:mb-6 md:flex-row md:items-center md:justify-between">
        <ListSearchInput
          value={search}
          onChange={setSearch}
          placeholder="Buscar cliente, email, ciudad…"
          className="md:max-w-sm"
        />
        {canWrite && (
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="hidden shrink-0 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)] md:inline-flex"
          >
            Nuevo cliente
          </button>
        )}
      </div>

      {clientsQuery.error && (
        <p className="mb-4 text-sm text-[var(--danger)]">
          {clientsQuery.error.message}
        </p>
      )}

      {/* Mobile: tarjetas */}
      <div className="space-y-3 pb-28 md:hidden">
        {clientsQuery.isLoading && (
          <p className="text-sm text-[var(--text-muted)]">Cargando…</p>
        )}
        {!clientsQuery.isLoading && clients.length === 0 && (
          <p className="rounded-xl border border-dashed border-[var(--border)] px-4 py-10 text-center text-sm text-[var(--text-muted)]">
            {search.trim()
              ? 'Sin resultados para esa búsqueda.'
              : canWrite
                ? 'Sin clientes. Toca + para crear el primero.'
                : 'Sin clientes todavía.'}
          </p>
        )}
        {clients.map((c) => (
          <article
            key={c.id}
            className="rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2.5"
          >
            <div className="flex items-center gap-2">
              <Link
                to={`/app/clients/${c.id}`}
                className="min-w-0 flex-1 truncate text-sm font-semibold text-[var(--accent)] hover:underline"
              >
                {clientDisplayName(c)}
              </Link>
              <StatusBadge client={c} />
              <Link
                to={`/app/clients/${c.id}`}
                className="shrink-0 text-xs font-medium text-[var(--accent)] hover:underline"
              >
                Ver
              </Link>
            </div>
            <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-[var(--text-muted)]">
              <span className="min-w-0 truncate">
                {c.email || c.phone || 'Sin contacto'}
              </span>
              <span className="shrink-0 text-right">
                {[c.city || null, zoneName(c.zoneId) !== '—' ? zoneName(c.zoneId) : null]
                  .filter(Boolean)
                  .join(' · ') || '—'}
                {c.phone && c.email ? ` · ${c.phone}` : ''}
              </span>
            </div>
          </article>
        ))}
      </div>

      {/* Desktop: tabla */}
      <div className="hidden w-full overflow-x-auto overflow-hidden rounded-xl border border-[var(--border)] md:block">
        <table className="w-full table-fixed text-left text-sm">
          <colgroup>
            <col className="w-[24%]" />
            <col className="w-[26%]" />
            <col className="w-[14%]" />
            <col className="w-[14%]" />
            <col className="w-[12%]" />
            <col className="w-[10%]" />
          </colgroup>
          <thead className="bg-[var(--bg)] text-[var(--text-muted)]">
            <tr>
              <th className="px-4 py-3 font-medium">Cliente</th>
              <th className="px-4 py-3 font-medium">Contacto</th>
              <th className="px-4 py-3 font-medium">Ciudad</th>
              <th className="px-4 py-3 font-medium">Zona</th>
              <th className="px-4 py-3 font-medium">Estado</th>
              <th className="px-4 py-3 font-medium">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {clientsQuery.isLoading && (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-6 text-[var(--text-muted)]"
                >
                  Cargando…
                </td>
              </tr>
            )}
            {!clientsQuery.isLoading && clients.length === 0 && (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-6 text-center text-[var(--text-muted)]"
                >
                  {search.trim()
                    ? 'Sin resultados para esa búsqueda.'
                    : 'No hay clientes todavía.'}
                </td>
              </tr>
            )}
            {clients.map((c) => (
              <tr key={c.id} className="border-t border-[var(--border)]">
                <td className="truncate px-4 py-3">
                  <Link
                    to={`/app/clients/${c.id}`}
                    className="font-medium text-[var(--accent)] hover:underline"
                  >
                    {clientDisplayName(c)}
                  </Link>
                </td>
                <td className="px-4 py-3 text-[var(--text-muted)]">
                  <div className="truncate">{c.email || '—'}</div>
                  <div className="truncate text-xs">{c.phone || ''}</div>
                </td>
                <td className="truncate px-4 py-3">{c.city || '—'}</td>
                <td className="truncate px-4 py-3">{zoneName(c.zoneId)}</td>
                <td className="px-4 py-3">
                  <StatusBadge client={c} />
                </td>
                <td className="px-4 py-3">
                  <Link
                    to={`/app/clients/${c.id}`}
                    className="inline-flex rounded-md bg-[var(--accent)] px-2.5 py-1 text-xs font-medium text-white hover:bg-[var(--accent-hover)]"
                  >
                    Ver
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {canWrite && (
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          aria-label="Nuevo cliente"
          className="fixed bottom-20 right-5 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-[var(--accent)] text-white shadow-lg shadow-black/25 hover:bg-[var(--accent-hover)] md:hidden"
        >
          <svg
            width="28"
            height="28"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            aria-hidden
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
      )}

      <ClientFormModal open={createOpen} onClose={() => setCreateOpen(false)} />
    </PanelShell>
  )
}

function StatusBadge({ client }: { client: Client }) {
  if (client.isLead) {
    return (
      <span className="inline-flex shrink-0 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-300">
        Lead
      </span>
    )
  }
  if (client.isActive) {
    return (
      <span className="inline-flex shrink-0 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
        Activo
      </span>
    )
  }
  return (
    <span className="inline-flex shrink-0 rounded-full bg-zinc-500/15 px-2 py-0.5 text-[10px] font-medium text-zinc-400">
      Archivado
    </span>
  )
}
