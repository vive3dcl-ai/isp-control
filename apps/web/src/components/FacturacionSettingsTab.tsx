import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'
import {
  CRON_PRESETS,
  TEMPLATE_TYPE_LABELS,
  isProfessionalTemplate,
  professionalInvoiceBodyHtml,
  renderTemplatePlaceholders,
  sampleTemplateVars,
  type BillingJobKind,
  type BillingSettings,
  type Invoice,
  type InvoiceTemplate,
  type InvoiceTemplateType,
} from '../lib/billing'
import { formatMoney, useCompanyCurrency } from '../lib/currency'
import type { CompanyProfile } from '../lib/company'
import { billingTimezonesForCountry } from '../lib/billing-timezones'
import { useNotify } from './NotifyProvider'
import { SettingsSubTabs } from './SettingsSubTabs'
import { CreateInvoiceModal } from './CreateInvoiceModal'
import { ModalPortal } from './ModalPortal'
import {
  DesktopTableWrap,
  MobileList,
  MobileListCard,
  MobileListEmpty,
  MobileListMeta,
} from './MobileList'


const inputClass =
  'w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 outline-none ring-[var(--accent)] focus:ring-2'

type Section = 'crons' | 'templates' | 'invoices'

export function FacturacionSettingsTab({ canWrite }: { canWrite: boolean }) {
  const [section, setSection] = useState<Section>('crons')

  return (
    <div className="space-y-4">
      <SettingsSubTabs
        value={section}
        onChange={setSection}
        tabs={
          [
            { id: 'crons', label: 'Cobros automáticos' },
            { id: 'templates', label: 'Plantillas' },
            { id: 'invoices', label: 'Facturas recientes' },
          ] as const
        }
      />
      {section === 'crons' && <BillingCronsPanel canWrite={canWrite} />}
      {section === 'templates' && <BillingTemplatesPanel canWrite={canWrite} />}
      {section === 'invoices' && <BillingInvoicesPanel canWrite={canWrite} />}
    </div>
  )
}

