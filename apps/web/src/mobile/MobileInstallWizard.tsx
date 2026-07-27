import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'
import type {
  AuthorizeOnuResponse,
  UncfgOnu,
  UncfgResponse,
} from '../lib/onu-connected'
import {
  oltOnuName,
  onuDescriptionForService,
} from '../lib/onu-connected'
import type { IpPoolsResponse } from '../lib/ip-pools'
import type { Tr069ProfilesResponse } from '../lib/tr069'
import type { Client, ClientService, ServicePlan } from '../lib/crm'
import { clientDisplayName } from '../lib/crm'
import { useMoney } from '../lib/currency'
import type { CompanyProfile } from '../lib/company'
import type { Zone } from '../components/ZonasSettingsTab'
import {
  OperationProgressModal,
  runProgressSteps,
  type ProgressStep,
} from '../components/OperationProgressModal'

const field =
  'w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 py-3 text-base outline-none ring-[var(--accent)] focus:ring-2'

const STEPS = [
  { n: 1, label: 'Cliente' },
  { n: 2, label: 'Servicio' },
  { n: 3, label: 'ONU' },
  { n: 4, label: 'Red' },
] as const

export function MobileInstallWizard() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const money = useMoney()
  const [step, setStep] = useState(1)
  const [error, setError] = useState<string | null>(null)

  // Cliente
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [street, setStreet] = useState('')
  const [city, setCity] = useState('')
  const [zoneId, setZoneId] = useState('')
  const [clientId, setClientId] = useState<string | null>(null)
  const [clientName, setClientName] = useState('')

  // Servicio
  const [serviceName, setServiceName] = useState('Casa')
  const [servicePlanId, setServicePlanId] = useState('')

  // ONU
  const [oltFilter, setOltFilter] = useState('')
  const [search, setSearch] = useState('')
  const [orphan, setOrphan] = useState<UncfgOnu | null>(null)
  const [onuNumber, setOnuNumber] = useState('')

  // Red
  const [mgmtVlanPick, setMgmtVlanPick] = useState('')
  const [wanVlanPick, setWanVlanPick] = useState('')
  const [tr069ProfilePick, setTr069ProfilePick] = useState('')

  // Progress
  const [progressOpen, setProgressOpen] = useState(false)
  const [progressSteps, setProgressSteps] = useState<ProgressStep[]>([])
  const [progressRunning, setProgressRunning] = useState(false)
  const [progressFailed, setProgressFailed] = useState(false)
  const [progressDone, setProgressDone] = useState(false)
  const runnersRef = useRef<Record<string, () => Promise<string | void>>>({})
  const ctxRef = useRef<{ onuDbId?: string; serviceId?: string; clientId?: string }>(
    {},
  )

  const companyQuery = useQuery({
    queryKey: ['app', 'settings', 'company'],
    queryFn: () => apiFetch<CompanyProfile>('/app/settings/company'),
    staleTime: 5 * 60_000,
  })
  const zonesQuery = useQuery({
    queryKey: ['app', 'zones'],
    queryFn: () => apiFetch<Zone[]>('/app/zones'),
    staleTime: 60_000,
  })
  const plansQuery = useQuery({
    queryKey: ['app', 'service-plans'],
    queryFn: () => apiFetch<ServicePlan[]>('/app/service-plans'),
    staleTime: 60_000,
  })
  const uncfgQuery = useQuery({
    queryKey: ['app', 'onus', 'uncfg', oltFilter, 'mobile'],
    queryFn: () =>
      apiFetch<UncfgResponse>('/app/onus/uncfg', {
        method: 'POST',
        body: JSON.stringify(oltFilter ? { oltId: oltFilter } : {}),
      }),
    enabled: step === 3,
    refetchInterval: step === 3 ? 15_000 : false,
  })
  const mgmtPoolsQuery = useQuery({
    queryKey: ['app', 'settings', 'ip-pools', 'management', orphan?.oltId],
    queryFn: () =>
      apiFetch<IpPoolsResponse>(
        `/app/settings/ip-pools?purpose=management${orphan?.oltId ? `&oltId=${orphan.oltId}` : ''}`,
      ),
    enabled: step === 4 && !!orphan,
  })
  const wanPoolsQuery = useQuery({
    queryKey: ['app', 'settings', 'ip-pools', 'internet', orphan?.oltId],
    queryFn: () =>
      apiFetch<IpPoolsResponse>(
        `/app/settings/ip-pools?purpose=internet${orphan?.oltId ? `&oltId=${orphan.oltId}` : ''}`,
      ),
    enabled: step === 4 && !!orphan,
  })
  const tr069ProfilesQuery = useQuery({
    queryKey: ['app', 'settings', 'tr069', 'profiles'],
    queryFn: () =>
      apiFetch<Tr069ProfilesResponse>('/app/settings/tr069/profiles'),
    enabled: step === 4,
    staleTime: 60_000,
  })

  const plans = (plansQuery.data ?? []).filter((p) => p.isActive)
  const mgmtPools = mgmtPoolsQuery.data?.pools ?? []
  const wanPools = wanPoolsQuery.data?.pools ?? []
  const tr069Profiles = useMemo(() => {
    const all = tr069ProfilesQuery.data?.profiles ?? []
    const oltId = orphan?.oltId
    if (!oltId) return all
    const attached = all.filter((p) => p.oltIds?.includes(oltId))
    return attached.length ? attached : all
  }, [tr069ProfilesQuery.data?.profiles, orphan?.oltId])

  useEffect(() => {
    if (step === 4 && !mgmtVlanPick && mgmtPools.length === 1) {
      setMgmtVlanPick(String(mgmtPools[0].vlanId))
    }
  }, [step, mgmtPools, mgmtVlanPick])

  useEffect(() => {
    if (step !== 4 || tr069ProfilePick) return
    if (tr069Profiles.length === 1) setTr069ProfilePick(tr069Profiles[0].id)
  }, [step, tr069Profiles, tr069ProfilePick])

  const orphans = useMemo(() => {
    const all = uncfgQuery.data?.onus ?? []
    const q = search.trim().toLowerCase()
    if (!q) return all
    return all.filter((o) =>
      [o.sn, o.oltIf, o.oltName, o.state ?? '', o.ponType]
        .join(' ')
        .toLowerCase()
        .includes(q),
    )
  }, [uncfgQuery.data?.onus, search])

  function pickOrphan(o: UncfgOnu) {
    setOrphan(o)
    setOnuNumber(o.suggestedOnuId != null ? String(o.suggestedOnuId) : '1')
  }

  function validate(current: number): string | null {
    if (current === 1) {
      if (firstName.trim().length < 2 && lastName.trim().length < 2)
        return 'Indica al menos nombre o apellido.'
      if (!phone.trim() && !email.trim())
        return 'Indica teléfono o correo de contacto.'
    }
    if (current === 2) {
      if (serviceName.trim().length < 2) return 'Nombre del servicio muy corto.'
      if (!servicePlanId) return 'Selecciona un plan.'
      if (!street.trim() && !city.trim())
        return 'Indica al menos calle o ciudad.'
    }
    if (current === 3) {
      if (!orphan) return 'Selecciona una ONU no configurada.'
      if (!/^\d+$/.test(onuNumber.trim())) return 'ONU ID debe ser numérico.'
    }
    if (current === 4) {
      if (mgmtPools.length > 0 && !mgmtVlanPick)
        return 'Selecciona VLAN de management.'
      if (mgmtVlanPick && tr069Profiles.length > 0 && !tr069ProfilePick)
        return 'Selecciona perfil TR069.'
    }
    return null
  }

  function next() {
    const err = validate(step)
    if (err) {
      setError(err)
      return
    }
    setError(null)
    setStep((s) => Math.min(4, s + 1))
  }

  function back() {
    setError(null)
    setStep((s) => Math.max(1, s - 1))
  }

  async function executeProgress(steps: ProgressStep[]) {
    setProgressRunning(true)
    setProgressFailed(false)
    setProgressDone(false)
    const result = await runProgressSteps(
      steps,
      setProgressSteps,
      runnersRef.current,
    )
    setProgressRunning(false)
    if (result.ok) {
      setProgressDone(true)
      void queryClient.invalidateQueries({ queryKey: ['app', 'clients'] })
      void queryClient.invalidateQueries({ queryKey: ['app', 'onus'] })
      void queryClient.invalidateQueries({ queryKey: ['app', 'dashboard'] })
    } else {
      setProgressFailed(true)
    }
  }

  function finish() {
    const err = validate(4)
    if (err) {
      setError(err)
      return
    }
    if (!orphan) return
    setError(null)

    const mgmtVlan = mgmtVlanPick ? Number(mgmtVlanPick) : null
    const wanVlan = wanVlanPick ? Number(wanVlanPick) : null
    const hasNetwork = mgmtVlan != null || wanVlan != null
    const vlanBody: {
      mgmtVlanId?: number
      wanVlanId?: number
      tr069ProfileId?: string
    } = {}
    if (mgmtVlan != null) vlanBody.mgmtVlanId = mgmtVlan
    if (wanVlan != null) vlanBody.wanVlanId = wanVlan
    if (mgmtVlan != null && tr069ProfilePick) {
      vlanBody.tr069ProfileId = tr069ProfilePick
    }

    ctxRef.current = { clientId: clientId ?? undefined }

    const steps: ProgressStep[] = [
      { id: 'client', label: 'Creando cliente', status: 'pending' },
      { id: 'authorize', label: 'Autorizando ONU en la OLT', status: 'pending' },
      { id: 'zone', label: 'Asignando zona', status: 'pending' },
      { id: 'service', label: 'Creando servicio', status: 'pending' },
      ...(hasNetwork
        ? ([
            {
              id: 'olt',
              label: 'Configurando VLANs en la OLT',
              status: 'pending',
            },
            {
              id: 'assign',
              label: 'Asignando IPs (mgmt / WAN)',
              status: 'pending',
            },
            {
              id: 'apply',
              label: 'Aplicando configuración a la ONU',
              status: 'pending',
            },
            {
              id: 'verify',
              label: 'Verificando ONU online y VLANs',
              status: 'pending',
            },
          ] satisfies ProgressStep[])
        : []),
    ]

    const requireOnuDbId = () => {
      const id = ctxRef.current.onuDbId
      if (!id) throw new Error('No se obtuvo el ID de la ONU autorizada')
      return id
    }
    const requireClientId = () => {
      const id = ctxRef.current.clientId
      if (!id) throw new Error('No se obtuvo el ID del cliente')
      return id
    }

    const displayName = [firstName, lastName].filter(Boolean).join(' ').trim()
    const svcName = serviceName.trim()

    const runners: Record<string, () => Promise<string | void>> = {
      client: async () => {
        if (ctxRef.current.clientId) {
          return 'Cliente ya creado'
        }
        const c = await apiFetch<Client>('/app/clients', {
          method: 'POST',
          body: JSON.stringify({
            firstName: firstName.trim(),
            lastName: lastName.trim(),
            email: email.trim().toLowerCase(),
            phone: phone.trim(),
            street: street.trim(),
            city: city.trim(),
            zoneId: zoneId.trim() || null,
            isLead: false,
            isActive: true,
          }),
        })
        ctxRef.current.clientId = c.id
        setClientId(c.id)
        setClientName(clientDisplayName(c) || displayName)
        return `Cliente «${clientDisplayName(c) || displayName}»`
      },
      authorize: async () => {
        const nameForOnu = clientName || displayName || 'Cliente'
        const r = await apiFetch<AuthorizeOnuResponse>('/app/onus/authorize', {
          method: 'POST',
          body: JSON.stringify({
            oltId: orphan.oltId,
            oltIf: orphan.oltIf,
            onuId: onuNumber.trim(),
            sn: orphan.sn,
            onuType: null,
            name: oltOnuName(nameForOnu, svcName),
            description: onuDescriptionForService({
              street: street.trim(),
              city: city.trim(),
            }),
          }),
        })
        ctxRef.current.onuDbId = r.onu?.id
        return r.message || 'ONU autorizada'
      },
      zone: async () => {
        const cid = requireClientId()
        const nextZoneId = zoneId.trim() ? zoneId.trim() : null
        await apiFetch(`/app/clients/${cid}`, {
          method: 'PATCH',
          body: JSON.stringify({ zoneId: nextZoneId }),
        })
        const onuId = requireOnuDbId()
        await apiFetch(`/app/onus/${onuId}/zone`, {
          method: 'PATCH',
          body: JSON.stringify({ zoneId: nextZoneId }),
        })
        return nextZoneId ? 'Zona asignada' : 'Sin zona'
      },
      service: async () => {
        const cid = requireClientId()
        const r = await apiFetch<ClientService>(`/app/clients/${cid}/services`, {
          method: 'POST',
          body: JSON.stringify({
            servicePlanId,
            name: svcName,
            status: 'active',
            street: street.trim(),
            city: city.trim(),
            onuId: ctxRef.current.onuDbId,
          }),
        })
        ctxRef.current.serviceId = r.id
        return `Servicio «${r.name}»`
      },
      olt: async () => {
        const r = await apiFetch<{ message?: string }>(
          `/app/onus/${requireOnuDbId()}/network-vlans/olt`,
          { method: 'POST', body: JSON.stringify(vlanBody) },
        )
        return r.message || 'OLT OK'
      },
      assign: async () => {
        const r = await apiFetch<{ message?: string }>(
          `/app/onus/${requireOnuDbId()}/network-vlans/assign`,
          { method: 'POST', body: JSON.stringify(vlanBody) },
        )
        return r.message || 'IPs asignadas'
      },
      apply: async () => {
        let lastErr: unknown = null
        for (let attempt = 1; attempt <= 2; attempt++) {
          try {
            const r = await apiFetch<{ message?: string }>(
              `/app/onus/${requireOnuDbId()}/network-vlans/apply`,
              { method: 'POST', body: JSON.stringify(vlanBody) },
            )
            return r.message || 'ONU OK'
          } catch (e) {
            lastErr = e
          }
        }
        throw new Error(
          lastErr instanceof Error ? lastErr.message : String(lastErr),
        )
      },
      verify: async () => {
        const r = await apiFetch<{
          ok: boolean
          message?: string
          mgmtVlanId?: number | null
          wanVlanId?: number | null
        }>(`/app/onus/${requireOnuDbId()}/network-vlans/verify`, {
          method: 'POST',
        })
        if (mgmtVlan != null && r.mgmtVlanId !== mgmtVlan) {
          throw new Error(
            `Mgmt en VLAN ${r.mgmtVlanId ?? '—'}, se esperaba ${mgmtVlan}`,
          )
        }
        if (wanVlan != null && r.wanVlanId !== wanVlan) {
          throw new Error(
            `WAN en VLAN ${r.wanVlanId ?? '—'}, se esperaba ${wanVlan}`,
          )
        }
        return r.message || 'Verificación OK'
      },
    }

    runnersRef.current = runners
    setProgressSteps(steps)
    setProgressOpen(true)
    void executeProgress(steps)
  }

  const selectedPlan = plans.find((p) => p.id === servicePlanId)

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
          <h1 className="text-xl font-semibold tracking-tight">Instalar</h1>
          <p className="text-xs text-[var(--text-muted)]">
            {companyQuery.data?.name || 'Alta en campo'}
          </p>
        </div>
      </div>

      <ol className="mb-5 flex gap-1">
        {STEPS.map((s) => (
          <li key={s.n} className="flex-1">
            <div
              className={[
                'h-1.5 rounded-full',
                step >= s.n ? 'bg-[var(--accent)]' : 'bg-[var(--border)]',
              ].join(' ')}
            />
            <p
              className={[
                'mt-1.5 text-center text-[10px] font-medium uppercase tracking-wide',
                step === s.n
                  ? 'text-[var(--accent)]'
                  : 'text-[var(--text-muted)]',
              ].join(' ')}
            >
              {s.label}
            </p>
          </li>
        ))}
      </ol>

      {error && (
        <p className="mb-3 rounded-xl border border-[var(--danger)]/40 bg-[var(--danger)]/10 px-3 py-2 text-sm text-[var(--danger)]">
          {error}
        </p>
      )}

      <div className="flex-1 space-y-4">
        {step === 1 && (
          <>
            <p className="text-sm text-[var(--text-muted)]">
              Datos del cliente nuevo
            </p>
            <label className="block text-sm">
              <span className="mb-1 block text-[var(--text-muted)]">Nombre</span>
              <input
                className={field}
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                autoComplete="given-name"
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-[var(--text-muted)]">
                Apellido
              </span>
              <input
                className={field}
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                autoComplete="family-name"
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-[var(--text-muted)]">
                Teléfono
              </span>
              <input
                className={field}
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                inputMode="tel"
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-[var(--text-muted)]">Correo</span>
              <input
                className={field}
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-[var(--text-muted)]">Zona</span>
              <select
                className={field}
                value={zoneId}
                onChange={(e) => setZoneId(e.target.value)}
              >
                <option value="">Sin zona</option>
                {(zonesQuery.data ?? []).map((z) => (
                  <option key={z.id} value={z.id}>
                    {z.name}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}

        {step === 2 && (
          <>
            <p className="text-sm text-[var(--text-muted)]">
              Servicio e instalación
            </p>
            <label className="block text-sm">
              <span className="mb-1 block text-[var(--text-muted)]">
                Nombre del servicio
              </span>
              <input
                className={field}
                value={serviceName}
                onChange={(e) => setServiceName(e.target.value)}
                placeholder="Casa, Local…"
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-[var(--text-muted)]">Plan</span>
              <select
                className={field}
                value={servicePlanId}
                onChange={(e) => setServicePlanId(e.target.value)}
              >
                <option value="">Seleccionar…</option>
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · {money(p.price)}
                  </option>
                ))}
              </select>
            </label>
            {selectedPlan && (
              <p className="text-xs text-[var(--text-muted)]">
                {selectedPlan.downloadSpeed}/{selectedPlan.uploadSpeed} Mbps
              </p>
            )}
            <label className="block text-sm">
              <span className="mb-1 block text-[var(--text-muted)]">Calle</span>
              <input
                className={field}
                value={street}
                onChange={(e) => setStreet(e.target.value)}
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-[var(--text-muted)]">Ciudad</span>
              <input
                className={field}
                value={city}
                onChange={(e) => setCity(e.target.value)}
              />
            </label>
          </>
        )}

        {step === 3 && (
          <>
            <div className="flex items-center gap-2">
              <select
                className={`${field} flex-1`}
                value={oltFilter}
                onChange={(e) => setOltFilter(e.target.value)}
              >
                <option value="">Todas las OLT</option>
                {(uncfgQuery.data?.olts ?? []).map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={uncfgQuery.isFetching}
                onClick={() => void uncfgQuery.refetch()}
                className="shrink-0 rounded-xl border border-[var(--border)] px-3 py-3 text-sm"
              >
                {uncfgQuery.isFetching ? '…' : '↻'}
              </button>
            </div>
            <input
              className={field}
              placeholder="Buscar SN / puerto…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {uncfgQuery.isLoading && (
              <p className="text-sm text-[var(--text-muted)]">
                Buscando ONUs…
              </p>
            )}
            {uncfgQuery.error && (
              <p className="text-sm text-[var(--danger)]">
                {uncfgQuery.error.message}
              </p>
            )}
            <ul className="max-h-[42vh] space-y-2 overflow-y-auto">
              {orphans.map((o) => {
                const selected =
                  orphan?.sn === o.sn && orphan?.oltIf === o.oltIf
                return (
                  <li key={`${o.oltId}-${o.oltIf}-${o.sn}`}>
                    <button
                      type="button"
                      onClick={() => pickOrphan(o)}
                      className={[
                        'w-full rounded-2xl border px-4 py-3 text-left transition',
                        selected
                          ? 'border-[var(--accent)] bg-[var(--accent)]/10'
                          : 'border-[var(--border)] bg-[var(--bg-elevated)]',
                      ].join(' ')}
                    >
                      <p className="font-mono text-sm font-semibold">{o.sn}</p>
                      <p className="text-xs text-[var(--text-muted)]">
                        {o.oltName} · {o.oltIf}
                        {o.state ? ` · ${o.state}` : ''}
                      </p>
                    </button>
                  </li>
                )
              })}
              {!uncfgQuery.isLoading && !orphans.length && (
                <li className="py-8 text-center text-sm text-[var(--text-muted)]">
                  No hay ONUs sin configurar
                </li>
              )}
            </ul>
            {orphan && (
              <label className="block text-sm">
                <span className="mb-1 block text-[var(--text-muted)]">
                  ONU ID en puerto
                </span>
                <input
                  className={field}
                  inputMode="numeric"
                  value={onuNumber}
                  onChange={(e) => setOnuNumber(e.target.value)}
                />
              </label>
            )}
          </>
        )}

        {step === 4 && (
          <>
            <p className="text-sm text-[var(--text-muted)]">
              Red de la ONU (opcional si no hay pools)
            </p>
            <label className="block text-sm">
              <span className="mb-1 block text-[var(--text-muted)]">
                VLAN Management
              </span>
              <select
                className={field}
                value={mgmtVlanPick}
                onChange={(e) => setMgmtVlanPick(e.target.value)}
              >
                <option value="">Ninguna</option>
                {mgmtPools.map((p) => (
                  <option key={p.id} value={p.vlanId}>
                    VLAN {p.vlanId}
                    {p.name ? ` · ${p.name}` : ''} ({p.available} libres)
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-[var(--text-muted)]">
                VLAN WAN / Internet
              </span>
              <select
                className={field}
                value={wanVlanPick}
                onChange={(e) => setWanVlanPick(e.target.value)}
              >
                <option value="">Ninguna</option>
                {wanPools.map((p) => (
                  <option key={p.id} value={p.vlanId}>
                    VLAN {p.vlanId}
                    {p.name ? ` · ${p.name}` : ''} ({p.available} libres)
                  </option>
                ))}
              </select>
            </label>
            {mgmtVlanPick && (
              <label className="block text-sm">
                <span className="mb-1 block text-[var(--text-muted)]">
                  Perfil TR069
                </span>
                <select
                  className={field}
                  value={tr069ProfilePick}
                  onChange={(e) => setTr069ProfilePick(e.target.value)}
                >
                  <option value="">Seleccionar…</option>
                  {tr069Profiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-elevated)] p-4 text-sm">
              <p className="font-medium">Resumen</p>
              <ul className="mt-2 space-y-1 text-[var(--text-muted)]">
                <li>
                  Cliente: {[firstName, lastName].filter(Boolean).join(' ')}
                </li>
                <li>
                  Servicio: {serviceName}
                  {selectedPlan ? ` · ${selectedPlan.name}` : ''}
                </li>
                <li>ONU: {orphan?.sn || '—'}</li>
                <li>
                  Red:{' '}
                  {[
                    mgmtVlanPick ? `mgmt ${mgmtVlanPick}` : null,
                    wanVlanPick ? `wan ${wanVlanPick}` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ') || 'sin VLANs'}
                </li>
              </ul>
            </div>
          </>
        )}
      </div>

      <div className="sticky bottom-0 -mx-4 mt-6 border-t border-[var(--border)] bg-[var(--bg)]/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-lg gap-2">
          {step > 1 ? (
            <button
              type="button"
              onClick={back}
              className="flex-1 rounded-xl border border-[var(--border)] py-3.5 text-sm font-semibold"
            >
              Atrás
            </button>
          ) : (
            <Link
              to="/movil"
              className="flex flex-1 items-center justify-center rounded-xl border border-[var(--border)] py-3.5 text-sm font-semibold"
            >
              Cancelar
            </Link>
          )}
          {step < 4 ? (
            <button
              type="button"
              onClick={next}
              className="flex-[1.4] rounded-xl bg-[var(--accent)] py-3.5 text-sm font-semibold text-white"
            >
              Siguiente
            </button>
          ) : (
            <button
              type="button"
              onClick={finish}
              className="flex-[1.4] rounded-xl bg-[var(--accent)] py-3.5 text-sm font-semibold text-white"
            >
              Instalar
            </button>
          )}
        </div>
      </div>

      <OperationProgressModal
        open={progressOpen}
        title="Instalación en curso"
        steps={progressSteps}
        running={progressRunning}
        failed={progressFailed}
        allDone={progressDone}
        onRetry={() => void executeProgress(progressSteps)}
        onClose={() => {
          setProgressOpen(false)
          if (progressDone) {
            const cid = ctxRef.current.clientId
            navigate(cid ? `/app/clients/${cid}` : '/movil', { replace: true })
          }
        }}
      />
    </div>
  )
}
