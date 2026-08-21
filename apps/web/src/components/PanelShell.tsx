import { useMemo, useState, type ReactNode } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { WhatsAppAttentionBanner } from './WhatsAppAttentionBanner'
import {
  NotificationBell,
  useNotificationSummary,
} from './NotificationBell'
import { UserAccountMenu } from './UserAccountMenu'
import { BrandLogo } from './BrandLogo'
import { useBranding } from '../branding/BrandingContext'
import { isAdminPwaInstalled, isAdminPwaSession } from '../lib/pwa'
import { useSubscriptionAccess } from '../auth/useSubscriptionAccess'
import { useAsistenteChatOptional } from '../asistente/AsistenteChatContext'
import { AsistenteHeaderButton } from '../asistente/AsistenteHeaderButton'

const SUBSCRIPTION_LOCK_TO =
  '/app/settings?tab=empresa&section=suscripcion'

export type AppShellVariant = 'admin' | 'tenant'

interface NavItem {
  to: string
  label: string
  end?: boolean
  showTicketBadge?: boolean
}

const adminNav: NavItem[] = [
  { to: '/admin', label: 'Dashboard', end: true },
  { to: '/admin/tenants', label: 'Empresas' },
  { to: '/admin/tenant-users', label: 'Clientes Tenant' },
  { to: '/admin/tickets', label: 'Tickets', showTicketBadge: true },
  { to: '/admin/modules', label: 'Módulos' },
  { to: '/admin/ai', label: 'IA' },
  { to: '/admin/payment-methods', label: 'Métodos de pago' },
  { to: '/admin/onus', label: 'ONUs' },
  { to: '/admin/settings', label: 'Ajustes' },
]

const tenantNavBase: NavItem[] = [
  { to: '/app', label: 'Dashboard', end: true },
  { to: '/app/clients', label: 'Clientes' },
  { to: '/app/accounting', label: 'Contabilidad' },
  { to: '/app/calendar', label: 'Calendario' },
  { to: '/app/users', label: 'Usuarios' },
  { to: '/app/topology', label: 'Topología' },
  { to: '/app/network-map', label: 'Mapa de red' },
  { to: '/app/inventory', label: 'Inventario' },
  { to: '/app/support', label: 'Soporte', showTicketBadge: true },
  { to: '/movil', label: 'Técnico' },
  { to: '/app/settings', label: 'Ajustes' },
]

