import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { apiFetch } from '../lib/api'
import {
  COMPANY_COUNTRIES,
  COMPANY_CURRENCIES,
  type CompanyProfile,
  type ConfigureMikrotikResult,
} from '../lib/company'
import { companyDocumentType, formatDocument } from '../lib/documents'
import type { TopologyDevice } from '../lib/topology'
import { SettingsSubTabs } from './SettingsSubTabs'
import { IntegracionesSettingsPanel } from './IntegracionesSettingsPanel'
import { SuscripcionSettingsPanel } from './SuscripcionSettingsPanel'

const inputClass =
  'w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 outline-none ring-[var(--accent)] focus:ring-2'

const MAX_LOGO_BYTES = 1_000_000

const EMPRESA_TABS = [
  { id: 'datos', label: 'Datos' },
  { id: 'suscripcion', label: 'Suscripción' },
  { id: 'integraciones', label: 'Integraciones' },
] as const

type EmpresaSection = (typeof EMPRESA_TABS)[number]['id']

type FormState = {
  name: string
  legalName: string
  phone: string
  email: string
  address: string
  city: string
  country: string
  taxId: string
  legalRepresentative: string
  currency: string
  logoUrl: string
  invoiceFooter: string
  invoiceDocLabel: string
  suspensionPortalEnabled: boolean
}

const empty: FormState = {
  name: '',
  legalName: '',
  phone: '',
  email: '',
  address: '',
  city: '',
  country: '',
  taxId: '',
  legalRepresentative: '',
  currency: 'USD',
  logoUrl: '',
  invoiceFooter: '',
  invoiceDocLabel: 'Factura',
  suspensionPortalEnabled: false,
}

