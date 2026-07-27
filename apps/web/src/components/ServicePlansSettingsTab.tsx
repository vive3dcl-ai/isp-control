import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'
import { type ServicePlan } from '../lib/crm'
import { useMoney } from '../lib/currency'
import { ServicePlanFormModal } from './ServicePlanFormModal'
import { SpeedProfilesSettingsTab } from './SpeedProfilesSettingsTab'
import { useNotify } from './NotifyProvider'
import { SettingsSubTabs } from './SettingsSubTabs'

type PlansSection = 'plans' | 'speed_profiles'

export function ServicePlansSettingsTab({ canWrite }: { canWrite: boolean }) {
  const { confirm } = useNotify()
  const queryClient = useQueryClient()
  const [section, setSection] = useState<PlansSection>('plans')
  const [createOpen, setCreateOpen] = useState(false)
  const [editPlan, setEditPlan] = useState<ServicePlan | null>(null)
  const money = useMoney()

  const plansQuery = useQuery({
    queryKey: ['app', 'service-plans'],
    queryFn: () => apiFetch<ServicePlan[]>('/app/service-plans'),
    enabled: section === 'plans',
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/app/service-plans/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['app', 'service-plans'] })
      void queryClient.invalidateQueries({ queryKey: ['app', 'dashboard'] })
    },
  })

  const plans = plansQuery.data ?? []

  return (
    <div className="space-y-4">
      <SettingsSubTabs
        value={section}
        onChange={setSection}
        tabs={
          [
            { id: 'plans', label: 'Planes' },
            { id: 'speed_profiles', label: 'Perfiles de velocidad' },
          ] as const
        }
      />

      {section === 'speed_profiles' ? (
        <SpeedProfilesSettingsTab canWrite={canWrite} />
      ) : (
        <div>
          <div className="mb-6 flex items-center justify-between gap-3">
            <p className="text-sm text-[var(--text-muted)]">
              Precios, velocidades y periodo de facturación.
            </p>
            {canWrite && (
              <button
                type="button"
                onClick={() => setCreateOpen(true)}
                className="shrink-0 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)]"
              >
                Nuevo plan
              </button>
            )}
          </div>

          {plansQuery.error && (
            <p className="mb-4 text-sm text-[var(--danger)]">
              {plansQuery.error.message}
            </p>
          )}

          <div className="overflow-x-auto overflow-hidden rounded-xl border border-[var(--border)]">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="bg-[var(--bg)] text-[var(--text-muted)]">
                <tr>
                  <th className="px-4 py-3 font-medium">Nombre</th>
                  <th className="px-4 py-3 font-medium">Precio</th>
                  <th className="px-4 py-3 font-medium">Perfil</th>
                  <th className="px-4 py-3 font-medium">Facturación</th>
                  <th className="px-4 py-3 font-medium">Estado</th>
                  <th className="px-4 py-3 font-medium">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {plansQuery.isLoading && (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-4 py-6 text-[var(--text-muted)]"
                    >
                      Cargando…
                    </td>
                  </tr>
                )}
                {!plansQuery.isLoading && plans.length === 0 && (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-4 py-6 text-[var(--text-muted)]"
                    >
                      No hay planes todavía.
                    </td>
                  </tr>
                )}
                {plans.map((p) => (
                  <tr key={p.id} className="border-t border-[var(--border)]">
                    <td className="px-4 py-3">
                      <div className="font-medium">{p.name}</div>
                      <div className="text-xs text-[var(--text-muted)]">
                        {p.type}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div>{money(p.price)}</div>
                      {Number(p.installationFee) > 0 && (
                        <div className="text-xs text-[var(--text-muted)]">
                          Inst. {money(p.installationFee)}
                          {p.installationFeeOnFirstInvoice
                            ? ' · 1.ª factura'
                            : ' · inmediata'}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {p.speedProfile ? (
                        <div>
                          <div className="font-medium">{p.speedProfile.name}</div>
                          <div className="text-xs text-[var(--text-muted)]">
                            ↓{p.speedProfile.downloadMbps} / ↑
                            {p.speedProfile.uploadMbps} Mbps
                          </div>
                        </div>
                      ) : (
                        <span className="text-[var(--text-muted)]">
                          {p.downloadSpeed}/{p.uploadSpeed} Mbps
                          <span className="ml-1 text-amber-300">(sin perfil)</span>
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div>
                        {p.billingAnchor === 'calendar_month'
                          ? 'Inicio de mes'
                          : 'Día de instalación'}
                      </div>
                      <div className="text-xs text-[var(--text-muted)]">
                        Ciclo {p.billingCycleDay === 'last' ? 'último' : 'primero'}
                        {p.billingAnchor === 'calendar_month'
                          ? ' · 1.er mes prorrateado'
                          : ''}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {p.isActive ? 'Activo' : 'Inactivo'}
                    </td>
                    <td className="px-4 py-3">
                      {canWrite && (
                        <div className="flex flex-wrap gap-1.5">
                          <button
                            type="button"
                            onClick={() => setEditPlan(p)}
                            className="rounded-md border border-[var(--border)] px-2.5 py-1 text-xs hover:border-[var(--accent)] hover:text-[var(--accent)]"
                          >
                            Editar
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              void confirm(`¿Eliminar el plan ${p.name}?`, {
                                title: 'Eliminar plan',
                                danger: true,
                                confirmLabel: 'Eliminar',
                              }).then((ok) => {
                                if (ok) deleteMutation.mutate(p.id)
                              })
                            }}
                            className="rounded-md border border-[var(--border)] px-2.5 py-1 text-xs text-[var(--danger)] hover:border-[var(--danger)]"
                          >
                            Eliminar
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ServicePlanFormModal
            open={createOpen}
            onClose={() => setCreateOpen(false)}
          />
          <ServicePlanFormModal
            open={!!editPlan}
            plan={editPlan}
            onClose={() => setEditPlan(null)}
          />
        </div>
      )}
    </div>
  )
}