function BillingCronsPanel({ canWrite }: { canWrite: boolean }) {
  const queryClient = useQueryClient()
  const { confirm } = useNotify()
  const [form, setForm] = useState<Partial<BillingSettings> | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  const query = useQuery({
    queryKey: ['app', 'settings', 'billing'],
    queryFn: () => apiFetch<BillingSettings>('/app/settings/billing'),
  })
  const companyQuery = useQuery({
    queryKey: ['app', 'settings', 'company'],
    queryFn: () => apiFetch<CompanyProfile>('/app/settings/company'),
  })

  useEffect(() => {
    if (query.data) setForm(query.data)
  }, [query.data])

  const timezoneOptions = useMemo(
    () => billingTimezonesForCountry(companyQuery.data?.country),
    [companyQuery.data?.country],
  )

  useEffect(() => {
    if (!form || timezoneOptions.length === 0) return
    if (timezoneOptions.some((option) => option.value === form.timezone)) return
    setForm((current) =>
      current ? { ...current, timezone: timezoneOptions[0].value } : current,
    )
  }, [form?.timezone, timezoneOptions])

  const saveMutation = useMutation({
    mutationFn: (payload: Partial<BillingSettings>) =>
      apiFetch<BillingSettings>('/app/settings/billing', {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }),
    onSuccess: (data) => {
      void queryClient.setQueryData(['app', 'settings', 'billing'], data)
      setForm(data)
      setMsg('Cambios guardados')
    },
  })

  const runMutation = useMutation({
    mutationFn: (job: BillingJobKind) =>
      apiFetch<{ ok: boolean; jobId?: string }>('/app/settings/billing/run', {
        method: 'POST',
        body: JSON.stringify({ job }),
      }),
    onSuccess: () => {
      setMsg('Tarea en marcha. Puedes revisar el resultado en un momento.')
      void queryClient.invalidateQueries({
        queryKey: ['app', 'settings', 'billing'],
      })
      void queryClient.invalidateQueries({
        queryKey: ['app', 'settings', 'billing', 'invoices'],
      })
    },
  })

  if (!form) {
    return (
      <p className="text-sm text-[var(--text-muted)]">
        {query.isLoading ? 'Cargando…' : 'No se pudo cargar la configuración.'}
      </p>
    )
  }

  function set<K extends keyof BillingSettings>(
    key: K,
    value: BillingSettings[K],
  ) {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev))
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    setMsg(null)
    saveMutation.mutate({
      timezone: form!.timezone,
      invoicePrefix: form!.invoicePrefix,
      periodsEnabled: form!.periodsEnabled,
      periodsCron: form!.periodsCron,
      generateEnabled: form!.generateEnabled,
      generateCron: form!.generateCron,
      sendEnabled: form!.sendEnabled,
      sendCron: form!.sendCron,
      defaultDueDays: form!.defaultDueDays,
      graceDaysAfterDue: form!.graceDaysAfterDue,
      billingCycleDay: form!.billingCycleDay,
      billingRegime: form!.billingRegime ?? 'calendar_month',
    })
  }

  async function runJob(label: string, job: BillingJobKind) {
    if (
      !(await confirm(`¿Ejecutar ahora «${label}»?`, {
        title: 'Ejecutar ahora',
        confirmLabel: 'Ejecutar',
      }))
    ) {
      return
    }
    setMsg(null)
    runMutation.mutate(job)
  }

  return (
    <form onSubmit={onSubmit} className="w-full space-y-5">
      {msg && (
        <p className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm">
          {msg}
        </p>
      )}

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="rounded-xl border border-[var(--border)] bg-[var(--bg)] px-4 py-4 text-sm text-[var(--text-muted)] xl:col-span-1">
          <h3 className="mb-2 font-medium text-[var(--text)]">
            Flujo de facturación
          </h3>
          <p>
            Aquí eliges el régimen de cobro de la empresa, cuándo se generan
            las facturas y cuándo se envían a los clientes.
          </p>
          <p className="mt-2">
            Los cargos inmediatos, como una instalación, no esperan estos
            horarios: se emiten al dar de alta el servicio.
          </p>
        </div>

        <div className="rounded-xl border border-[var(--border)] bg-[var(--bg)] p-4 xl:col-span-2">
          <h3 className="mb-3 text-sm font-medium">Configuración general</h3>
          <div className="grid gap-3 md:grid-cols-3">
            <label className="block text-sm">
              <span className="mb-1 block text-[var(--text-muted)]">
                Zona horaria
              </span>
              <select
                className={inputClass}
                disabled={!canWrite || timezoneOptions.length === 0}
                value={
                  timezoneOptions.some(
                    (option) => option.value === form.timezone,
                  )
                    ? form.timezone
                    : ''
                }
                onChange={(e) => set('timezone', e.target.value)}
              >
                {timezoneOptions.length === 0 ? (
                  <option value="">
                    Selecciona un país en Empresa
                  </option>
                ) : (
                  timezoneOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))
                )}
              </select>
              <span className="mt-1 block text-[11px] text-[var(--text-muted)]">
                {companyQuery.data?.country
                  ? `Zonas disponibles para ${companyQuery.data.country}`
                  : 'El país se configura en Ajustes → Empresa'}
              </span>
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-[var(--text-muted)]">
                Prefijo del documento
              </span>
              <input
                className={inputClass}
                disabled={!canWrite}
                value={form.invoicePrefix ?? 'F'}
                onChange={(e) => set('invoicePrefix', e.target.value)}
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-[var(--text-muted)]">
                Días para pagar
              </span>
              <input
                type="number"
                min={1}
                max={90}
                className={inputClass}
                disabled={!canWrite}
                value={form.defaultDueDays ?? 5}
                onChange={(e) =>
                  set('defaultDueDays', Number(e.target.value))
                }
              />
              <span className="mt-1 block text-[11px] text-[var(--text-muted)]">
                Plazo desde la emisión de la factura (p. ej. 5 = vence 5 días
                después).
              </span>
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-[var(--text-muted)]">
                Días de gracia tras vencimiento
              </span>
              <input
                type="number"
                min={0}
                max={30}
                className={inputClass}
                disabled={!canWrite}
                value={form.graceDaysAfterDue ?? 2}
                onChange={(e) =>
                  set('graceDaysAfterDue', Number(e.target.value))
                }
              />
              <span className="mt-1 block text-[11px] text-[var(--text-muted)]">
                Tras el vencimiento, antes del corte automático del servicio.
              </span>
            </label>
            {form.billingRegime !== 'from_install' && (
              <label className="block text-sm">
                <span className="mb-1 block text-[var(--text-muted)]">
                  Día de inicio del ciclo
                </span>
                <input
                  type="number"
                  min={1}
                  max={28}
                  className={inputClass}
                  disabled={!canWrite}
                  value={form.billingCycleDay ?? 1}
                  onChange={(e) =>
                    set('billingCycleDay', Number(e.target.value))
                  }
                />
                <span className="mt-1 block text-[11px] text-[var(--text-muted)]">
                  Día del mes en que se genera la factura mensual (1–28).
                </span>
              </label>
            )}
          </div>
          <fieldset className="mt-4 space-y-2">
            <legend className="text-sm font-medium text-[var(--text)]">
              Régimen de facturación
            </legend>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                className="mt-1"
                name="billingRegime"
                disabled={!canWrite}
                checked={
                  (form.billingRegime ?? 'calendar_month') === 'calendar_month'
                }
                onChange={() => set('billingRegime', 'calendar_month')}
              />
              <span>
                <span className="font-medium">Facturación mensual</span>
                <span className="mt-0.5 block text-[11px] text-[var(--text-muted)]">
                  Cobro fijo una vez al mes. El primer mes se prorratea. Usa el
                  día de inicio del ciclo, {form.defaultDueDays ?? 5} días para
                  pagar y {form.graceDaysAfterDue ?? 2} días de gracia antes del
                  corte automático.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                className="mt-1"
                name="billingRegime"
                disabled={!canWrite}
                checked={form.billingRegime === 'from_install'}
                onChange={() => set('billingRegime', 'from_install')}
              />
              <span>
                <span className="font-medium">Desde instalación</span>
                <span className="mt-0.5 block text-[11px] text-[var(--text-muted)]">
                  Cada cliente factura el día del mes en que se instaló (o cobro
                  proporcional opcional al alta). {form.defaultDueDays ?? 5}{' '}
                  días para pagar y {form.graceDaysAfterDue ?? 2} de gracia antes
                  del corte. En importados sin fecha se pide el día de
                  instalación.
                </span>
              </span>
            </label>
          </fieldset>
          <p className="mt-3 text-xs text-[var(--text-muted)]">
            Próximo número:{' '}
            <span className="font-medium text-[var(--text)]">
              {form.invoicePrefix}-
              {String(form.nextInvoiceNumber).padStart(5, '0')}
            </span>
          </p>
        </div>
      </div>

      <div className="grid items-stretch gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {form.billingRegime !== 'from_install' && (
        <ScheduleCard
          title="Actualizar períodos de servicio"
          description="Mantiene al día el mes en curso de cada contrato (inicio, fin y próxima fecha de cobro)."
          enabled={!!form.periodsEnabled}
          cron={form.periodsCron ?? ''}
          lastRun={form.periodsLastRunAt}
          canWrite={canWrite}
          onEnabled={(v) => set('periodsEnabled', v)}
          onCron={(v) => set('periodsCron', v)}
          onRun={() => void runJob('Actualizar períodos', 'periods')}
          running={runMutation.isPending}
        />
        )}
        <ScheduleCard
          title="Generar facturas del período"
          description={
            form.billingRegime === 'from_install'
              ? 'Crea la factura de cada cliente cuando llega el aniversario de instalación. Mismos envíos y días de gracia.'
              : 'Crea las facturas mensuales (y prorrateos) cuando llega la fecha de cobro. No incluye las que ya se emitieron al instante.'
          }
          enabled={!!form.generateEnabled}
          cron={form.generateCron ?? ''}
          lastRun={form.generateLastRunAt}
          canWrite={canWrite}
          onEnabled={(v) => set('generateEnabled', v)}
          onCron={(v) => set('generateCron', v)}
          onRun={() => void runJob('Generar facturas', 'generate')}
          running={runMutation.isPending}
        />
        <ScheduleCard
          title="Enviar facturas a clientes"
          description="Envía el PDF por correo y, si el módulo WhatsApp está activo y configurado, también por WhatsApp. Las inmediatas se pueden enviar al generarlas."
          enabled={!!form.sendEnabled}
          cron={form.sendCron ?? ''}
          lastRun={form.sendLastRunAt}
          canWrite={canWrite}
          onEnabled={(v) => set('sendEnabled', v)}
          onCron={(v) => set('sendCron', v)}
          onRun={() => void runJob('Enviar facturas', 'send')}
          running={runMutation.isPending}
        />
      </div>

      {canWrite && (
        <button
          type="submit"
          disabled={saveMutation.isPending}
          className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-60"
        >
          {saveMutation.isPending ? 'Guardando…' : 'Guardar'}
        </button>
      )}
      {saveMutation.isError && (
        <p className="text-sm text-red-400">
          {(saveMutation.error as Error).message}
        </p>
      )}
    </form>
  )
}

