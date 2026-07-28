import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { canInstallField } from '../lib/crm'

const TILES = [
  {
    to: '/movil/instalar',
    title: 'Instalar',
    subtitle: 'Cliente, servicio y ONU',
    icon: '＋',
    ready: true,
    requiresInstall: true,
    accent: 'from-sky-500/25 to-cyan-600/10',
  },
  {
    to: '/movil/calendario',
    title: 'Calendario',
    subtitle: 'Agendas del día',
    icon: '▦',
    ready: true,
    requiresInstall: false,
    accent: 'from-emerald-500/20 to-teal-600/5',
  },
  {
    to: '/movil/mapa-red',
    title: 'Mapa de Red',
    subtitle: 'Técnico y postes',
    icon: '◈',
    ready: true,
    requiresInstall: false,
    accent: 'from-violet-500/20 to-indigo-600/5',
  },
] as const

export function MobileHomePage() {
  const { user } = useAuth()
  const canInstall = canInstallField(user?.tenantRole)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="grid flex-1 grid-cols-1 grid-rows-3 gap-3">
        {TILES.map((tile) => {
          const enabled = tile.ready && (!tile.requiresInstall || canInstall)
          const baseClass = `mobile-tile group relative flex min-h-0 flex-1 items-center gap-4 overflow-hidden rounded-2xl border border-[var(--border)] bg-gradient-to-br ${tile.accent} px-5 py-5`

          if (enabled) {
            return (
              <Link
                key={tile.to}
                to={tile.to}
                className={`${baseClass} transition active:scale-[0.98]`}
              >
                <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-[var(--bg)]/60 text-2xl text-[var(--accent)] shadow-sm">
                  {tile.icon}
                </span>
                <div className="min-w-0">
                  <p className="text-xl font-semibold tracking-tight">
                    {tile.title}
                  </p>
                  <p className="text-sm text-[var(--text-muted)]">
                    {tile.subtitle}
                  </p>
                </div>
                <span className="ml-auto text-2xl text-[var(--text-muted)] opacity-60">
                  ›
                </span>
              </Link>
            )
          }
          return (
            <div
              key={tile.to}
              className={`${baseClass} opacity-55`}
            >
              <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-[var(--bg)]/60 text-2xl text-[var(--text-muted)]">
                {tile.icon}
              </span>
              <div className="min-w-0">
                <p className="text-xl font-semibold tracking-tight">
                  {tile.title}
                </p>
                <p className="text-sm text-[var(--text-muted)]">
                  {tile.ready && tile.requiresInstall && !canInstall
                    ? 'Sin permiso de instalación'
                    : tile.subtitle}
                </p>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