export function EmpresaSettingsTab({ canWrite }: { canWrite: boolean }) {
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const sectionParam = searchParams.get('section')
  const initialSection: EmpresaSection =
    sectionParam === 'suscripcion' || sectionParam === 'integraciones'
      ? sectionParam
      : 'datos'
  const [section, setSectionState] = useState<EmpresaSection>(initialSection)

  useEffect(() => {
    if (
      sectionParam === 'suscripcion' ||
      sectionParam === 'integraciones' ||
      sectionParam === 'datos'
    ) {
      setSectionState(sectionParam)
    } else if (!sectionParam) {
      setSectionState('datos')
    }
  }, [sectionParam])

  function setSection(next: EmpresaSection) {
    setSectionState(next)
    const params = new URLSearchParams(searchParams)
    if (next === 'datos') params.delete('section')
    else params.set('section', next)
    setSearchParams(params, { replace: true })
  }
  const [form, setForm] = useState<FormState>(empty)
  const [msg, setMsg] = useState<string | null>(null)
  const [logoError, setLogoError] = useState<string | null>(null)
  const [configureMsg, setConfigureMsg] = useState<string | null>(null)
  const [configureResults, setConfigureResults] = useState<
    ConfigureMikrotikResult['results'] | null
  >(null)
  const [allowDomains, setAllowDomains] = useState<string[]>([])
  const [selectedRouterIds, setSelectedRouterIds] = useState<string[]>([])
  const fileRef = useRef<HTMLInputElement>(null)

  const query = useQuery({
    queryKey: ['app', 'settings', 'company'],
    queryFn: () => apiFetch<CompanyProfile>('/app/settings/company'),
  })

  const topologyQuery = useQuery({
    queryKey: ['app', 'topology'],
    queryFn: () =>
      apiFetch<{ devices: TopologyDevice[] }>('/app/topology'),
  })

  const mikrotikRouters = useMemo(
    () =>
      (topologyQuery.data?.devices ?? []).filter(
        (d) =>
          d.type === 'router' &&
          d.subtype === 'mikrotik' &&
          d.isActive &&
          !!d.mgmtHost,
      ),
    [topologyQuery.data?.devices],
  )

  useEffect(() => {
    if (!query.data) return
    setForm({
      name: query.data.name ?? '',
      legalName: query.data.legalName ?? '',
      phone: query.data.phone ?? '',
      email: query.data.email ?? '',
      address: query.data.address ?? '',
      city: query.data.city ?? '',
      country: query.data.country ?? '',
      taxId: query.data.taxId ?? '',
      legalRepresentative: query.data.legalRepresentative ?? '',
      currency: query.data.currency || 'USD',
      logoUrl: query.data.logoUrl ?? '',
      invoiceFooter: query.data.invoiceFooter ?? '',
      invoiceDocLabel: query.data.invoiceDocLabel || 'Factura',
      suspensionPortalEnabled: !!query.data.suspensionPortalEnabled,
    })
  }, [query.data])

  useEffect(() => {
    if (topologyQuery.isLoading) return
    const valid = new Set(mikrotikRouters.map((r) => r.id))
    const saved = (query.data?.suspensionPortalRouterIds ?? []).filter((id) =>
      valid.has(id),
    )
    if (saved.length > 0) {
      setSelectedRouterIds(saved)
      return
    }
    if (mikrotikRouters.length === 1) {
      setSelectedRouterIds([mikrotikRouters[0].id])
      return
    }
    setSelectedRouterIds([])
  }, [
    query.data?.suspensionPortalRouterIds,
    mikrotikRouters,
    topologyQuery.isLoading,
  ])

  const mutation = useMutation({
    mutationFn: (payload: FormState) =>
      apiFetch<CompanyProfile>('/app/settings/company', {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }),
    onSuccess: (data) => {
      void queryClient.setQueryData(['app', 'settings', 'company'], data)
      setMsg('Datos de la empresa guardados')
    },
  })

  const configureMutation = useMutation({
    mutationFn: (routerIds: string[]) =>
      apiFetch<ConfigureMikrotikResult>(
        '/app/settings/company/suspension-portal/configure-mikrotik',
        {
          method: 'POST',
          body: JSON.stringify({ routerIds }),
        },
      ),
    onSuccess: (data) => {
      setConfigureResults(data.results)
      setAllowDomains(data.allowDomains ?? [])
      void queryClient.invalidateQueries({
        queryKey: ['app', 'settings', 'company'],
      })
      const ok = data.results.filter((r) => r.ok).length
      const fail = data.results.length - ok
      setConfigureMsg(
        fail === 0
          ? `MikroTik configurado (${ok} router${ok === 1 ? '' : 's'}). Portal: ${data.portalUrl}`
          : `Configuración parcial: ${ok} ok, ${fail} con error. Portal: ${data.portalUrl}`,
      )
    },
    onError: () => {
      setConfigureResults(null)
    },
  })

  function toggleRouter(id: string) {
    setSelectedRouterIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    )
  }

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  const companyDoc = companyDocumentType(form.country)

  function onLogoFile(file: File | undefined) {
    setLogoError(null)
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setLogoError('El archivo debe ser una imagen')
      return
    }
    if (file.size > MAX_LOGO_BYTES) {
      setLogoError('La imagen supera 1 MB, usa una más liviana')
      return
    }
    const reader = new FileReader()
    reader.onload = () => set('logoUrl', String(reader.result))
    reader.onerror = () => setLogoError('No se pudo leer la imagen')
    reader.readAsDataURL(file)
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    setMsg(null)
    mutation.mutate(form)
  }

  return (
    <div>
      <div className="mb-5">
        <SettingsSubTabs
          tabs={EMPRESA_TABS}
          value={section}
          onChange={setSection}
          aria-label="Secciones de empresa"
        />
      </div>

      {section === 'integraciones' && (
        <IntegracionesSettingsPanel canWrite={canWrite} />
      )}

      {section === 'suscripcion' && (
        <SuscripcionSettingsPanel canWrite={canWrite} />
      )}

      {section === 'datos' && (
        <div>
          <p className="mb-5 text-sm text-[var(--text-muted)]">
            Datos comerciales y legales de la empresa. La moneda se usará en
            precios y facturación.
          </p>

          {query.isLoading && (
            <p className="text-sm text-[var(--text-muted)]">Cargando…</p>
          )}
          {query.error && (
            <p className="mb-4 text-sm text-[var(--danger)]">
              {query.error.message}
            </p>
          )}

          {query.data && (
            <form onSubmit={onSubmit} className="space-y-4">
              <div className="grid gap-4 lg:grid-cols-2">
                <section className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--bg)] p-5">
                  <h3 className="text-sm font-semibold">Datos comerciales</h3>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="block text-sm sm:col-span-2">
                      <span className="mb-1 block text-[var(--text-muted)]">
                        Nombre comercial
                      </span>
                      <input
                        required
                        disabled={!canWrite}
                        className={inputClass}
                        value={form.name}
                        onChange={(e) => set('name', e.target.value)}
                      />
                    </label>
                    <label className="block text-sm">
                      <span className="mb-1 block text-[var(--text-muted)]">
                        Teléfono
                      </span>
                      <input
                        disabled={!canWrite}
                        className={inputClass}
                        value={form.phone}
                        onChange={(e) => set('phone', e.target.value)}
                      />
                    </label>
                    <label className="block text-sm">
                      <span className="mb-1 block text-[var(--text-muted)]">
                        Email
                      </span>
                      <input
                        type="email"
                        disabled={!canWrite}
                        className={inputClass}
                        value={form.email}
                        onChange={(e) => set('email', e.target.value)}
                      />
                    </label>
                    <label className="block text-sm sm:col-span-2">
                      <span className="mb-1 block text-[var(--text-muted)]">
                        Dirección
                      </span>
                      <input
                        disabled={!canWrite}
                        className={inputClass}
                        value={form.address}
                        onChange={(e) => set('address', e.target.value)}
                      />
                    </label>
                    <label className="block text-sm">
                      <span className="mb-1 block text-[var(--text-muted)]">
                        Ciudad
                      </span>
                      <input
                        disabled={!canWrite}
                        className={inputClass}
                        value={form.city}
                        onChange={(e) => set('city', e.target.value)}
                      />
                    </label>
                    <label className="block text-sm">
                      <span className="mb-1 block text-[var(--text-muted)]">
                        País
                      </span>
                      <select
                        disabled={!canWrite}
                        className={inputClass}
                        value={form.country}
                        onChange={(e) => set('country', e.target.value)}
                      >
                        <option value="">Seleccionar país…</option>
                        {COMPANY_COUNTRIES.map((c) => (
                          <option key={c.code} value={c.code}>
                            {c.label}
                          </option>
                        ))}
                        {form.country &&
                          !COMPANY_COUNTRIES.some(
                            (c) => c.code === form.country,
                          ) && (
                            <option value={form.country}>{form.country}</option>
                          )}
                      </select>
                    </label>
                  </div>
                </section>

                <section className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--bg)] p-5">
                  <h3 className="text-sm font-semibold">Datos legales</h3>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="block text-sm sm:col-span-2">
                      <span className="mb-1 block text-[var(--text-muted)]">
                        Razón social
                      </span>
                      <input
                        disabled={!canWrite}
                        className={inputClass}
                        value={form.legalName}
                        onChange={(e) => set('legalName', e.target.value)}
                      />
                    </label>
                    <label className="block text-sm">
                      <span className="mb-1 block text-[var(--text-muted)]">
                        {companyDoc.label}
                      </span>
                      <input
                        disabled={!canWrite}
                        className={inputClass}
                        value={form.taxId}
                        onChange={(e) => set('taxId', e.target.value)}
                        onBlur={(e) =>
                          set(
                            'taxId',
                            formatDocument(
                              form.country,
                              companyDoc.id,
                              e.target.value,
                            ),
                          )
                        }
                        placeholder={`ej. ${companyDoc.placeholder}`}
                      />
                    </label>
                    <label className="block text-sm">
                      <span className="mb-1 block text-[var(--text-muted)]">
                        Representante legal
                      </span>
                      <input
                        disabled={!canWrite}
                        className={inputClass}
                        value={form.legalRepresentative}
                        onChange={(e) =>
                          set('legalRepresentative', e.target.value)
                        }
                      />
                    </label>
                    <label className="block text-sm sm:col-span-2">
                      <span className="mb-1 block text-[var(--text-muted)]">
                        Moneda de la empresa
                      </span>
                      <select
                        disabled={!canWrite}
                        className={inputClass}
                        value={form.currency}
                        onChange={(e) => set('currency', e.target.value)}
                      >
                        {COMPANY_CURRENCIES.map((c) => (
                          <option key={c.code} value={c.code}>
                            {c.label}
                          </option>
                        ))}
                      </select>
                      <span className="mt-1 block text-[11px] text-[var(--text-muted)]">
                        Latinoamérica, dólar (USD) y euro (EUR).
                      </span>
                    </label>
                  </div>
                </section>
              </div>

              <section className="space-y-4 rounded-xl border border-[var(--border)] bg-[var(--bg)] p-5">
                <h3 className="text-sm font-semibold">Marca y factura</h3>
                <div className="grid gap-5 lg:grid-cols-[auto_1fr_minmax(12rem,16rem)] lg:items-start">
                  <div className="space-y-2">
                    <span className="block text-sm text-[var(--text-muted)]">
                      Logo (para la factura)
                    </span>
                    <div className="flex h-24 w-40 items-center justify-center overflow-hidden rounded-lg border border-dashed border-[var(--border)] bg-white">
                      {form.logoUrl ? (
                        <img
                          src={form.logoUrl}
                          alt="Logo"
                          className="max-h-full max-w-full object-contain"
                        />
                      ) : (
                        <span className="px-2 text-center text-xs text-zinc-400">
                          Sin logo
                        </span>
                      )}
                    </div>
                    {canWrite && (
                      <div className="flex flex-wrap gap-2">
                        <input
                          ref={fileRef}
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => onLogoFile(e.target.files?.[0])}
                        />
                        <button
                          type="button"
                          onClick={() => fileRef.current?.click()}
                          className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs hover:bg-[var(--bg-elevated)]"
                        >
                          Subir logo
                        </button>
                        {form.logoUrl && (
                          <button
                            type="button"
                            onClick={() => set('logoUrl', '')}
                            className="rounded-lg border border-red-500/40 px-3 py-1.5 text-xs text-red-300 hover:bg-red-500/10"
                          >
                            Quitar
                          </button>
                        )}
                      </div>
                    )}
                    {logoError && (
                      <p className="text-xs text-[var(--danger)]">{logoError}</p>
                    )}
                    <p className="text-[11px] text-[var(--text-muted)]">
                      PNG, JPG, SVG o WebP · máx. 1 MB.
                    </p>
                  </div>

                  <label className="block text-sm">
                    <span className="mb-1 block text-[var(--text-muted)]">
                      Pie de página / descargos legales
                    </span>
                    <textarea
                      disabled={!canWrite}
                      rows={6}
                      className={`${inputClass} min-h-[8rem] resize-y font-mono text-xs leading-relaxed`}
                      value={form.invoiceFooter}
                      onChange={(e) => set('invoiceFooter', e.target.value)}
                      placeholder="Ej.: Documento no válido como boleta fiscal. Pagos a la cuenta… Gracias por su preferencia."
                    />
                    <span className="mt-1 block text-[11px] text-[var(--text-muted)]">
                      Aparece en el pie de todas las facturas. Se permite texto y
                      saltos de línea.
                    </span>
                  </label>

                  <label className="block text-sm">
                    <span className="mb-1 block text-[var(--text-muted)]">
                      Tipo de documento
                    </span>
                    <select
                      disabled={!canWrite}
                      className={inputClass}
                      value={form.invoiceDocLabel}
                      onChange={(e) => set('invoiceDocLabel', e.target.value)}
                    >
                      <option value="Factura">Factura</option>
                      <option value="Boleta">Boleta</option>
                    </select>
                    <span className="mt-1 block text-[11px] text-[var(--text-muted)]">
                      Título en plantillas: «Factura» o «Boleta».
                    </span>
                  </label>
                </div>
              </section>

              <section className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--bg)] p-5">
                <h3 className="text-sm font-semibold">Suspensión de servicio</h3>
                <label className="flex items-start gap-3 text-sm">
                  <input
                    type="checkbox"
                    disabled={!canWrite}
                    className="mt-1"
                    checked={form.suspensionPortalEnabled}
                    onChange={(e) =>
                      set('suspensionPortalEnabled', e.target.checked)
                    }
                  />
                  <span>
                    <span className="font-medium">Portal de suspensión</span>
                    <span className="mt-1 block text-[11px] text-[var(--text-muted)]">
                      Si está activo, al suspender se bloquea internet completo
                      (HTTPS, VPN, apps) vía MikroTik y solo se deja el portal +
                      dominios de pago. Si no, se hace Disable de la ONU en la
                      OLT.
                    </span>
                  </span>
                </label>
                {form.suspensionPortalEnabled && (
                  <div className="space-y-2 border-t border-[var(--border)] pt-3">
                    {query.data?.suspensionPortalUrl && (
                      <p className="break-all font-mono text-[11px] text-[var(--text-muted)]">
                        Portal: {query.data.suspensionPortalUrl}
                        {query.data.suspensionPortalMode === 'external'
                          ? ' (externo)'
                          : ' (interno)'}
                      </p>
                    )}
                    {query.data?.suspensionPortalNeedsMikrotikReconfigure && (
                      <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-100">
                        El destino del portal cambió. Vuelve a{' '}
                        <strong>Configurar MikroTik</strong> en todos los
                        routers para aplicar el nuevo enlace (NAT / allow).
                      </div>
                    )}
                    {topologyQuery.isLoading && (
                      <p className="text-[11px] text-[var(--text-muted)]">
                        Cargando routers…
                      </p>
                    )}
                    {!topologyQuery.isLoading &&
                      mikrotikRouters.length === 0 && (
                        <p className="text-sm text-[var(--danger)]">
                          No hay MikroTik activos con host de gestión en
                          topología.
                        </p>
                      )}
                    {!topologyQuery.isLoading &&
                      mikrotikRouters.length === 1 && (
                        <p className="text-sm text-[var(--text-muted)]">
                          Se configurará:{' '}
                          <span className="font-medium text-[var(--text)]">
                            {mikrotikRouters[0].name}
                          </span>
                          {mikrotikRouters[0].mgmtHost
                            ? ` (${mikrotikRouters[0].mgmtHost})`
                            : ''}
                        </p>
                      )}
                    {!topologyQuery.isLoading &&
                      mikrotikRouters.length > 1 && (
                        <div className="space-y-2">
                          <p className="text-sm font-medium">
                            Routers MikroTik
                          </p>
                          <p className="text-[11px] text-[var(--text-muted)]">
                            Elige uno o varios (según las puertas de enlace
                            donde salen las ONUs).
                          </p>
                          <ul className="space-y-1.5">
                            {mikrotikRouters.map((r) => (
                              <li key={r.id}>
                                <label className="flex cursor-pointer items-start gap-2 text-sm">
                                  <input
                                    type="checkbox"
                                    disabled={!canWrite}
                                    className="mt-1"
                                    checked={selectedRouterIds.includes(r.id)}
                                    onChange={() => toggleRouter(r.id)}
                                  />
                                  <span>
                                    <span className="font-medium">{r.name}</span>
                                    {r.mgmtHost ? (
                                      <span className="ml-1 font-mono text-[11px] text-[var(--text-muted)]">
                                        {r.mgmtHost}
                                      </span>
                                    ) : null}
                                  </span>
                                </label>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    {canWrite && (
                      <button
                        type="button"
                        disabled={
                          configureMutation.isPending ||
                          selectedRouterIds.length === 0
                        }
                        onClick={() => {
                          setConfigureMsg(null)
                          configureMutation.mutate(selectedRouterIds)
                        }}
                        className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm hover:bg-[var(--bg-elevated)] disabled:opacity-60"
                      >
                        {configureMutation.isPending
                          ? 'Configurando…'
                          : 'Configurar MikroTik'}
                      </button>
                    )}
                    <p className="text-[11px] text-[var(--text-muted)]">
                      Reglas: NAT HTTP → portal; allow DNS; allow portal;
                      allow pagos (Mercado Pago); drop de todo lo demás
                      (HTTPS, VPN, etc.) para{' '}
                      <code>isp-control-suspended</code>. Guarda primero si
                      acabas de activar el checkbox.
                    </p>
                    {configureMsg && (
                      <p className="text-sm text-emerald-400">{configureMsg}</p>
                    )}
                    {configureMutation.error && (
                      <p className="text-sm text-[var(--danger)]">
                        {configureMutation.error.message}
                      </p>
                    )}
                    {configureResults && configureResults.length > 0 && (
                      <ul className="space-y-1 text-xs">
                        {configureResults.map((r) => (
                          <li
                            key={r.routerId}
                            className={
                              r.ok
                                ? 'text-emerald-400'
                                : 'text-[var(--danger)]'
                            }
                          >
                            {r.routerName}: {r.ok ? 'ok' : 'error'} — {r.message}
                          </li>
                        ))}
                      </ul>
                    )}
                    {allowDomains.length > 0 && (
                      <p className="text-[11px] text-[var(--text-muted)]">
                        Dominios de pago permitidos:{' '}
                        {allowDomains.slice(0, 6).join(', ')}
                        {allowDomains.length > 6
                          ? ` (+${allowDomains.length - 6} más)`
                          : ''}
                      </p>
                    )}
                  </div>
                )}
              </section>

              {msg && <p className="text-sm text-emerald-400">{msg}</p>}
              {mutation.error && (
                <p className="text-sm text-[var(--danger)]">
                  {mutation.error.message}
                </p>
              )}

              {canWrite && (
                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={mutation.isPending}
                    className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-60"
                  >
                    {mutation.isPending ? 'Guardando…' : 'Guardar'}
                  </button>
                </div>
              )}
            </form>
          )}
        </div>
      )}
    </div>
  )
}