function ScheduleCard({
  title,
  description,
  enabled,
  cron,
  lastRun,
  canWrite,
  onEnabled,
  onCron,
  onRun,
  running,
}: {
  title: string
  description: string
  enabled: boolean
  cron: string
  lastRun: string | null | undefined
  canWrite: boolean
  onEnabled: (v: boolean) => void
  onCron: (v: string) => void
  onRun: () => void
  running: boolean
}) {
  const knownPreset = CRON_PRESETS.some((p) => p.value === cron)
  const [customMode, setCustomMode] = useState(!knownPreset)

  return (
    <fieldset className="flex h-full min-w-0 flex-col gap-3 rounded-xl border border-[var(--border)] px-4 py-3">
      <legend className="px-1 text-sm font-medium">{title}</legend>
      <p className="text-xs text-[var(--text-muted)]">{description}</p>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={enabled}
          disabled={!canWrite}
          onChange={(e) => onEnabled(e.target.checked)}
        />
        Activar esta tarea
      </label>
      <label className="block text-sm">
        <span className="mb-1 block text-[var(--text-muted)]">
          Cuándo se ejecuta
        </span>
        <select
          className={inputClass}
          disabled={!canWrite}
          value={customMode || !knownPreset ? '__custom__' : cron}
          onChange={(e) => {
            if (e.target.value === '__custom__') {
              setCustomMode(true)
              return
            }
            setCustomMode(false)
            onCron(e.target.value)
          }}
        >
          {CRON_PRESETS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
          <option value="__custom__">Otro horario…</option>
        </select>
        {(customMode || !knownPreset) && (
          <input
            className={`${inputClass} mt-2 font-mono text-sm`}
            disabled={!canWrite}
            value={cron}
            onChange={(e) => onCron(e.target.value)}
            placeholder="Ej.: 0 8 * * * (minuto hora día mes día-semana)"
          />
        )}
      </label>
      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--text-muted)]">
        <span>
          Última vez:{' '}
          {lastRun
            ? new Date(lastRun).toLocaleString()
            : 'aún no se ha ejecutado'}
        </span>
        {canWrite && (
          <button
            type="button"
            disabled={running}
            onClick={onRun}
            className="rounded-md border border-[var(--border)] px-2.5 py-1 hover:bg-[var(--bg)] disabled:opacity-50"
          >
            Ejecutar ahora
          </button>
        )}
      </div>
    </fieldset>
  )
}