export function PanelShell({
  title,
  subtitle,
  children,
  variant = 'admin',
}: {
  title: string
  subtitle?: string
  children: ReactNode
  variant?: AppShellVariant
}) {
  const { user, logout, isImpersonating, exitImpersonation } = useAuth()
  const branding = useBranding()
  const navigate = useNavigate()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [exiting, setExiting] = useState(false)
  const summaryQuery = useNotificationSummary(variant)
  const asistente = useAsistenteChatOptional()
  const { blocked: subscriptionLocked } = useSubscriptionAccess()

  const hideTechNav = isAdminPwaSession() || isAdminPwaInstalled()
  const links = useMemo(() => {
    if (variant === 'admin') return adminNav
    if (subscriptionLocked) {
      return [
        {
          to: SUBSCRIPTION_LOCK_TO,
          label: 'Suscripción',
        },
      ]
    }
    if (!hideTechNav) return tenantNavBase
    return tenantNavBase.filter((l) => l.to !== '/movil')
  }, [variant, hideTechNav, subscriptionLocked])
  const ticketBadge = summaryQuery.data?.ticketBadge ?? false
  const showAsistenteNav =
    variant === 'tenant' &&
    !subscriptionLocked &&
    !!asistente?.moduleEnabled &&
    !asistente.moduleLoading

  async function onLogout() {
    await logout()
    navigate('/login', { replace: true })
  }

  async function onReturnAdmin() {
    setExiting(true)
    try {
      await exitImpersonation()
      navigate('/admin/tenants', { replace: true })
    } catch {
      navigate('/login', { replace: true })
    } finally {
      setExiting(false)
    }
  }

  return (
    <div className="app-shell flex bg-[var(--bg)]">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <button
          type="button"
          aria-label="Cerrar menú"
          className="fixed inset-0 z-30 bg-black/50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar — fixed; no scrollea con el contenido */}
      <aside
        className={[
          'app-shell-sidebar fixed inset-y-0 left-0 z-40 flex h-dvh w-[var(--sidebar-width)] flex-col border-r border-[var(--border)] bg-[var(--bg-sidebar)] transition-transform lg:translate-x-0',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full',
        ].join(' ')}
      >
        <div className="flex h-14 shrink-0 items-center justify-center border-b border-[var(--border)] px-3">
          <BrandLogo height={40} className="max-h-10 max-w-full" />
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto p-3">
          <p className="mb-2 px-2 text-[11px] font-semibold tracking-[0.14em] text-[var(--text-muted)] uppercase">
            Menú
          </p>
          {links.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.end}
              onClick={() => setSidebarOpen(false)}
              className={({ isActive }) =>
                [
                  'flex items-center gap-2 rounded-md px-3 py-2 text-sm transition',
                  isActive
                    ? 'bg-[var(--accent)]/15 font-medium text-[var(--accent)]'
                    : 'text-[var(--text-muted)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text)]',
                ].join(' ')
              }
            >
              <span className="min-w-0 flex-1 truncate">{link.label}</span>
              {link.showTicketBadge && ticketBadge && (
                <span
                  className="h-2 w-2 shrink-0 rounded-full bg-[var(--danger)]"
                  aria-label="Actividad pendiente"
                />
              )}
            </NavLink>
          ))}
          {showAsistenteNav && (
            <button
              type="button"
              onClick={() => {
                if (asistente?.minimized) asistente.expand()
                else asistente?.setOpen(true)
                setSidebarOpen(false)
              }}
              className={[
                'flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition lg:hidden',
                asistente?.open || asistente?.minimized
                  ? 'bg-[var(--accent)]/15 font-medium text-[var(--accent)]'
                  : 'text-[var(--text-muted)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text)]',
              ].join(' ')}
            >
              <span className="min-w-0 flex-1 truncate">Asistente</span>
              <span aria-hidden className="text-[var(--accent)]">
                ✦
              </span>
            </button>
          )}
        </nav>

        <div className="border-t border-[var(--border)] p-3">
          <p className="truncate px-2 text-xs text-[var(--text-muted)]">
            {user?.email}
          </p>
          {user?.tenantSlug && (
            <p className="truncate px-2 text-xs text-[var(--text-muted)]">
              tenant: {user.tenantSlug}
            </p>
          )}
        </div>
      </aside>

      {/* Main column — margen para el sidebar fijo en desktop */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col lg:ml-[var(--sidebar-width)]">
        <header className="app-shell-header relative z-50 flex shrink-0 items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--bg-header)]/95 backdrop-blur">
          <div className="flex h-14 min-w-0 flex-1 items-center gap-3">
            <button
              type="button"
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text)] lg:hidden"
              onClick={() => setSidebarOpen(true)}
              aria-label="Abrir menú"
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                aria-hidden
              >
                <path d="M4 7h16M4 12h16M4 17h16" />
              </svg>
            </button>
            <div className="min-w-0">
              <h1 className="truncate text-base font-semibold">{title}</h1>
              {subtitle && (
                <p className="truncate text-xs text-[var(--text-muted)]">
                  {subtitle}
                </p>
              )}
            </div>
          </div>

          <div className="flex h-14 shrink-0 items-center gap-2">
            {isImpersonating && variant === 'tenant' && (
              <button
                type="button"
                onClick={onReturnAdmin}
                disabled={exiting}
                className="rounded-md border border-[var(--accent)] bg-[var(--accent)]/10 px-2.5 py-1.5 text-xs text-[var(--accent)] transition hover:bg-[var(--accent)]/20 disabled:opacity-60 sm:px-3 sm:text-sm"
              >
                {exiting ? 'Volviendo…' : 'Volver a admin'}
              </button>
            )}
            {variant === 'tenant' && !subscriptionLocked && (
              <AsistenteHeaderButton />
            )}
            {!subscriptionLocked && <NotificationBell variant={variant} />}
            <UserAccountMenu
              displayName={user?.name || user?.email || 'Cuenta'}
              subtitle={
                isImpersonating && user?.impersonatorEmail
                  ? `via ${user.impersonatorEmail}`
                  : user?.email
              }
              canEditAccount={!isImpersonating && !subscriptionLocked}
              onLogout={onLogout}
            />
          </div>
        </header>

        <main className="app-shell-main app-shell-main-x py-4 pb-[max(1rem,var(--safe-bottom))] lg:py-6 lg:pb-6">
          {variant === 'tenant' && !subscriptionLocked && (
            <WhatsAppAttentionBanner />
          )}
          {children}
        </main>

        {/* Solo desktop: en móvil/tablet el branding ocupa espacio útil de la app */}
        <footer className="app-shell-footer hidden shrink-0 border-t border-[var(--border)] bg-[var(--bg-header)] py-3 lg:block">
          <div className="flex flex-col gap-1 text-xs text-[var(--text-muted)] sm:flex-row sm:items-center sm:justify-between">
            <span>{branding.footerText}</span>
            <span>
              {branding.footerCopyright} {new Date().getFullYear()}
            </span>
          </div>
        </footer>
      </div>
    </div>
  )
}
