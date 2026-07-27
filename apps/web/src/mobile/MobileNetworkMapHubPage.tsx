import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'
import type { TenantModuleCard } from '../lib/modules'

export function MobileNetworkMapHubPage() {
  const modulesQuery = useQuery({
    queryKey: ['app', 'settings', 'modules'],
    queryFn: () => apiFetch<TenantModuleCard[]>('/app/settings/modules'),
    staleTime: 60_000,
  })
  const contracted = !!modulesQuery.data?.find((m) => m.id === 'mapa_red')
    ?.contracted

  return (
    <div className="flex flex-1 flex-col">
      <div className="mb-4 flex items-center gap-3">
        <Link
          to="/movil"
          className="rounded-xl border border-[var(--border)] px-3 py-2 text-sm text-[var(--text-muted)]"
        >
          ←
        </Link>
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Mapa de Red</h1>
          <p className="text-xs text-[var(--text-muted)]">
            Técnico y postes en campo
          </p>
        </div>
      </div>

      {modulesQuery.isLoading ? (
        <p className="text-sm text-[var(--text-muted)]">Cargando…</p>
      ) : !contracted ? (
        <div className="rounded-2xl border border-dashed border-[var(--border)] px-4 py-10 text-center">
          <p className="text-sm text-[var(--text-muted)]">
            El módulo Mapa de red no está contratado para esta empresa.
          </p>
        </div>
      ) : (
        <div className="grid flex-1 grid-cols-1 gap-3">
          <Link
            to="/movil/mapa-red/tecnico"
            className="flex min-h-[7.5rem] items-center gap-4 rounded-2xl border border-[var(--border)] bg-gradient-to-br from-violet-500/20 to-indigo-600/5 px-5 py-5 active:scale-[0.98]"
          >
            <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-[var(--bg)]/60 text-2xl text-[var(--accent)]">
              ⌖
            </span>
            <div className="min-w-0">
              <p className="text-xl font-semibold tracking-tight">Técnico</p>
              <p className="text-sm text-[var(--text-muted)]">
                NAP y MUFAS
              </p>
            </div>
            <span className="ml-auto text-2xl text-[var(--text-muted)] opacity-60">
              ›
            </span>
          </Link>

          <Link
            to="/movil/mapa-red/postes"
            className="flex min-h-[7.5rem] items-center gap-4 rounded-2xl border border-[var(--border)] bg-gradient-to-br from-lime-500/20 to-green-700/5 px-5 py-5 active:scale-[0.98]"
          >
            <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-[var(--bg)]/60 text-2xl text-[var(--accent)]">
              ┃
            </span>
            <div className="min-w-0">
              <p className="text-xl font-semibold tracking-tight">Postes</p>
              <p className="text-sm text-[var(--text-muted)]">
                Añadir postes con GPS
              </p>
            </div>
            <span className="ml-auto text-2xl text-[var(--text-muted)] opacity-60">
              ›
            </span>
          </Link>
        </div>
      )}
    </div>
  )
}
