import { type ReactNode, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthContext'
import { useSubscriptionAccess } from '../auth/useSubscriptionAccess'
import { PanelShell } from '../components/PanelShell'
import { EmpresaSettingsTab } from '../components/EmpresaSettingsTab'
import { Tr069SettingsTab } from '../components/Tr069SettingsTab'
import { OnuSettingsTab } from '../components/OnuSettingsTab'
import { IpPoolsSettingsTab } from '../components/IpPoolsSettingsTab'
import { VlansSettingsTab } from '../components/VlansSettingsTab'
import { TvSettingsTab } from '../components/TvSettingsTab'
import { ServicePlansSettingsTab } from '../components/ServicePlansSettingsTab'
import { FacturacionSettingsTab } from '../components/FacturacionSettingsTab'
import { ProductosSettingsTab } from '../components/ProductosSettingsTab'
import { SuspensionPortalSettingsTab } from '../components/SuspensionPortalSettingsTab'
import { ClientesSettingsTab } from '../components/ClientesSettingsTab'
import { NodosSettingsTab } from '../components/NodosSettingsTab'
import { ZonasSettingsTab } from '../components/ZonasSettingsTab'
import { MigracionSettingsTab } from '../components/MigracionSettingsTab'
import { canWriteTopology } from '../lib/topology'
import { canWriteCrm } from '../lib/crm'
import { apiFetch } from '../lib/api'
import type { CompanyProfile } from '../lib/company'

type SettingsTab =
  | 'empresa'
  | 'tr069'
  | 'vlans'
  | 'tv'
  | 'ip_pools'
  | 'onus'
  | 'nodos'
  | 'plans'
  | 'clientes'
  | 'zonas'
  | 'facturacion'
  | 'productos'
  | 'migracion'
  | 'suspension_portal'

const BASE_TABS: { id: SettingsTab; label: string }[] = [
  { id: 'empresa', label: 'Empresa' },
  { id: 'tr069', label: 'TR069' },
  { id: 'vlans', label: 'VLANs' },
  { id: 'tv', label: 'TV' },
  { id: 'ip_pools', label: 'IP Pools' },
  { id: 'onus', label: 'ONUs' },
  { id: 'migracion', label: 'Migración' },
  { id: 'nodos', label: 'Nodos' },
  { id: 'plans', label: 'Planes' },
  { id: 'clientes', label: 'Clientes' },
  { id: 'zonas', label: 'Zonas' },
  { id: 'facturacion', label: 'Facturación' },
  { id: 'productos', label: 'Productos' },
]

function parseTab(
  raw: string | null,
  portalEnabled: boolean,
): SettingsTab {
  if (
    raw === 'empresa' ||
    raw === 'plans' ||
    raw === 'clientes' ||
    raw === 'zonas' ||
    raw === 'facturacion' ||
    raw === 'productos' ||
    raw === 'tr069' ||
    raw === 'vlans' ||
    raw === 'tv' ||
    raw === 'ip_pools' ||
    raw === 'onus' ||
    raw === 'migracion' ||
    raw === 'nodos'
  ) {
    return raw
  }
  if (raw === 'suspension_portal') {
    return portalEnabled ? 'suspension_portal' : 'empresa'
  }
  if (raw === 'speed_profiles') return 'plans'
  return 'empresa'
}

export function SettingsPage() {
  const { user } = useAuth()
  const canWriteNet = canWriteTopology(user?.tenantRole)
  const canWriteCrmFields = canWriteCrm(user?.tenantRole)
  const [searchParams, setSearchParams] = useSearchParams()
  const { blocked: subscriptionLocked } = useSubscriptionAccess()

  const companyQuery = useQuery({
    queryKey: ['app', 'settings', 'company'],
    queryFn: () => apiFetch<CompanyProfile>('/app/settings/company'),
  })
  const portalEnabled = !!companyQuery.data?.suspensionPortalEnabled

  const tabs = subscriptionLocked
    ? [{ id: 'empresa' as const, label: 'Empresa' }]
    : portalEnabled
      ? [
          ...BASE_TABS,
          { id: 'suspension_portal' as const, label: 'Portal de suspensión' },
        ]
      : BASE_TABS

  const tab = subscriptionLocked
    ? 'empresa'
    : parseTab(searchParams.get('tab'), portalEnabled)

  useEffect(() => {
    if (!subscriptionLocked) return
    const params = new URLSearchParams(searchParams)
    if (
      params.get('tab') !== 'empresa' ||
      params.get('section') !== 'suscripcion'
    ) {
      setSearchParams(
        { tab: 'empresa', section: 'suscripcion' },
        { replace: true },
      )
    }
  }, [subscriptionLocked, searchParams, setSearchParams])

  function setTab(next: SettingsTab) {
    if (subscriptionLocked) return
    setSearchParams(next === 'empresa' ? {} : { tab: next }, { replace: true })
  }

  let body: ReactNode = null
  if (tab === 'empresa')
    body = <EmpresaSettingsTab canWrite={canWriteCrmFields} />
  if (tab === 'tr069') body = <Tr069SettingsTab canWrite={canWriteNet} />
  if (tab === 'vlans') body = <VlansSettingsTab canWrite={canWriteNet} />
  if (tab === 'tv') body = <TvSettingsTab canWrite={canWriteNet} />
  if (tab === 'ip_pools') body = <IpPoolsSettingsTab canWrite={canWriteNet} />
  if (tab === 'onus') body = <OnuSettingsTab canWrite={canWriteNet} />
  if (tab === 'migracion')
    body = (
      <MigracionSettingsTab canWrite={canWriteNet && canWriteCrmFields} />
    )
  if (tab === 'nodos') body = <NodosSettingsTab canWrite={canWriteNet} />
  if (tab === 'plans')
    body = <ServicePlansSettingsTab canWrite={canWriteCrmFields} />
  if (tab === 'clientes')
    body = <ClientesSettingsTab canWrite={canWriteCrmFields} />
  if (tab === 'zonas') body = <ZonasSettingsTab canWrite={canWriteCrmFields} />
  if (tab === 'facturacion')
    body = <FacturacionSettingsTab canWrite={canWriteCrmFields} />
  if (tab === 'productos')
    body = <ProductosSettingsTab canWrite={canWriteCrmFields} />
  if (tab === 'suspension_portal' && portalEnabled)
    body = <SuspensionPortalSettingsTab canWrite={canWriteCrmFields} />

  return (
    <PanelShell
      title="Ajustes"
      subtitle="Configuración de la empresa"
      variant="tenant"
    >
      <nav
        aria-label="Secciones de ajustes"
        className="-mx-1 mb-5 flex flex-nowrap gap-x-4 overflow-x-auto overflow-y-hidden overscroll-x-contain border-b border-[var(--border)] px-1 touch-pan-x sm:gap-x-6 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {tabs.map((t) => {
          const active = tab === t.id
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={[
                '-mb-px shrink-0 border-b-2 pb-2.5 text-sm font-medium whitespace-nowrap transition',
                active
                  ? 'border-[var(--accent)] text-[var(--text)]'
                  : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text)]',
              ].join(' ')}
            >
              {t.label}
            </button>
          )
        })}
      </nav>

      {body}
    </PanelShell>
  )
}
