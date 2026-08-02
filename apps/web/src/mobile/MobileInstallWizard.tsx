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
import type {
  Client,
  ClientDetail,
  ClientService,
  ServicePlan,
} from '../lib/crm'
import { clientDisplayName } from '../lib/crm'
import { useMoney } from '../lib/currency'
import type { CompanyProfile } from '../lib/company'
import {
  companyDocumentType,
  formatDocument,
  personalDocumentTypes,
} from '../lib/documents'
import type { Zone } from '../components/ZonasSettingsTab'
import {
  OperationProgressModal,
  runProgressSteps,
  type ProgressStep,
} from '../components/OperationProgressModal'

const field =
  'w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 py-3 text-base outline-none ring-[var(--accent)] focus:ring-2'

type ClientMode = 'new' | 'existing'

const STEPS = [
  { n: 0, label: 'Inicio' },
  { n: 1, label: 'Cliente' },
  { n: 2, label: 'Servicio' },
  { n: 3, label: 'ONU' },
  { n: 4, label: 'Red' },
] as const

export function MobileInstallWizard() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const money = useMoney()
  const [step, setStep] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [clientMode, setClientMode] = useState<ClientMode | null>(null)
  const [clientSearch, setClientSearch] = useState('')

  // Cliente
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [documentType, setDocumentType] = useState('')
  const [documentNumber, setDocumentNumber] = useState('')
  const [isCompany, setIsCompany] = useState(false)
  const [companyName, setCompanyName] = useState('')
  const [companyTaxId, setCompanyTaxId] = useState('')
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
  const clientsQuery = useQuery({
    queryKey: ['app', 'clients'],
    queryFn: () => apiFetch<Client[]>('/app/clients'),
    enabled: step === 1 && clientMode === 'existing',
    staleTime: 30_000,
  })
  const clientDetailQuery = useQuery({
    queryKey: ['app', 'clients', clientId],
    queryFn: () => apiFetch<ClientDetail>(`/app/clients/${clientId}`),
    enabled: !!clientId && clientMode === 'existing' && step >= 1,
    staleTime: 30_000,
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

  const country = companyQuery.data?.country ?? ''
  const docTypes = personalDocumentTypes(country)
  const companyDoc = companyDocumentType(country)
  const selectedDocType =
    docTypes.find((t) => t.id === documentType) ?? docTypes[0]

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

  const filteredClients = useMemo(() => {
    const all = (clientsQuery.data ?? []).filter((c) => c.isActive)
    const q = clientSearch.trim().toLowerCase()
    if (!q) return all
    return all.filter((c) =>
      [
        clientDisplayName(c),
        c.email,
        c.phone,
        c.city,
        c.companyName,
        c.documentNumber,
        c.companyTaxId,
      ]
        .join(' ')
        .toLowerCase()
        .includes(q),
    )
  }, [clientsQuery.data, clientSearch])

  const existingServices = (clientDetailQuery.data?.services ?? []).filter(
    (s) => s.status === 'active',
  )

  function pickOrphan(o: UncfgOnu) {
    setOrphan(o)
    // Sin sugerencia se deja vacío: el índice 1 está ocupado en cualquier
    // puerto con clientes y la OLT lo trata como «re-create», dejando el SN
    // sin registrar.
    setOnuNumber(o.suggestedOnuId != null ? String(o.suggestedOnuId) : '')
  }

  function chooseMode(mode: ClientMode) {
    setError(null)
    setClientMode(mode)
    setClientId(null)
    setClientName('')
    setClientSearch('')
    if (mode === 'existing') {
      setFirstName('')
      setLastName('')
      setDocumentNumber('')
      setIsCompany(false)
      setCompanyName('')
      setCompanyTaxId('')
      setPhone('')
      setEmail('')
      setStreet('')
      setCity('')
      setZoneId('')
      setServiceName('Casa')
    }
    setStep(1)
  }

  function pickExistingClient(c: Client) {
    setClientId(c.id)
    setClientName(clientDisplayName(c))
    setZoneId(c.zoneId ?? '')
    setStreet(c.street ?? '')
    setCity(c.city ?? '')
    setPhone(c.phone ?? '')
    setEmail(c.email ?? '')
    setError(null)
  }

  function validate(current: number): string | null {
    if (current === 1) {
      if (clientMode === 'existing') {
        if (!clientId) return 'Selecciona un cliente existente.'
        return null
      }
      if (firstName.trim().length < 2 && lastName.trim().length < 2)
        return 'Indica al menos nombre o apellido.'
      if (isCompany && companyName.trim().length < 2)
        return 'Indica el nombre de la empresa.'
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
    if (
      step === 1 &&
      clientMode === 'existing' &&
      existingServices.length > 0 &&
      serviceName === 'Casa'
    ) {
      setServiceName(`Servicio ${existingServices.length + 1}`)
    }
    setStep((s) => Math.min(4, s + 1))
  }

  function back() {
    setError(null)
    if (step <= 1) {
      setClientMode(null)
      setClientId(null)
      setClientName('')
      setClientSearch('')
      setStep(0)
      return
    }
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
      if (ctxRef.current.clientId) {
        void queryClient.invalidateQueries({
          queryKey: ['app', 'clients', ctxRef.current.clientId],
        })
      }
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

    const isExisting = clientMode === 'existing' || !!clientId
    const steps: ProgressStep[] = [
      {
        id: 'client',
        label: isExisting ? 'Usando cliente existente' : 'Creando cliente',
        status: 'pending',
      },
      { id: 'authorize', label: 'Autorizando ONU en la OLT', status: 'pending' },
      { id: 'zone', label: 'Asignando zona', status: 'pending' },
      {
        id: 'service',
        label: isExisting ? 'Agregando servicio' : 'Creando servicio',
        status: 'pending',
      },
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

    const displayName =
      clientName ||
      (isCompany && companyName.trim()
        ? companyName.trim()
        : [firstName, lastName].filter(Boolean).join(' ').trim())
    const svcName = serviceName.trim()

    const runners: Record<string, () => Promise<string | void>> = {
      client: async () => {
        if (ctxRef.current.clientId) {
          return `Cliente «${clientName || displayName || 'existente'}»`
        }
        const c = await apiFetch<Client>('/app/clients', {
          method: 'POST',
          body: JSON.stringify({
            firstName: firstName.trim(),
            lastName: lastName.trim(),
            documentType: documentNumber.trim()
              ? (selectedDocType?.id ?? documentType)
              : '',
            documentNumber: documentNumber.trim(),
            isCompany,
            companyName: isCompany ? companyName.trim() : '',
            companyTaxId: isCompany ? companyTaxId.trim() : '',
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
        // En cliente existente no pisamos zona vacía si ya tenía una.
        if (clientMode !== 'existing' || nextZoneId) {
          await apiFetch(`/app/clients/${cid}`, {
            method: 'PATCH',
            body: JSON.stringify({ zoneId: nextZoneId }),
          })
        }
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
        {step === 0 && (
          <>
            <p className="text-sm text-[var(--text-muted)]">
              ¿Para quién es la instalación?
            </p>
            <button
              type="button"
              onClick={() => chooseMode('new')}
              className="w-full rounded-2xl border border-[var(--border)] bg-[var(--bg-elevated)] px-4 py-5 text-left transition hover:border-[var(--accent)]"
            >
              <p className="text-base font-semibold">Cliente nuevo</p>
              <p className="mt-1 text-sm text-[var(--text-muted)]">
                Alta completa: datos, servicio, ONU y red.
              </p>
            </button>
            <button
              type="button"
              onClick={() => chooseMode('existing')}
              className="w-full rounded-2xl border border-[var(--border)] bg-[var(--bg-elevated)] px-4 py-5 text-left transition hover:border-[var(--accent)]"
            >
              <p className="text-base font-semibold">Cliente existente</p>
              <p className="mt-1 text-sm text-[var(--text-muted)]">
                Buscar cliente y agregar otro servicio o aprovisionar ONU.
              </p>
            </button>
          </>
        )}

        {step === 1 && clientMode === 'existing' && (
          <>
            <p className="text-sm text-[var(--text-muted)]">
              Busca y selecciona el cliente
            </p>
            <input
              className={field}
              placeholder="Nombre, teléfono, documento…"
              value={clientSearch}
              onChange={(e) => setClientSearch(e.target.value)}
              autoFocus
            />
            {clientsQuery.isLoading && (
              <p className="text-sm text-[var(--text-muted)]">Cargando…</p>
            )}
            {clientsQuery.error && (
              <p className="text-sm text-[var(--danger)]">
                {clientsQuery.error.message}
              </p>
            )}
            <ul className="max-h-[42vh] space-y-2 overflow-y-auto">
              {filteredClients.map((c) => {
                const selected = clientId === c.id
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => pickExistingClient(c)}
                      className={[
                        'w-full rounded-2xl border px-4 py-3 text-left transition',
                        selected
                          ? 'border-[var(--accent)] bg-[var(--accent)]/10'
                          : 'border-[var(--border)] bg-[var(--bg-elevated)]',
                      ].join(' ')}
                    >
                      <p className="font-semibold">{clientDisplayName(c)}</p>
                      <p className="text-xs text-[var(--text-muted)]">
                        {[c.phone, c.email, c.city].filter(Boolean).join(' · ') ||
                          'Sin contacto'}
                      </p>
                    </button>
                  </li>
                )
              })}
              {!clientsQuery.isLoading && !filteredClients.length && (
                <li className="py-8 text-center text-sm text-[var(--text-muted)]">
                  No hay clientes que coincidan
                </li>
              )}
            </ul>
            {clientId && (
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-elevated)] p-4 text-sm">
                {clientDetailQuery.isLoading ? (
                  <p className="text-[var(--text-muted)]">Cargando servicios…</p>
                ) : existingServices.length > 0 ? (
                  <>
                    <p className="text-xs text-[var(--text-muted)]">
                      Servicios activos ({existingServices.length})
                    </p>
                    <ul className="mt-1.5 space-y-1 text-[var(--text-muted)]">
                      {existingServices.map((s) => (
                        <li key={s.id}>
                          {s.name}
                          {s.servicePlan?.name ? ` · ${s.servicePlan.name}` : ''}
                          {s.onuId ? ' · con ONU' : ' · sin ONU'}
                        </li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <p className="text-xs text-[var(--text-muted)]">
                    Sin servicios activos aún: se aprovisionará el primero.
                  </p>
                )}
              </div>
            )}
          </>
        )}

        {step === 1 && clientMode === 'new' && (
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
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-sm">
                <span className="mb-1 block text-[var(--text-muted)]">
                  Tipo doc.
                </span>
                <select
                  className={field}
                  value={selectedDocType?.id ?? ''}
                  onChange={(e) => setDocumentType(e.target.value)}
                >
                  {docTypes.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-[var(--text-muted)]">
                  {selectedDocType?.label ?? 'Documento'}
                </span>
                <input
                  className={field}
                  placeholder={selectedDocType?.placeholder}
                  value={documentNumber}
                  onChange={(e) => setDocumentNumber(e.target.value)}
                  onBlur={(e) =>
                    setDocumentNumber(
                      formatDocument(
                        country,
                        selectedDocType?.id ?? '',
                        e.target.value,
                      ),
                    )
                  }
                />
              </label>
            </div>
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4 rounded border-[var(--border)]"
                checked={isCompany}
                onChange={(e) => setIsCompany(e.target.checked)}
              />
              Empresa
            </label>
            {isCompany && (
              <div className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-3">
                <label className="block text-sm">
                  <span className="mb-1 block text-[var(--text-muted)]">
                    Nombre empresa
                  </span>
                  <input
                    className={field}
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                  />
                </label>
                <label className="block text-sm">
                  <span className="mb-1 block text-[var(--text-muted)]">
                    {companyDoc.label}
                  </span>
                  <input
                    className={field}
                    placeholder={companyDoc.placeholder}
                    value={companyTaxId}
                    onChange={(e) => setCompanyTaxId(e.target.value)}
                    onBlur={(e) =>
                      setCompanyTaxId(
                        formatDocument(country, companyDoc.id, e.target.value),
                      )
                    }
                  />
                </label>
              </div>
            )}
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
              {clientMode === 'existing'
                ? `Nuevo servicio para ${clientName || 'cliente'}`
                : 'Servicio e instalación'}
            </p>
            {clientMode === 'existing' && existingServices.length > 0 && (
              <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2 text-xs text-[var(--text-muted)]">
                Servicios activos ({existingServices.length}):{' '}
                {existingServices.map((s) => s.name).join(', ')}
              </div>
            )}
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
                  Cliente:{' '}
                  {clientMode === 'existing'
                    ? clientName || '—'
                    : isCompany && companyName.trim()
                      ? companyName.trim()
                      : [firstName, lastName].filter(Boolean).join(' ')}
                  {clientMode === 'existing' ? ' (existente)' : ''}
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
          {step === 0 ? (
            <Link
              to="/movil"
              className="flex flex-1 items-center justify-center rounded-xl border border-[var(--border)] py-3.5 text-sm font-semibold"
            >
              Cancelar
            </Link>
          ) : step > 0 ? (
            <button
              type="button"
              onClick={back}
              className="flex-1 rounded-xl border border-[var(--border)] py-3.5 text-sm font-semibold"
            >
              Atrás
            </button>
          ) : null}
          {step > 0 && step < 4 ? (
            <button
              type="button"
              onClick={next}
              className="flex-[1.4] rounded-xl bg-[var(--accent)] py-3.5 text-sm font-semibold text-white"
            >
              Siguiente
            </button>
          ) : null}
          {step === 4 ? (
            <button
              type="button"
              onClick={finish}
              className="flex-[1.4] rounded-xl bg-[var(--accent)] py-3.5 text-sm font-semibold text-white"
            >
              Instalar
            </button>
          ) : null}
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
            navigate('/movil', { replace: true })
          }
        }}
      />
    </div>
  )
}
