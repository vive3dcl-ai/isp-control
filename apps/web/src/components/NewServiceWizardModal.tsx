import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'
import type {
  AuthorizeOnuResponse,
  UncfgOnu,
  UncfgResponse,
} from '../lib/onu-connected'
import {
  onuDescriptionForService,
  oltOnuName,
} from '../lib/onu-connected'
import type { IpPoolsResponse } from '../lib/ip-pools'
import type { Tr069ProfilesResponse } from '../lib/tr069'
import type { Client, ClientService, ServicePlan } from '../lib/crm'
import { useMoney } from '../lib/currency'
import { AddressLocationFields } from './AddressLocationFields'
import { LocationPickerMap } from './LocationPickerMap'
import {
  OperationProgressModal,
  runProgressSteps,
  type ProgressStep,
} from './OperationProgressModal'
import type { Zone } from './ZonasSettingsTab'
import { ModalPortal } from './ModalPortal'


const inputClass =
  'w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm outline-none ring-[var(--accent)] focus:ring-2'

const STEPS = [
  { n: 1, label: 'ONU' },
  { n: 2, label: 'Ubicación' },
  { n: 3, label: 'Plan' },
  { n: 4, label: 'Red' },
] as const

export function NewServiceWizardModal({
  open,
  clientId,
  clientName,
  client,
  onClose,
}: {
  open: boolean
  clientId: string
  clientName: string
  /** Cliente completo para poder reutilizar su dirección. */
  client?: Client | null
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const money = useMoney()
  const [step, setStep] = useState(1)
  const [error, setError] = useState<string | null>(null)

  // Paso 1 — ONU
  const [oltFilter, setOltFilter] = useState('')
  const [search, setSearch] = useState('')
  const [orphan, setOrphan] = useState<UncfgOnu | null>(null)
  const [onuNumber, setOnuNumber] = useState('')

  // Paso 2 — Ubicación
  const clientHasAddress = !!(
    client &&
    (client.street.trim() ||
      (client.latitude != null && client.longitude != null))
  )
  const [useClientAddr, setUseClientAddr] = useState(false)
  const [name, setName] = useState('')
  const [street, setStreet] = useState('')
  const [city, setCity] = useState('')
  const [zipCode, setZipCode] = useState('')
  const [lat, setLat] = useState<number | null>(null)
  const [lng, setLng] = useState<number | null>(null)
  const [zoneId, setZoneId] = useState('')

  // Paso 3 — Plan
  const [servicePlanId, setServicePlanId] = useState('')

  // Paso 4 — Red
  const [mgmtVlanPick, setMgmtVlanPick] = useState('')
  const [wanVlanPick, setWanVlanPick] = useState('')
  const [tr069ProfilePick, setTr069ProfilePick] = useState('')

  // Progreso final
  const [progressOpen, setProgressOpen] = useState(false)
  const [progressSteps, setProgressSteps] = useState<ProgressStep[]>([])
  const [progressRunning, setProgressRunning] = useState(false)
  const [progressFailed, setProgressFailed] = useState(false)
  const [progressDone, setProgressDone] = useState(false)
  const runnersRef = useRef<Record<string, () => Promise<string | void>>>({})
  /** Resultados intermedios que sobreviven a los reintentos. */
  const ctxRef = useRef<{ onuDbId?: string; serviceId?: string }>({})

  useEffect(() => {
    if (!open) return
    setStep(1)
    setError(null)
    setOltFilter('')
    setSearch('')
    setOrphan(null)
    setOnuNumber('')
    setName('')
    if (clientHasAddress && client) {
      // Por defecto reutilizamos la dirección del cliente.
      setUseClientAddr(true)
      setStreet(client.street)
      setCity(client.city)
      setZipCode(client.zipCode)
      setLat(client.latitude)
      setLng(client.longitude)
    } else {
      setUseClientAddr(false)
      setStreet('')
      setCity('')
      setZipCode('')
      setLat(null)
      setLng(null)
    }
    setZoneId(client?.zoneId ?? '')
    setServicePlanId('')
    setMgmtVlanPick('')
    setWanVlanPick('')
    setTr069ProfilePick('')
    setProgressOpen(false)
    setProgressSteps([])
    setProgressFailed(false)
    setProgressDone(false)
    ctxRef.current = {}
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo resetear al abrir
  }, [open])

  function toggleUseClientAddr(checked: boolean) {
    setUseClientAddr(checked)
    if (checked && client) {
      setStreet(client.street)
      setCity(client.city)
      setZipCode(client.zipCode)
      setLat(client.latitude)
      setLng(client.longitude)
    }
  }

  const uncfgQuery = useQuery({
    queryKey: ['app', 'onus', 'uncfg', oltFilter],
    queryFn: () =>
      apiFetch<UncfgResponse>('/app/onus/uncfg', {
        method: 'POST',
        body: JSON.stringify(oltFilter ? { oltId: oltFilter } : {}),
      }),
    enabled: open && step === 1,
    staleTime: 30_000,
  })

  const plansQuery = useQuery({
    queryKey: ['app', 'service-plans'],
    queryFn: () => apiFetch<ServicePlan[]>('/app/service-plans'),
    enabled: open && step === 3,
  })

  const zonesQuery = useQuery({
    queryKey: ['app', 'zones'],
    queryFn: () => apiFetch<Zone[]>('/app/zones'),
    enabled: open && step === 2,
    staleTime: 60_000,
  })

  const mgmtPoolsQuery = useQuery({
    queryKey: ['app', 'settings', 'ip-pools', 'management', orphan?.oltId],
    queryFn: () =>
      apiFetch<IpPoolsResponse>(
        `/app/settings/ip-pools?purpose=management&oltId=${encodeURIComponent(orphan!.oltId)}`,
      ),
    enabled: open && step === 4 && !!orphan,
  })

  const wanPoolsQuery = useQuery({
    queryKey: ['app', 'settings', 'ip-pools', 'internet', orphan?.oltId],
    queryFn: () =>
      apiFetch<IpPoolsResponse>(
        `/app/settings/ip-pools?purpose=internet&oltId=${encodeURIComponent(orphan!.oltId)}`,
      ),
    enabled: open && step === 4 && !!orphan,
  })

  const tr069ProfilesQuery = useQuery({
    queryKey: ['app', 'settings', 'tr069', 'profiles'],
    queryFn: () =>
      apiFetch<Tr069ProfilesResponse>('/app/settings/tr069/profiles'),
    enabled: open && step === 4 && !!orphan,
    staleTime: 60_000,
  })

  const mgmtPools = mgmtPoolsQuery.data?.pools ?? []
  const wanPools = wanPoolsQuery.data?.pools ?? []
  const tr069Profiles = useMemo(() => {
    const all = tr069ProfilesQuery.data?.profiles ?? []
    const oltId = orphan?.oltId
    if (!oltId) return all
    const attached = all.filter((p) => p.oltIds?.includes(oltId))
    return attached.length ? attached : all
  }, [tr069ProfilesQuery.data?.profiles, orphan?.oltId])

  // Preseleccionar mgmt si hay un solo pool
  useEffect(() => {
    if (step === 4 && !mgmtVlanPick && mgmtPools.length === 1) {
      setMgmtVlanPick(String(mgmtPools[0].vlanId))
    }
  }, [step, mgmtPools, mgmtVlanPick])

  useEffect(() => {
    if (step !== 4 || tr069ProfilePick) return
    if (tr069Profiles.length === 1) {
      setTr069ProfilePick(tr069Profiles[0].id)
    }
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

  const plans = (plansQuery.data ?? []).filter((p) => p.isActive)
  const selectedPlan = plans.find((p) => p.id === servicePlanId)

  function pickOrphan(o: UncfgOnu) {
    setOrphan(o)
    setOnuNumber(o.suggestedOnuId != null ? String(o.suggestedOnuId) : '1')
  }

  function validateStep(current: number): string | null {
    if (current === 1) {
      if (!orphan) return 'Selecciona una ONU de la lista.'
      if (!/^\d+$/.test(onuNumber.trim()))
        return 'El ONU ID debe ser un número.'
    }
    if (current === 2) {
      if (name.trim().length < 2)
        return 'Ponle un nombre al servicio (mínimo 2 caracteres).'
      if (!street.trim() && (lat == null || lng == null))
        return 'Indica una dirección o marca el punto en el mapa.'
    }
    if (current === 3) {
      if (!servicePlanId) return 'Selecciona un plan de servicio.'
    }
    if (current === 4) {
      if (mgmtPools.length > 0 && !mgmtVlanPick)
        return 'Selecciona la VLAN de management.'
      if (mgmtVlanPick && tr069Profiles.length > 0 && !tr069ProfilePick)
        return 'Selecciona el perfil TR069.'
    }
    return null
  }

  function next() {
    const err = validateStep(step)
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

  function finish() {
    const err = validateStep(4)
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

    const steps: ProgressStep[] = [
      { id: 'authorize', label: 'Autorizando ONU en la OLT', status: 'pending' },
      {
        id: 'zone',
        label: 'Asignando zona al cliente y a la ONU',
        status: 'pending',
      },
      { id: 'service', label: 'Creando servicio del cliente', status: 'pending' },
      ...(hasNetwork
        ? ([
            {
              id: 'olt',
              label: 'Configurando VLANs en la OLT (service-port)',
              status: 'pending',
            },
            {
              id: 'assign',
              label: 'Asignando IPs de los pools (mgmt / WAN)',
              status: 'pending',
            },
            {
              id: 'apply',
              label: 'Aplicando configuración a la ONU',
              status: 'pending',
            },
            {
              id: 'verify',
              label: 'Esperando ONU online y verificando configuración',
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

    const runners: Record<string, () => Promise<string | void>> = {
      authorize: async () => {
        const r = await apiFetch<AuthorizeOnuResponse>('/app/onus/authorize', {
          method: 'POST',
          body: JSON.stringify({
            oltId: orphan.oltId,
            oltIf: orphan.oltIf,
            onuId: onuNumber.trim(),
            sn: orphan.sn,
            onuType: null,
            name: oltOnuName(clientName, name),
            description: onuDescriptionForService({
              latitude: lat,
              longitude: lng,
              street,
              city,
              zipCode,
            }),
          }),
        })
        ctxRef.current.onuDbId = r.onu?.id
        return r.message || 'ONU autorizada'
      },
      zone: async () => {
        const nextZoneId = zoneId.trim() ? zoneId.trim() : null
        await apiFetch(`/app/clients/${clientId}`, {
          method: 'PATCH',
          body: JSON.stringify({ zoneId: nextZoneId }),
        })
        const onuId = requireOnuDbId()
        await apiFetch(`/app/onus/${onuId}/zone`, {
          method: 'PATCH',
          body: JSON.stringify({ zoneId: nextZoneId }),
        })
        return nextZoneId
          ? 'Zona asignada al cliente y a la ONU'
          : 'Sin zona (cliente y ONU)'
      },
      service: async () => {
        const r = await apiFetch<ClientService>(
          `/app/clients/${clientId}/services`,
          {
            method: 'POST',
            body: JSON.stringify({
              servicePlanId,
              name: name.trim(),
              status: 'active',
              street: street.trim(),
              city: city.trim(),
              zipCode: zipCode.trim(),
              onuId: ctxRef.current.onuDbId,
              latitude: lat ?? undefined,
              longitude: lng ?? undefined,
            }),
          },
        )
        ctxRef.current.serviceId = r.id
        return `Servicio «${r.name}» creado`
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
            return `${r.message || 'ONU OK'}${attempt > 1 ? ` (intento ${attempt})` : ''}`
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
            `Mgmt quedó en VLAN ${r.mgmtVlanId ?? '—'}, se esperaba ${mgmtVlan}`,
          )
        }
        if (wanVlan != null && r.wanVlanId !== wanVlan) {
          throw new Error(
            `WAN quedó en VLAN ${r.wanVlanId ?? '—'}, se esperaba ${wanVlan}`,
          )
        }
        return r.message || 'Configuración verificada'
      },
    }

    runnersRef.current = runners
    setProgressSteps(steps)
    setProgressOpen(true)
    void executeProgress(steps)
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
      void queryClient.invalidateQueries({
        queryKey: ['app', 'clients', clientId],
      })
      void queryClient.invalidateQueries({ queryKey: ['app', 'dashboard'] })
      void queryClient.invalidateQueries({ queryKey: ['app', 'onus'] })
      void queryClient.invalidateQueries({ queryKey: ['app', 'zones'] })
      void queryClient.invalidateQueries({
        queryKey: ['app', 'settings', 'ip-pools'],
      })
    } else {
      setProgressFailed(true)
    }
  }

  if (!open) return null

  return (
    <>
      <ModalPortal><div className="fixed inset-0 z-[100] modal-backdrop flex items-stretch justify-center overflow-hidden bg-black/60 sm:items-center sm:p-4">
        <div
          role="dialog"
          aria-modal="true"
          className="flex h-[100dvh] max-h-[100dvh] w-full max-w-2xl flex-col overflow-hidden rounded-none border-0 sm:h-auto sm:max-h-[min(92dvh,920px)] sm:rounded-xl sm:border border-[var(--border)] bg-[var(--bg-elevated)] shadow-xl"
        >
          <div className="border-b border-[var(--border)] px-5 py-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Nuevo servicio</h2>
              <button
                type="button"
                onClick={onClose}
                className="rounded-md px-2 py-1 text-[var(--text-muted)] hover:bg-[var(--bg)]"
              >
                ✕
              </button>
            </div>
            <ol className="mt-3 flex gap-2">
              {STEPS.map((s) => (
                <li key={s.n} className="flex flex-1 flex-col gap-1">
                  <span
                    className={[
                      'h-1 rounded-full',
                      step >= s.n
                        ? 'bg-[var(--accent)]'
                        : 'bg-[var(--border)]',
                    ].join(' ')}
                  />
                  <span
                    className={[
                      'text-xs',
                      step === s.n
                        ? 'font-medium text-[var(--text)]'
                        : 'text-[var(--text-muted)]',
                    ].join(' ')}
                  >
                    {s.n}. {s.label}
                  </span>
                </li>
              ))}
            </ol>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
            {step === 1 && (
              <div className="space-y-3">
                <p className="text-sm text-[var(--text-muted)]">
                  Selecciona la ONU instalada en el domicilio (aparece como
                  «huérfana» hasta autorizarla).
                </p>
                <div className="flex flex-wrap gap-2">
                  <select
                    className={`${inputClass} w-auto min-w-[11rem]`}
                    value={oltFilter}
                    onChange={(e) => setOltFilter(e.target.value)}
                  >
                    <option value="">Todas las OLTs</option>
                    {(uncfgQuery.data?.olts ?? []).map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                  </select>
                  <input
                    className={`${inputClass} min-w-[12rem] flex-1`}
                    placeholder="Buscar por serial, puerto…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                  <button
                    type="button"
                    disabled={uncfgQuery.isFetching}
                    onClick={() => void uncfgQuery.refetch()}
                    className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm hover:bg-[var(--bg)] disabled:opacity-60"
                  >
                    {uncfgQuery.isFetching ? 'Buscando…' : 'Refrescar'}
                  </button>
                </div>

                {uncfgQuery.error && (
                  <p className="text-sm text-[var(--danger)]">
                    {uncfgQuery.error.message}
                  </p>
                )}

                <div className="max-h-64 overflow-y-auto rounded-lg border border-[var(--border)]">
                  {uncfgQuery.isLoading ? (
                    <p className="px-3 py-6 text-sm text-[var(--text-muted)]">
                      Buscando ONUs huérfanas en las OLTs…
                    </p>
                  ) : orphans.length === 0 ? (
                    <p className="px-3 py-6 text-sm text-[var(--text-muted)]">
                      No hay ONUs huérfanas
                      {search ? ' que coincidan con la búsqueda' : ''}.
                    </p>
                  ) : (
                    <ul className="divide-y divide-[var(--border)]">
                      {orphans.map((o) => {
                        const selected =
                          orphan?.sn === o.sn && orphan?.oltIf === o.oltIf
                        return (
                          <li key={`${o.oltId}-${o.oltIf}-${o.sn}`}>
                            <button
                              type="button"
                              onClick={() => pickOrphan(o)}
                              className={[
                                'flex w-full items-center gap-3 px-3 py-2 text-left text-sm',
                                selected
                                  ? 'bg-[var(--accent)]/10'
                                  : 'hover:bg-[var(--bg)]',
                              ].join(' ')}
                            >
                              <span
                                className={[
                                  'flex h-4 w-4 shrink-0 items-center justify-center rounded-full border',
                                  selected
                                    ? 'border-[var(--accent)]'
                                    : 'border-[var(--border)]',
                                ].join(' ')}
                              >
                                {selected && (
                                  <span className="h-2 w-2 rounded-full bg-[var(--accent)]" />
                                )}
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="block font-mono text-xs">
                                  {o.sn}
                                </span>
                                <span className="block text-xs text-[var(--text-muted)]">
                                  {o.oltName} · {o.oltIf} ·{' '}
                                  {o.ponType.toUpperCase()}
                                  {o.state ? ` · ${o.state}` : ''}
                                </span>
                              </span>
                            </button>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </div>

                {orphan && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="block text-sm">
                      <span className="mb-1 block text-[var(--text-muted)]">
                        ONU ID en el puerto
                      </span>
                      <input
                        className={inputClass}
                        inputMode="numeric"
                        value={onuNumber}
                        onChange={(e) => setOnuNumber(e.target.value)}
                      />
                      {orphan.suggestedOnuId != null && (
                        <span className="mt-1 block text-xs text-[var(--text-muted)]">
                          Sugerido (siguiente libre): {orphan.suggestedOnuId}
                        </span>
                      )}
                    </label>
                    <div className="self-end pb-1 text-xs text-[var(--text-muted)]">
                      El tipo de ONU se detecta automáticamente al autorizar.
                    </div>
                  </div>
                )}
              </div>
            )}

            {step === 2 && (
              <div className="space-y-3">
                <label className="block text-sm">
                  <span className="mb-1 block text-[var(--text-muted)]">
                    Nombre del servicio
                  </span>
                  <input
                    className={inputClass}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Ej.: Internet hogar — Los Aromos 123"
                  />
                </label>

                {clientHasAddress && (
                  <label className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm">
                    <input
                      type="checkbox"
                      checked={useClientAddr}
                      onChange={(e) => toggleUseClientAddr(e.target.checked)}
                    />
                    <span>
                      Usar dirección del cliente
                      <span className="block text-xs text-[var(--text-muted)]">
                        {[client?.street, client?.city]
                          .filter(Boolean)
                          .join(', ') || 'Ubicación marcada en el mapa'}
                      </span>
                    </span>
                  </label>
                )}

                {useClientAddr ? (
                  <div className="space-y-2">
                    <div className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm">
                      {[street, city].filter(Boolean).join(', ') ||
                        (lat != null && lng != null
                          ? `${lat.toFixed(6)}, ${lng.toFixed(6)}`
                          : 'Ubicación del cliente')}
                    </div>
                    <LocationPickerMap
                      key="client-addr"
                      lat={lat}
                      lng={lng}
                      readOnly
                      className="h-48 w-full rounded-lg"
                    />
                    <p className="text-xs text-[var(--text-muted)]">
                      Usando la ubicación del cliente. Desmarca el check para
                      elegir otra.
                    </p>
                  </div>
                ) : (
                  <AddressLocationFields
                    value={{
                      street,
                      city,
                      zipCode,
                      latitude: lat,
                      longitude: lng,
                    }}
                    onChange={(next) => {
                      setStreet(next.street)
                      setCity(next.city)
                      setZipCode(next.zipCode)
                      setLat(next.latitude)
                      setLng(next.longitude)
                    }}
                    mapClassName="h-48 w-full rounded-lg"
                  />
                )}

                <label className="block text-sm">
                  <span className="mb-1 block text-[var(--text-muted)]">
                    Zona
                  </span>
                  <select
                    className={inputClass}
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
                  <span className="mt-1 block text-[11px] text-[var(--text-muted)]">
                    Se guarda en el cliente y en la ONU. Catálogo: Ajustes →
                    Zonas.
                  </span>
                </label>
              </div>
            )}

            {step === 3 && (
              <div className="space-y-3">
                <p className="text-sm text-[var(--text-muted)]">
                  Selecciona el plan que contrata el cliente.
                </p>
                {plansQuery.isLoading && (
                  <p className="text-sm text-[var(--text-muted)]">
                    Cargando planes…
                  </p>
                )}
                <ul className="space-y-2">
                  {plans.map((p) => {
                    const selected = servicePlanId === p.id
                    return (
                      <li key={p.id}>
                        <button
                          type="button"
                          onClick={() => setServicePlanId(p.id)}
                          className={[
                            'flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left text-sm',
                            selected
                              ? 'border-[var(--accent)] bg-[var(--accent)]/10'
                              : 'border-[var(--border)] hover:bg-[var(--bg)]',
                          ].join(' ')}
                        >
                          <span
                            className={[
                              'flex h-4 w-4 shrink-0 items-center justify-center rounded-full border',
                              selected
                                ? 'border-[var(--accent)]'
                                : 'border-[var(--border)]',
                            ].join(' ')}
                          >
                            {selected && (
                              <span className="h-2 w-2 rounded-full bg-[var(--accent)]" />
                            )}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block font-medium">{p.name}</span>
                            <span className="block text-xs text-[var(--text-muted)]">
                              {p.speedProfile
                                ? `${p.speedProfile.name} · ↓${p.speedProfile.downloadMbps} / ↑${p.speedProfile.uploadMbps} Mbps`
                                : `↓${p.downloadSpeed} / ↑${p.uploadSpeed} Mbps`}
                            </span>
                          </span>
                          <span className="shrink-0 font-medium">
                            {money(p.price)}
                          </span>
                        </button>
                      </li>
                    )
                  })}
                  {!plansQuery.isLoading && plans.length === 0 && (
                    <li className="text-sm text-[var(--text-muted)]">
                      No hay planes activos. Crea uno en Ajustes → Planes.
                    </li>
                  )}
                </ul>
              </div>
            )}

            {step === 4 && orphan && (
              <div className="space-y-3">
                <p className="text-sm text-[var(--text-muted)]">
                  Red para la ONU <span className="font-mono">{orphan.sn}</span>{' '}
                  en {orphan.oltName}. Se asignan las VLANs y las IPs de los
                  pools, igual que en el aprovisionamiento manual.
                </p>

                <label className="block text-sm">
                  <span className="mb-1 block text-[var(--text-muted)]">
                    VLAN management
                  </span>
                  <select
                    className={inputClass}
                    value={mgmtVlanPick}
                    onChange={(e) => setMgmtVlanPick(e.target.value)}
                  >
                    <option value="">Sin asignar…</option>
                    {mgmtPools.map((p) => (
                      <option key={p.id} value={p.vlanId}>
                        VLAN {p.vlanId}
                        {p.name ? ` — ${p.name}` : ''} ({p.available} IPs
                        libres)
                      </option>
                    ))}
                  </select>
                  {!mgmtPoolsQuery.isLoading && mgmtPools.length === 0 && (
                    <span className="mt-1 block text-xs text-amber-400">
                      No hay pools de management en esta OLT.
                    </span>
                  )}
                </label>

                <label className="block text-sm">
                  <span className="mb-1 block text-[var(--text-muted)]">
                    VLAN WAN / Internet
                  </span>
                  <select
                    className={inputClass}
                    value={wanVlanPick}
                    onChange={(e) => setWanVlanPick(e.target.value)}
                  >
                    <option value="">Sin WAN…</option>
                    {wanPools.map((p) => (
                      <option key={p.id} value={p.vlanId}>
                        VLAN {p.vlanId}
                        {p.name ? ` — ${p.name}` : ''} ({p.available} IPs
                        libres)
                      </option>
                    ))}
                  </select>
                  {!wanPoolsQuery.isLoading && wanPools.length === 0 && (
                    <span className="mt-1 block text-xs text-[var(--text-muted)]">
                      No hay pools WAN (Internet) en esta OLT.
                    </span>
                  )}
                </label>

                <label className="block text-sm">
                  <span className="mb-1 block text-[var(--text-muted)]">
                    Perfil TR069
                  </span>
                  <select
                    className={inputClass}
                    value={tr069ProfilePick}
                    onChange={(e) => setTr069ProfilePick(e.target.value)}
                    disabled={!mgmtVlanPick}
                  >
                    <option value="">
                      {mgmtVlanPick
                        ? 'Seleccionar perfil…'
                        : 'Primero elige VLAN management'}
                    </option>
                    {tr069Profiles.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  {!tr069ProfilesQuery.isLoading &&
                    tr069Profiles.length === 0 && (
                      <span className="mt-1 block text-xs text-amber-400">
                        No hay perfiles TR069. Créalos en Ajustes → TR069.
                      </span>
                    )}
                </label>

                <div className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-xs text-[var(--text-muted)]">
                  <p className="mb-1 font-medium text-[var(--text)]">Resumen</p>
                  <p>ONU: {orphan.sn} · {orphan.oltName} ({orphan.oltIf})</p>
                  <p>
                    Nombre en OLT:{' '}
                    <span className="font-medium text-[var(--text)]">
                      {oltOnuName(clientName, name)}
                    </span>
                  </p>
                  <p>Servicio: {name || '—'}</p>
                  <p>
                    Plan: {selectedPlan ? `${selectedPlan.name} · ${money(selectedPlan.price)}` : '—'}
                  </p>
                  <p>
                    Red: mgmt {mgmtVlanPick ? `VLAN ${mgmtVlanPick}` : '—'} ·
                    WAN {wanVlanPick ? `VLAN ${wanVlanPick}` : '—'}
                  </p>
                  <p>
                    TR069:{' '}
                    {tr069ProfilePick
                      ? tr069Profiles.find((p) => p.id === tr069ProfilePick)
                          ?.name ?? tr069ProfilePick
                      : '—'}
                  </p>
                </div>
              </div>
            )}

            {error && (
              <p className="mt-3 text-sm text-[var(--danger)]">{error}</p>
            )}
          </div>

          <div className="flex justify-between gap-2 border-t border-[var(--border)] px-5 py-3">
            <button
              type="button"
              onClick={step === 1 ? onClose : back}
              className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm hover:bg-[var(--bg)]"
            >
              {step === 1 ? 'Cancelar' : '← Atrás'}
            </button>
            {step < 4 ? (
              <button
                type="button"
                onClick={next}
                className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)]"
              >
                Siguiente →
              </button>
            ) : (
              <button
                type="button"
                onClick={finish}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
              >
                Terminar y aprovisionar
              </button>
            )}
          </div>
        </div>
      </div></ModalPortal>

      <OperationProgressModal
        open={progressOpen}
        title="Creando servicio y aprovisionando"
        steps={progressSteps}
        running={progressRunning}
        failed={progressFailed}
        allDone={progressDone}
        onRetry={() => void executeProgress(progressSteps)}
        onClose={() => {
          if (progressRunning) return
          setProgressOpen(false)
          if (progressDone) onClose()
        }}
      />
    </>
  )
}
