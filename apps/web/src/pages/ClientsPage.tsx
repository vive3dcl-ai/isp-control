import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { apiFetch } from '../lib/api'
import { canWriteCrm, clientDisplayName, type Client } from '../lib/crm'
import { PanelShell } from '../components/PanelShell'
import { ClientFormModal } from '../components/ClientFormModal'

export function ClientsPage() {
  const { user } = useAuth()
  const canWrite = canWriteCrm(user?.tenantRole)
  const [createOpen, setCreateOpen] = useState(false)

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

  const clients = (clientsQuery.data ?? []).filter((client) => client.isActive)

  return (
    <PanelShell
      title="Clientes"
      subtitle="Residenciales y empresas"
      variant="tenant"
    >
      <div className="mb-6 flex items-center justify-between gap-3">
        <p className="text-sm text-[var(--text-muted)]">
          Gestiona leads, clientes activos y archivados.
        </p>
        {canWrite && (
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="shrink-0 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)]"
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

      <div className="overflow-x-auto overflow-hidden rounded-xl border border-[var(--border)]">
        <table className="w-full min-w-[720px] text-left text-sm">
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
                  className="px-4 py-6 text-[var(--text-muted)]"
                >
                  No hay clientes todavía.
                </td>
              </tr>
            )}
            {clients.map((c) => (
              <tr key={c.id} className="border-t border-[var(--border)]">
                <td className="px-4 py-3">
                  <Link
                    to={`/app/clients/${c.id}`}
                    className="font-medium text-[var(--text)] hover:text-[var(--accent)]"
                  >
                    {clientDisplayName(c)}
                  </Link>
                </td>
                <td className="px-4 py-3 text-[var(--text-muted)]">
                  <div>{c.email || '—'}</div>
                  <div className="text-xs">{c.phone || ''}</div>
                </td>
                <td className="px-4 py-3">{c.city || '—'}</td>
                <td className="px-4 py-3">{zoneName(c.zoneId)}</td>
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

      <ClientFormModal open={createOpen} onClose={() => setCreateOpen(false)} />
    </PanelShell>
  )
}

function StatusBadge({ client }: { client: Client }) {
  if (client.isLead) {
    return (
      <span className="inline-flex rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-300">
        Lead
      </span>
    )
  }
  if (client.isActive) {
    return (
      <span className="inline-flex rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-300">
        Activo
      </span>
    )
  }
  return (
    <span className="inline-flex rounded-full bg-zinc-500/15 px-2 py-0.5 text-xs font-medium text-zinc-400">
      Archivado
    </span>
  )
}
