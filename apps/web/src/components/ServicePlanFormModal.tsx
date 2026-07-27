import { useEffect, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'
import type {
  PlanBillingAnchor,
  PlanBillingCycleDay,
  PlanServiceType,
  ServicePlan,
} from '../lib/crm'
import { useCompanyCurrency } from '../lib/currency'
import type { SpeedProfile } from '../lib/speed-profiles'
import { MoneyInput } from './MoneyInput'

const inputClass =
  'w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 outline-none ring-[var(--accent)] focus:ring-2'

const SERVICE_OPTIONS: { id: PlanServiceType; label: string }[] = [
  { id: 'internet', label: 'Internet' },
  { id: 'tv', label: 'TV' },
  { id: 'telephony', label: 'Telefonía' },
]

type PlanForm = {
  name: string
  price: string
  installationFee: string
  installationFeeOnFirstInvoice: boolean
  invoiceLabel: string
  speedProfileId: string
  billingAnchor: PlanBillingAnchor
  billingCycleDay: PlanBillingCycleDay
  serviceTypes: PlanServiceType[]
  isActive: boolean
}

const empty: PlanForm = {
  name: '',
  price: '0',
  installationFee: '0',
  installationFeeOnFirstInvoice: true,
  invoiceLabel: '',
  speedProfileId: '',
  billingAnchor: 'installation',
  billingCycleDay: 'first',
  serviceTypes: ['internet'],
  isActive: true,
}

export function ServicePlanFormModal({
  open,
  onClose,
  plan,
}: {
  open: boolean
  onClose: () => void
  plan?: ServicePlan | null
}) {
  const queryClient = useQueryClient()
  const currency = useCompanyCurrency()
  const [form, setForm] = useState<PlanForm>(empty)
  const [formError, setFormError] = useState<string | null>(null)

  const profilesQuery = useQuery({
    queryKey: ['app', 'speed-profiles'],
    queryFn: () => apiFetch<SpeedProfile[]>('/app/speed-profiles'),
    enabled: open,
  })

  const profiles = (profilesQuery.data ?? []).filter(
    (p) => p.isActive || p.id === form.speedProfileId,
  )
  const selectedProfile = profiles.find((p) => p.id === form.speedProfileId)

  useEffect(() => {
    if (!open) return
    setFormError(null)
    if (plan) {
      setForm({
        name: plan.name,
        price: String(plan.price),
        installationFee: String(plan.installationFee ?? 0),
        installationFeeOnFirstInvoice:
          plan.installationFeeOnFirstInvoice ?? true,
        invoiceLabel: plan.invoiceLabel,
        speedProfileId: plan.speedProfileId ?? '',
        billingAnchor: plan.billingAnchor ?? 'installation',
        billingCycleDay: plan.billingCycleDay ?? 'first',
        serviceTypes:
          plan.serviceTypes?.length > 0 ? [...plan.serviceTypes] : ['internet'],
        isActive: plan.isActive,
      })
    } else {
      setForm(empty)
    }
  }, [open, plan])

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const mutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => {
      if (plan) {
        return apiFetch<ServicePlan>(`/app/service-plans/${plan.id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        })
      }
      return apiFetch<ServicePlan>('/app/service-plans', {
        method: 'POST',
        body: JSON.stringify(payload),
      })
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['app', 'service-plans'] })
      void queryClient.invalidateQueries({ queryKey: ['app', 'dashboard'] })
      onClose()
    },
  })

  if (!open) return null

  function toggleService(id: PlanServiceType) {
    setForm((prev) => {
      const has = prev.serviceTypes.includes(id)
      const next = has
        ? prev.serviceTypes.filter((t) => t !== id)
        : [...prev.serviceTypes, id]
      return { ...prev, serviceTypes: next }
    })
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    setFormError(null)
    if (!form.speedProfileId) {
      setFormError('Selecciona un perfil de velocidad')
      return
    }
    if (form.serviceTypes.length === 0) {
      setFormError('Selecciona al menos un tipo de servicio')
      return
    }
    mutation.mutate({
      name: form.name.trim(),
      price: Number(form.price),
      installationFee: Number(form.installationFee || 0),
      installationFeeOnFirstInvoice: form.installationFeeOnFirstInvoice,
      invoiceLabel: form.invoiceLabel.trim() || form.name.trim(),
      speedProfileId: form.speedProfileId,
      billingAnchor: form.billingAnchor,
      billingCycleDay: form.billingCycleDay,
      serviceTypes: form.serviceTypes,
      isActive: form.isActive,
    })
  }

  function set<K extends keyof PlanForm>(key: K, value: PlanForm[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 sm:items-center">
      <div
        role="dialog"
        aria-modal="true"
        className="max-h-[min(92vh,100dvh)] overflow-y-auto w-full max-w-lg rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
          <h2 className="text-lg font-semibold">
            {plan ? 'Editar plan' : 'Nuevo plan'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2 py-1 text-[var(--text-muted)] hover:bg-[var(--bg)]"
          >
            ✕
          </button>
        </div>

        <form onSubmit={onSubmit} className="space-y-3 px-5 py-4">
          <label className="block text-sm">
            <span className="mb-1 block text-[var(--text-muted)]">Nombre</span>
            <input
              required
              className={inputClass}
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="mb-1 block text-[var(--text-muted)]">
                Precio mensual ({currency})
              </span>
              <MoneyInput
                required
                className={inputClass}
                currency={currency}
                value={form.price}
                onChange={(v) => set('price', v)}
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-[var(--text-muted)]">
                Etiqueta factura
              </span>
              <input
                className={inputClass}
                value={form.invoiceLabel}
                onChange={(e) => set('invoiceLabel', e.target.value)}
              />
            </label>
          </div>

          <label className="block text-sm">
            <span className="mb-1 block text-[var(--text-muted)]">
              Perfil de velocidad
            </span>
            <select
              required
              className={inputClass}
              value={form.speedProfileId}
              onChange={(e) => set('speedProfileId', e.target.value)}
              disabled={profilesQuery.isLoading}
            >
              <option value="">
                {profilesQuery.isLoading
                  ? 'Cargando perfiles…'
                  : 'Seleccionar perfil…'}
              </option>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} — ↓{p.downloadMbps} / ↑{p.uploadMbps} Mbps
                  {!p.isActive ? ' (inactivo)' : ''}
                </option>
              ))}
            </select>
            {selectedProfile ? (
              <span className="mt-1 block text-[11px] text-[var(--text-muted)]">
                Enlazado a {selectedProfile.name}
                {selectedProfile.oltProfileName
                  ? ` · OLT ${selectedProfile.oltProfileName}`
                  : ''}
              </span>
            ) : profiles.length === 0 && !profilesQuery.isLoading ? (
              <span className="mt-1 block text-[11px] text-amber-300">
                Crea un perfil en Planes → Perfiles de velocidad primero.
              </span>
            ) : null}
          </label>

          <fieldset className="space-y-2 rounded-lg border border-[var(--border)] px-3 py-3">
            <legend className="px-1 text-sm text-[var(--text-muted)]">
              Facturación (siempre mensual)
            </legend>
            <label className="block text-sm">
              <span className="mb-1 block text-[var(--text-muted)]">
                Costo de instalación ({currency})
              </span>
              <MoneyInput
                className={inputClass}
                currency={currency}
                value={form.installationFee}
                onChange={(v) => set('installationFee', v || '0')}
              />
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={form.installationFeeOnFirstInvoice}
                onChange={(e) =>
                  set('installationFeeOnFirstInvoice', e.target.checked)
                }
              />
              <span>
                Añadir a la primera factura
                <span className="mt-0.5 block text-[11px] text-[var(--text-muted)]">
                  {form.installationFeeOnFirstInvoice
                    ? 'El cargo de instalación se suma a la primera factura periódica.'
                    : 'Al dar de alta el plan a un cliente se genera de inmediato una factura de instalación.'}
                </span>
              </span>
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-[var(--text-muted)]">
                Inicio del ciclo
              </span>
              <select
                className={inputClass}
                value={form.billingAnchor}
                onChange={(e) =>
                  set('billingAnchor', e.target.value as PlanBillingAnchor)
                }
              >
                <option value="installation">Desde el día de instalación</option>
                <option value="calendar_month">Inicio del mes (calendario)</option>
              </select>
              <span className="mt-1 block text-[11px] text-[var(--text-muted)]">
                {form.billingAnchor === 'installation'
                  ? 'Ciclos mensuales que empiezan el mismo día de la instalación.'
                  : 'Ciclos por mes calendario. El primer mes se prorratea a los días restantes.'}
              </span>
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-[var(--text-muted)]">
                Día de inicio del ciclo
              </span>
              <select
                className={inputClass}
                value={form.billingCycleDay}
                onChange={(e) =>
                  set('billingCycleDay', e.target.value as PlanBillingCycleDay)
                }
              >
                <option value="first">Primero</option>
                <option value="last">Último</option>
              </select>
              <span className="mt-1 block text-[11px] text-[var(--text-muted)]">
                {form.billingCycleDay === 'first'
                  ? 'El ciclo / cobro se ancla al primer día del periodo.'
                  : 'El ciclo / cobro se ancla al último día del periodo.'}
              </span>
            </label>
          </fieldset>

          <fieldset className="space-y-2">
            <legend className="mb-1 text-sm text-[var(--text-muted)]">
              Tipo de servicio
            </legend>
            <div className="flex flex-wrap gap-3">
              {SERVICE_OPTIONS.map((opt) => (
                <label
                  key={opt.id}
                  className="inline-flex items-center gap-2 text-sm"
                >
                  <input
                    type="checkbox"
                    checked={form.serviceTypes.includes(opt.id)}
                    onChange={() => toggleService(opt.id)}
                  />
                  {opt.label}
                </label>
              ))}
            </div>
          </fieldset>

          <label className="inline-flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(e) => set('isActive', e.target.checked)}
            />
            Activo
          </label>

          {(formError || mutation.error) && (
            <p className="text-sm text-[var(--danger)]">
              {formError || mutation.error?.message}
            </p>
          )}

          <div className="flex justify-end gap-2 border-t border-[var(--border)] pt-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={mutation.isPending || !form.speedProfileId}
              className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-60"
            >
              {mutation.isPending ? 'Guardando…' : 'Guardar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