function BillingTemplatesPanel({ canWrite }: { canWrite: boolean }) {
  const queryClient = useQueryClient()
  const { confirm } = useNotify()
  const [edit, setEdit] = useState<InvoiceTemplate | null>(null)
  const [creating, setCreating] = useState(false)
  const [preview, setPreview] = useState<{
    name: string
    subject: string
    bodyHtml: string
  } | null>(null)

  const query = useQuery({
    queryKey: ['app', 'settings', 'billing', 'templates'],
    queryFn: () =>
      apiFetch<InvoiceTemplate[]>('/app/settings/billing/templates'),
    refetchOnMount: 'always',
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/app/settings/billing/templates/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ['app', 'settings', 'billing', 'templates'],
      })
    },
  })

  const resetMutation = useMutation({
    mutationFn: () =>
      apiFetch<InvoiceTemplate[]>(
        '/app/settings/billing/templates/reset-defaults',
        { method: 'POST' },
      ),
    onSuccess: (data) => {
      void queryClient.setQueryData(
        ['app', 'settings', 'billing', 'templates'],
        data,
      )
    },
  })

  const templates = query.data ?? []

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-sm text-[var(--text-muted)]">
          Plantillas por tipo: servicio, instalación, prorrateo, nota de crédito,
          manual y personalizada. Placeholders: {'{{client.name}}'},{' '}
          {'{{invoice.number}}'}, {'{{company.name}}'}, etc.
        </p>
        {canWrite && (
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              disabled={resetMutation.isPending}
              onClick={() => {
                void (async () => {
                  if (
                    !(await confirm(
                      'Se sobreescribirán las plantillas por defecto (servicio, instalación, prorrateo, nota de crédito, manual) con el diseño profesional. Tus plantillas personalizadas no se tocan.',
                      {
                        title: 'Restaurar plantillas profesionales',
                        confirmLabel: 'Restaurar',
                      },
                    ))
                  ) {
                    return
                  }
                  resetMutation.mutate()
                })()
              }}
              className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm hover:bg-[var(--bg)] disabled:opacity-60"
            >
              {resetMutation.isPending ? 'Restaurando…' : 'Diseño profesional'}
            </button>
            <button
              type="button"
              onClick={() => {
                setCreating(true)
                setEdit(null)
              }}
              className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-white hover:bg-[var(--accent-hover)]"
            >
              Nueva plantilla
            </button>
          </div>
        )}
      </div>

      <MobileList>
        {query.isLoading && <MobileListEmpty>Cargando…</MobileListEmpty>}
        {!query.isLoading && templates.length === 0 && (
          <MobileListEmpty>Sin plantillas.</MobileListEmpty>
        )}
        {templates.map((t) => (
          <MobileListCard key={t.id}>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{t.name}</p>
              <p className="truncate text-xs text-[var(--text-muted)]">
                {t.subject}
              </p>
            </div>
            <MobileListMeta>
              <span>
                {TEMPLATE_TYPE_LABELS[t.type] ?? t.type}
                {t.isDefault ? ' (default)' : ''}
              </span>
              <span>·</span>
              <span>{t.isActive ? 'Activa' : 'Inactiva'}</span>
            </MobileListMeta>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <button
                type="button"
                className="rounded-md border border-[var(--border)] px-2 py-1 text-xs hover:bg-[var(--bg)]"
                onClick={() =>
                  setPreview({
                    name: t.name,
                    subject: t.subject,
                    bodyHtml: t.bodyHtml,
                  })
                }
              >
                Preview
              </button>
              {canWrite && (
                <>
                  <button
                    type="button"
                    className="rounded-md border border-[var(--border)] px-2 py-1 text-xs hover:bg-[var(--bg)]"
                    onClick={() => {
                      setEdit(t)
                      setCreating(false)
                    }}
                  >
                    Editar
                  </button>
                  <button
                    type="button"
                    className="rounded-md border border-red-500/40 px-2 py-1 text-xs text-red-300 hover:bg-red-500/10"
                    onClick={() => {
                      void (async () => {
                        if (
                          !(await confirm(`¿Eliminar «${t.name}»?`, {
                            title: 'Eliminar plantilla',
                            confirmLabel: 'Eliminar',
                            danger: true,
                          }))
                        ) {
                          return
                        }
                        deleteMutation.mutate(t.id)
                      })()
                    }}
                  >
                    Eliminar
                  </button>
                </>
              )}
            </div>
          </MobileListCard>
        ))}
      </MobileList>

      <DesktopTableWrap>
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="bg-[var(--bg)] text-[var(--text-muted)]">
            <tr>
              <th className="px-4 py-3 font-medium">Nombre</th>
              <th className="px-4 py-3 font-medium">Tipo</th>
              <th className="px-4 py-3 font-medium">Estado</th>
              <th className="px-4 py-3 font-medium">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {query.isLoading && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-[var(--text-muted)]">
                  Cargando…
                </td>
              </tr>
            )}
            {!query.isLoading && templates.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-[var(--text-muted)]">
                  Sin plantillas.
                </td>
              </tr>
            )}
            {templates.map((t) => (
              <tr key={t.id} className="border-t border-[var(--border)]">
                <td className="px-4 py-3">
                  <div className="font-medium">{t.name}</div>
                  <div className="text-xs text-[var(--text-muted)]">
                    {t.subject}
                  </div>
                </td>
                <td className="px-4 py-3">
                  {TEMPLATE_TYPE_LABELS[t.type] ?? t.type}
                  {t.isDefault ? (
                    <span className="ml-1 text-xs text-[var(--accent)]">
                      (default)
                    </span>
                  ) : null}
                </td>
                <td className="px-4 py-3">
                  {t.isActive ? 'Activa' : 'Inactiva'}
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      className="rounded-md border border-[var(--border)] px-2 py-1 text-xs hover:bg-[var(--bg)]"
                      onClick={() =>
                        setPreview({
                          name: t.name,
                          subject: t.subject,
                          bodyHtml: t.bodyHtml,
                        })
                      }
                    >
                      Preview
                    </button>
                    {canWrite && (
                      <>
                        <button
                          type="button"
                          className="rounded-md border border-[var(--border)] px-2 py-1 text-xs hover:bg-[var(--bg)]"
                          onClick={() => {
                            setEdit(t)
                            setCreating(false)
                          }}
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          className="rounded-md border border-red-500/40 px-2 py-1 text-xs text-red-300 hover:bg-red-500/10"
                          onClick={() => {
                            void (async () => {
                              if (
                                !(await confirm(`¿Eliminar «${t.name}»?`, {
                                  title: 'Eliminar plantilla',
                                  confirmLabel: 'Eliminar',
                                  danger: true,
                                }))
                              ) {
                                return
                              }
                              deleteMutation.mutate(t.id)
                            })()
                          }}
                        >
                          Eliminar
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </DesktopTableWrap>

      {(creating || edit) && (
        <TemplateFormModal
          template={edit}
          onClose={() => {
            setCreating(false)
            setEdit(null)
          }}
          onPreview={(draft) => setPreview(draft)}
        />
      )}

      {preview && (
        <TemplatePreviewModal
          name={preview.name}
          subject={preview.subject}
          bodyHtml={preview.bodyHtml}
          onClose={() => setPreview(null)}
        />
      )}
    </div>
  )
}

function TemplatePreviewModal({
  name,
  subject,
  bodyHtml,
  onClose,
}: {
  name: string
  subject: string
  bodyHtml: string
  onClose: () => void
}) {
  const companyQuery = useQuery({
    queryKey: ['app', 'settings', 'company'],
    queryFn: () => apiFetch<CompanyProfile>('/app/settings/company'),
    staleTime: 5 * 60_000,
  })
  const vars = sampleTemplateVars(companyQuery.data)
  /** If DB still has the old simple HTML, preview the professional layout. */
  const sourceHtml = isProfessionalTemplate(bodyHtml)
    ? bodyHtml
    : professionalInvoiceBodyHtml()
  const renderedSubject = renderTemplatePlaceholders(subject, vars)
  const renderedBody = renderTemplatePlaceholders(sourceHtml, vars)
  const srcDoc = `<!DOCTYPE html><html><head><meta charset="utf-8"/><style>
    html,body{margin:0;padding:0;background:#f3f4f6;}
    body{padding:24px;}
    *{box-sizing:border-box;}
  </style></head><body>${renderedBody || '<p><em>(plantilla vacía)</em></p>'}</body></html>`

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <ModalPortal><div className="fixed inset-0 z-[110] modal-backdrop flex items-stretch justify-center overflow-hidden bg-black/60 sm:items-center sm:p-4">
      <div className="flex h-[100dvh] max-h-[100dvh] w-full max-w-3xl flex-col overflow-hidden rounded-none border-0 sm:h-auto sm:max-h-[min(92dvh,920px)] sm:rounded-xl sm:border border-[var(--border)] bg-[var(--bg-elevated)] shadow-xl">
        <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold">Preview · {name}</h2>
            <p className="text-xs text-[var(--text-muted)]">
              Datos de ejemplo · asunto: {renderedSubject || '(vacío)'}
              {!isProfessionalTemplate(bodyHtml) ? (
                <span className="ml-1 text-amber-300">
                  · mostrando diseño profesional (plantilla actualizada en
                  servidor)
                </span>
              ) : null}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2 py-1 text-[var(--text-muted)] hover:bg-[var(--bg)]"
          >
            ✕
          </button>
        </div>
        <div className="flex-1 overflow-hidden bg-zinc-100 px-3 py-3">
          <iframe
            title={`Preview ${name}`}
            srcDoc={srcDoc}
            className="h-[min(70vh,720px)] w-full rounded-lg border border-[var(--border)] bg-white"
            sandbox=""
          />
        </div>
        <div className="flex justify-end border-t border-[var(--border)] px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm hover:bg-[var(--bg)]"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div></ModalPortal>
  )
}

function TemplateFormModal({
  template,
  onClose,
  onPreview,
}: {
  template: InvoiceTemplate | null
  onClose: () => void
  onPreview: (draft: {
    name: string
    subject: string
    bodyHtml: string
  }) => void
}) {
  const queryClient = useQueryClient()
  const [type, setType] = useState<InvoiceTemplateType>(
    template?.type ?? 'custom',
  )
  const [name, setName] = useState(template?.name ?? '')
  const [subject, setSubject] = useState(template?.subject ?? '')
  const [bodyHtml, setBodyHtml] = useState(template?.bodyHtml ?? '')
  const [isDefault, setIsDefault] = useState(template?.isDefault ?? false)
  const [isActive, setIsActive] = useState(template?.isActive ?? true)

  const mutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => {
      if (template) {
        return apiFetch(`/app/settings/billing/templates/${template.id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        })
      }
      return apiFetch('/app/settings/billing/templates', {
        method: 'POST',
        body: JSON.stringify(payload),
      })
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ['app', 'settings', 'billing', 'templates'],
      })
      onClose()
    },
  })

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    mutation.mutate({
      type,
      name: name.trim(),
      subject: subject.trim(),
      bodyHtml,
      isDefault,
      isActive,
    })
  }

  return (
    <ModalPortal><div className="fixed inset-0 z-[100] modal-backdrop flex items-stretch justify-center overflow-hidden bg-black/60 sm:items-center sm:p-4">
      <div className="h-[100dvh] max-h-[100dvh] overflow-y-auto overscroll-contain w-full max-w-2xl rounded-none border-0 sm:h-auto sm:max-h-[min(92dvh,920px)] sm:rounded-xl sm:border border-[var(--border)] bg-[var(--bg-elevated)] shadow-xl">
        <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
          <h2 className="text-lg font-semibold">
            {template ? 'Editar plantilla' : 'Nueva plantilla'}
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
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="mb-1 block text-[var(--text-muted)]">Tipo</span>
              <select
                className={inputClass}
                value={type}
                onChange={(e) => setType(e.target.value as InvoiceTemplateType)}
              >
                {(Object.keys(TEMPLATE_TYPE_LABELS) as InvoiceTemplateType[]).map(
                  (k) => (
                    <option key={k} value={k}>
                      {TEMPLATE_TYPE_LABELS[k]}
                    </option>
                  ),
                )}
              </select>
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-[var(--text-muted)]">Nombre</span>
              <input
                required
                className={inputClass}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
          </div>
          <label className="block text-sm">
            <span className="mb-1 block text-[var(--text-muted)]">Asunto</span>
            <input
              className={inputClass}
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-[var(--text-muted)]">
              Cuerpo HTML
            </span>
            <textarea
              rows={10}
              className={`${inputClass} font-mono text-xs`}
              value={bodyHtml}
              onChange={(e) => setBodyHtml(e.target.value)}
            />
          </label>
          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={isDefault}
                onChange={(e) => setIsDefault(e.target.checked)}
              />
              Default del tipo
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
              />
              Activa
            </label>
          </div>
          {mutation.isError && (
            <p className="text-sm text-red-400">
              {(mutation.error as Error).message}
            </p>
          )}
          <div className="flex flex-wrap justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() =>
                onPreview({
                  name: name.trim() || 'Borrador',
                  subject,
                  bodyHtml,
                })
              }
              className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm hover:bg-[var(--bg)]"
            >
              Preview
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm hover:bg-[var(--bg)]"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={mutation.isPending}
              className="rounded-lg bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-60"
            >
              {mutation.isPending ? 'Guardando…' : 'Guardar'}
            </button>
          </div>
        </form>
      </div>
    </div></ModalPortal>
  )
}

function BillingInvoicesPanel({ canWrite }: { canWrite: boolean }) {
  const currency = useCompanyCurrency()
  const { alert } = useNotify()
  const [createOpen, setCreateOpen] = useState(false)
  const query = useQuery({
    queryKey: ['app', 'settings', 'billing', 'invoices'],
    queryFn: () => apiFetch<Invoice[]>('/app/settings/billing/invoices'),
  })
  const rows = query.data ?? []

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-[var(--text-muted)]">
          Facturas emitidas automáticamente o a mano.
        </p>
        {canWrite && (
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="shrink-0 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)]"
          >
            Nueva factura
          </button>
        )}
      </div>

      <MobileList>
        {query.isLoading && <MobileListEmpty>Cargando…</MobileListEmpty>}
        {!query.isLoading && rows.length === 0 && (
          <MobileListEmpty>
            Aún no hay facturas. Se crean al alta (instalación) o por el cron de
            generación.
          </MobileListEmpty>
        )}
        {rows.map((inv) => (
          <MobileListCard key={inv.id}>
            <div className="flex items-start justify-between gap-2">
              <p className="truncate text-sm font-semibold">{inv.number}</p>
              <span className="shrink-0 text-sm font-medium">
                {formatMoney(inv.total, inv.currency || currency)}
              </span>
            </div>
            <MobileListMeta>
              <span>{inv.type}</span>
              <span>·</span>
              <span>{inv.status}</span>
              <span>·</span>
              <span>{inv.issueDate}</span>
              {inv.periodStart && inv.periodEnd ? (
                <>
                  <span>·</span>
                  <span>
                    {inv.periodStart} → {inv.periodEnd}
                  </span>
                </>
              ) : null}
            </MobileListMeta>
          </MobileListCard>
        ))}
      </MobileList>

      <DesktopTableWrap>
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="bg-[var(--bg)] text-[var(--text-muted)]">
            <tr>
              <th className="px-4 py-3 font-medium">Número</th>
              <th className="px-4 py-3 font-medium">Tipo</th>
              <th className="px-4 py-3 font-medium">Estado</th>
              <th className="px-4 py-3 font-medium">Período</th>
              <th className="px-4 py-3 font-medium">Total</th>
              <th className="px-4 py-3 font-medium">Emisión</th>
            </tr>
          </thead>
          <tbody>
            {query.isLoading && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-[var(--text-muted)]">
                  Cargando…
                </td>
              </tr>
            )}
            {!query.isLoading && rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-[var(--text-muted)]">
                  Aún no hay facturas. Se crean al alta (instalación) o por el cron
                  de generación.
                </td>
              </tr>
            )}
            {rows.map((inv) => (
              <tr key={inv.id} className="border-t border-[var(--border)]">
                <td className="px-4 py-3 font-medium">{inv.number}</td>
                <td className="px-4 py-3">{inv.type}</td>
                <td className="px-4 py-3">{inv.status}</td>
                <td className="px-4 py-3 text-xs text-[var(--text-muted)]">
                  {inv.periodStart && inv.periodEnd
                    ? `${inv.periodStart} → ${inv.periodEnd}`
                    : '—'}
                </td>
                <td className="px-4 py-3">
                  {formatMoney(inv.total, inv.currency || currency)}
                </td>
                <td className="px-4 py-3">{inv.issueDate}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </DesktopTableWrap>

      {createOpen && (
        <CreateInvoiceModal
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          onCreated={async (res) => {
            await alert(
              res.sentTo
                ? `Factura ${res.number} creada y enviada a ${res.sentTo}`
                : `Factura ${res.number} creada`,
              { title: 'Factura creada', variant: 'success' },
            )
          }}
        />
      )}
    </div>
  )
}
