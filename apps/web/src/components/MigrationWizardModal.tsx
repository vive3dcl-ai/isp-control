import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'
import type { Client, ServicePlan } from '../lib/crm'
import { clientDisplayName } from '../lib/crm'
import {
  oltOnuName,
  onuDescriptionForService,
} from '../lib/onu-connected'
import {
  splitSuggestedName,
  type MigrationCandidate,
  type MigrationSegmentConfig,
} from '../lib/onu-migration'
import type { Zone } from './ZonasSettingsTab'
import { ModalPortal } from './ModalPortal'
import {
  OperationProgressModal,
  runProgressSteps,
  type ProgressStep,
} from './OperationProgressModal'

const field =
  'w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm outline-none ring-[var(--accent)] focus:ring-2'

type ClientMode = 'new' | 'existing'

const STEPS = [
  { n: 1, label: 'Cliente' },
  { n: 2, label: 'Servicio' },
  { n: 3, label: 'Red' },
] as const

export function MigrationWizardModal({
  open,
  candidate,
  segment,
  segmentDone,
  segmentTotal,
  remaining,
  onClose,
  onMigrated,
  onPause,
}: {
  open: boolean
  candidate: MigrationCandidate | null
  segment: MigrationSegmentConfig
  segmentDone: number
  segmentTotal: number
  remaining: number
  onClose: () => void
  /** Called after successful migration of current ONU. */
  onMigrated: (onuIf: string) => void
  onPause: () => void
}) {
  const queryClient = useQueryClient()
  const [step, setStep] = useState(1)
  const [error, setError] = useState<string | null>(null)
  const [clientMode, setClientMode] = useState<ClientMode>('new')
  const [clientSearch, setClientSearch] = useState('')

  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [street, setStreet] = useState('')
  const [city, setCity] = useState('')
  const [zoneId, setZoneId] = useState('')
  const [clientId, setClientId] = useState<string | null>(null)
  const [clientName, setClientName] = useState('')

  const [serviceName, setServiceName] = useState('Casa')
  const [servicePlanId, setServicePlanId] = useState('')

  const [progressOpen, setProgressOpen] = useState(false)
  const [progressSteps, setProgressSteps] = useState<ProgressStep[]>([])
  const [progressRunning, setProgressRunning] = useState(false)
  const [progressFailed, setProgressFailed] = useState(false)
  const [progressDone, setProgressDone] = useState(false)
  const runnersRef = useRef<Record<string, () => Promise<string | void>>>({})
  const ctxRef = useRef<{
    onuDbId?: string
    serviceId?: string
    clientId?: string
  }>({})

  const plansQuery = useQuery({
    queryKey: ['app', 'service-plans'],
    queryFn: () => apiFetch<ServicePlan[]>('/app/service-plans'),
    enabled: open,
  })
  const zonesQuery = useQuery({
    queryKey: ['app', 'zones'],
    queryFn: () => apiFetch<Zone[]>('/app/zones'),
    enabled: open,
  })
  const clientsQuery = useQuery({
    queryKey: ['app', 'clients'],
    queryFn: () => apiFetch<Client[]>('/app/clients'),
    enabled: open && clientMode === 'existing',
  })

  const plans = useMemo(
    () => (plansQuery.data ?? []).filter((p) => p.isActive),
    [plansQuery.data],
  )

  const filteredClients = useMemo(() => {
    const q = clientSearch.trim().toLowerCase()
    const list = clientsQuery.data ?? []
    if (!q) return list.slice(0, 40)
    return list
      .filter((c) => clientDisplayName(c).toLowerCase().includes(q))
      .slice(0, 40)
  }, [clientsQuery.data, clientSearch])

  useEffect(() => {
    if (!open || !candidate) return
    setStep(1)
    setError(null)
    setClientMode('new')
    setClientId(null)
    setClientSearch('')
    const split = splitSuggestedName(candidate.suggestedClientName || '')
    const first = candidate.suggestedFirstName || split.firstName
    const last = candidate.suggestedLastName || split.lastName
    const serviceHint = candidate.suggestedServiceName || split.serviceName
    setFirstName(first)
    setLastName(last)
    setClientName(
      candidate.suggestedClientName ||
        [first, last].filter(Boolean).join(' ').trim(),
    )
    setPhone('')
    setEmail('')
    setStreet('')
    setCity('')
    setZoneId('')
    setServiceName(serviceHint || 'Casa')
    setServicePlanId('')
    setProgressOpen(false)
    setProgressDone(false)
    setProgressFailed(false)
    ctxRef.current = { onuDbId: candidate.onuDbId ?? undefined }
  }, [open, candidate])

  useEffect(() => {
    if (!servicePlanId && plans.length === 1) {
      setServicePlanId(plans[0].id)
    }
  }, [plans, servicePlanId])

  if (!open || !candidate) return null

  const pct =
    segmentTotal > 0
      ? Math.round((segmentDone / segmentTotal) * 100)
      : 0

  function validateClient(): string | null {
    if (clientMode === 'existing') {
      if (!clientId) return 'Selecciona un cliente existente'
      return null
    }
    if (!firstName.trim() && !lastName.trim()) {
      return 'Indica al menos el nombre del cliente'
    }
    return null
  }

  function validateService(): string | null {
    if (!serviceName.trim()) return 'Nombre del servicio requerido'
    if (!servicePlanId) return 'Selecciona un plan'
    return null
  }

  async function startMigration() {
    if (!candidate) return
    const migrationCandidate = candidate
    setError(null)
    const err = validateClient() || validateService()
    if (err) {
      setError(err)
      return
    }

    const vlanBody = {
      mgmtVlanId: segment.mgmtVlanId,
      wanVlanId: segment.wanVlanId,
      ...(segment.tr069ProfileId
        ? { tr069ProfileId: segment.tr069ProfileId }
        : {}),
    }

    const steps: ProgressStep[] = [
      { id: 'import', label: 'Registrando ONU en Conectadas', status: 'pending' },
      { id: 'client', label: 'Creando / vinculando cliente', status: 'pending' },
      { id: 'zone', label: 'Asignando zona', status: 'pending' },
      { id: 'service', label: 'Creando servicio', status: 'pending' },
      { id: 'olt', label: 'Reconfigurando VLANs en la OLT', status: 'pending' },
      { id: 'assign', label: 'Asignando IPs de pools', status: 'pending' },
      { id: 'apply', label: 'Aplicando configuración a la ONU', status: 'pending' },
      {
        id: 'verify',
        label: 'Verificando ONU online y servicio activo',
        status: 'pending',
      },
    ]

    const displayName =
      clientMode === 'existing'
        ? clientName
        : [firstName, lastName].filter(Boolean).join(' ').trim()

    const runners: Record<string, () => Promise<string | void>> = {
      import: async () => {
        if (ctxRef.current.onuDbId) {
          return 'ONU ya estaba en Conectadas'
        }
        const snap = {
          onuIf: migrationCandidate.onuIf,
          ponType: migrationCandidate.ponType,
          board: migrationCandidate.board,
          port: migrationCandidate.port,
          onuId: migrationCandidate.onuId,
          sn: migrationCandidate.sn,
          onuType: migrationCandidate.onuType,
          name: migrationCandidate.name,
          description: migrationCandidate.description,
          status: migrationCandidate.status,
          phaseState: migrationCandidate.phaseState,
          adminState: migrationCandidate.adminState,
          online: migrationCandidate.online,
          signalDbm: migrationCandidate.signalDbm,
          mode: migrationCandidate.mode,
          vlan: migrationCandidate.vlan,
          vlans: migrationCandidate.vlans,
        }
        const r = await apiFetch<{ onu?: { id: string } }>(
          '/app/onus/import-one',
          {
            method: 'POST',
            body: JSON.stringify({ oltId: segment.oltId, ...snap }),
          },
        )
        ctxRef.current.onuDbId = r.onu?.id
        if (!ctxRef.current.onuDbId) {
          throw new Error('No se obtuvo ID de ONU tras importar')
        }
        return `Importada ${migrationCandidate.onuIf}`
      },
      client: async () => {
        if (clientMode === 'existing' && clientId) {
          ctxRef.current.clientId = clientId
          return `Cliente existente: ${displayName}`
        }
        const r = await apiFetch<Client>('/app/clients', {
          method: 'POST',
          body: JSON.stringify({
            firstName: firstName.trim(),
            lastName: lastName.trim(),
            phone: phone.trim() || undefined,
            email: email.trim() || undefined,
            street: street.trim() || undefined,
            city: city.trim() || undefined,
            zoneId: zoneId.trim() || null,
            isActive: true,
          }),
        })
        ctxRef.current.clientId = r.id
        return `Cliente creado: ${clientDisplayName(r)}`
      },
      zone: async () => {
        const cid = ctxRef.current.clientId
        const oid = ctxRef.current.onuDbId
        if (!cid || !oid) throw new Error('Falta cliente u ONU')
        const nextZoneId = zoneId.trim() ? zoneId.trim() : null
        if (clientMode === 'new' || nextZoneId) {
          await apiFetch(`/app/clients/${cid}`, {
            method: 'PATCH',
            body: JSON.stringify({ zoneId: nextZoneId }),
          })
        }
        await apiFetch(`/app/onus/${oid}/zone`, {
          method: 'PATCH',
          body: JSON.stringify({ zoneId: nextZoneId }),
        })
        try {
          await apiFetch(`/app/onus/${oid}/description`, {
            method: 'PATCH',
            body: JSON.stringify({
              description:
                onuDescriptionForService({
                  street,
                  city,
                }) ||
                oltOnuName(displayName, serviceName.trim()) ||
                displayName,
            }),
          })
        } catch {
          // non-fatal
        }
        return nextZoneId ? 'Zona asignada' : 'Sin zona'
      },
      service: async () => {
        const cid = ctxRef.current.clientId
        const oid = ctxRef.current.onuDbId
        if (!cid || !oid) throw new Error('Falta cliente u ONU')
        const r = await apiFetch<{ id: string; name: string }>(
          `/app/clients/${cid}/services`,
          {
            method: 'POST',
            body: JSON.stringify({
              servicePlanId,
              name: serviceName.trim(),
              status: 'active',
              street: street.trim(),
              city: city.trim(),
              onuId: oid,
            }),
          },
        )
        ctxRef.current.serviceId = r.id
        return `Servicio «${r.name}» activo`
      },
      olt: async () => {
        const oid = ctxRef.current.onuDbId
        if (!oid) throw new Error('Falta ONU')
        const r = await apiFetch<{ message?: string }>(
          `/app/onus/${oid}/network-vlans/olt`,
          { method: 'POST', body: JSON.stringify(vlanBody) },
        )
        return r.message || 'VLANs en OLT OK'
      },
      assign: async () => {
        const oid = ctxRef.current.onuDbId!
        const r = await apiFetch<{ message?: string }>(
          `/app/onus/${oid}/network-vlans/assign`,
          { method: 'POST', body: JSON.stringify(vlanBody) },
        )
        return r.message || 'IPs asignadas'
      },
      apply: async () => {
        const oid = ctxRef.current.onuDbId!
        let lastErr: unknown = null
        for (let attempt = 1; attempt <= 2; attempt++) {
          try {
            const r = await apiFetch<{ message?: string }>(
              `/app/onus/${oid}/network-vlans/apply`,
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
        const oid = ctxRef.current.onuDbId!
        const r = await apiFetch<{
          ok: boolean
          message?: string
          mgmtVlanId?: number | null
          wanVlanId?: number | null
        }>(`/app/onus/${oid}/network-vlans/verify`, { method: 'POST' })
        if (r.mgmtVlanId !== segment.mgmtVlanId) {
          throw new Error(
            `Mgmt quedó en VLAN ${r.mgmtVlanId ?? '—'}, se esperaba ${segment.mgmtVlanId}`,
          )
        }
        if (r.wanVlanId !== segment.wanVlanId) {
          throw new Error(
            `WAN quedó en VLAN ${r.wanVlanId ?? '—'}, se esperaba ${segment.wanVlanId}`,
          )
        }
        return r.message || 'Servicio verificado y online'
      },
    }

    runnersRef.current = runners
    setProgressSteps(steps)
    setProgressOpen(true)
    setProgressRunning(true)
    setProgressFailed(false)
    setProgressDone(false)
    const result = await runProgressSteps(steps, setProgressSteps, runners)
    setProgressRunning(false)
    if (result.ok) {
      setProgressDone(true)
      void queryClient.invalidateQueries({ queryKey: ['app', 'onus'] })
      void queryClient.invalidateQueries({ queryKey: ['app', 'clients'] })
      void queryClient.invalidateQueries({
        queryKey: ['app', 'onus', 'migration'],
      })
    } else {
      setProgressFailed(true)
    }
  }

  return (
    <>
      <ModalPortal>
        <div className="fixed inset-0 z-[100] modal-backdrop flex items-stretch justify-center overflow-hidden bg-black/60 sm:items-center sm:p-4">
          <div
            role="dialog"
            aria-modal="true"
            className="flex h-[100dvh] max-h-[100dvh] w-full max-w-2xl flex-col overflow-hidden rounded-none border-0 sm:h-auto sm:max-h-[min(92dvh,920px)] sm:rounded-xl sm:border border-[var(--border)] bg-[var(--bg-elevated)] shadow-xl"
          >
            <div className="border-b border-[var(--border)] px-5 py-4">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-lg font-semibold">Migrar ONU</h2>
                  <p className="truncate text-xs text-[var(--text-muted)]">
                    {candidate.onuIf}
                    {candidate.sn ? ` · ${candidate.sn}` : ''}
                    {segment.sourceVlan != null
                      ? ` · origen VLAN ${segment.sourceVlan}`
                      : ''}
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
              <div className="mt-3">
                <div className="mb-1 flex justify-between text-[11px] text-[var(--text-muted)]">
                  <span>
                    Segmento {segmentDone}/{segmentTotal} ({pct}%)
                  </span>
                  <span>{remaining} pendientes</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-[var(--bg)]">
                  <div
                    className="h-full rounded-full bg-[var(--accent)] transition-all"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
              <ol className="mt-3 flex gap-2">
                {STEPS.map((s) => (
                  <li key={s.n} className="flex flex-1 flex-col gap-1">
                    <div
                      className={[
                        'h-1 rounded-full',
                        step >= s.n
                          ? 'bg-[var(--accent)]'
                          : 'bg-[var(--border)]',
                      ].join(' ')}
                    />
                    <span className="text-[10px] text-[var(--text-muted)]">
                      {s.label}
                    </span>
                  </li>
                ))}
              </ol>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4">
              {error && (
                <p className="mb-3 rounded-lg border border-[var(--danger)]/40 bg-[var(--danger)]/10 px-3 py-2 text-sm text-[var(--danger)]">
                  {error}
                </p>
              )}

              {step === 1 && (
                <div className="space-y-3">
                  <div className="rounded-lg border border-[var(--border)] bg-[var(--bg)]/50 px-3 py-2 text-xs text-[var(--text-muted)]">
                    ONU name: {candidate.name || '—'}
                    {candidate.description ? (
                      <> · desc: {candidate.description}</>
                    ) : null}
                    {candidate.suggestedClientName ? (
                      <>
                        {' '}
                        · cliente:{' '}
                        <strong className="text-[var(--text)]">
                          {candidate.suggestedFirstName ||
                            candidate.suggestedClientName}
                          {candidate.suggestedLastName
                            ? ` ${candidate.suggestedLastName}`
                            : ''}
                        </strong>{' '}
                        (desde {candidate.nameSource}/
                        {candidate.nameConfidence})
                      </>
                    ) : null}
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setClientMode('new')}
                      className={[
                        'flex-1 rounded-lg border px-3 py-2 text-sm',
                        clientMode === 'new'
                          ? 'border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]'
                          : 'border-[var(--border)]',
                      ].join(' ')}
                    >
                      Cliente nuevo
                    </button>
                    <button
                      type="button"
                      onClick={() => setClientMode('existing')}
                      className={[
                        'flex-1 rounded-lg border px-3 py-2 text-sm',
                        clientMode === 'existing'
                          ? 'border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]'
                          : 'border-[var(--border)]',
                      ].join(' ')}
                    >
                      Existente
                    </button>
                  </div>

                  {clientMode === 'new' ? (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="block text-sm">
                        <span className="mb-1 block text-[var(--text-muted)]">
                          Nombre
                        </span>
                        <input
                          className={field}
                          value={firstName}
                          onChange={(e) => setFirstName(e.target.value)}
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
                        />
                      </label>
                      <label className="block text-sm">
                        <span className="mb-1 block text-[var(--text-muted)]">
                          Teléfono
                        </span>
                        <input
                          className={field}
                          value={phone}
                          onChange={(e) => setPhone(e.target.value)}
                        />
                      </label>
                      <label className="block text-sm">
                        <span className="mb-1 block text-[var(--text-muted)]">
                          Email
                        </span>
                        <input
                          className={field}
                          type="email"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                        />
                      </label>
                      <label className="block text-sm sm:col-span-2">
                        <span className="mb-1 block text-[var(--text-muted)]">
                          Dirección
                        </span>
                        <input
                          className={field}
                          value={street}
                          onChange={(e) => setStreet(e.target.value)}
                        />
                      </label>
                      <label className="block text-sm">
                        <span className="mb-1 block text-[var(--text-muted)]">
                          Ciudad
                        </span>
                        <input
                          className={field}
                          value={city}
                          onChange={(e) => setCity(e.target.value)}
                        />
                      </label>
                      <label className="block text-sm">
                        <span className="mb-1 block text-[var(--text-muted)]">
                          Zona
                        </span>
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
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <input
                        className={field}
                        placeholder="Buscar cliente…"
                        value={clientSearch}
                        onChange={(e) => setClientSearch(e.target.value)}
                      />
                      <ul className="max-h-56 overflow-y-auto rounded-lg border border-[var(--border)]">
                        {filteredClients.map((c) => (
                          <li key={c.id}>
                            <button
                              type="button"
                              onClick={() => {
                                setClientId(c.id)
                                setClientName(clientDisplayName(c))
                                setZoneId(c.zoneId ?? '')
                                setStreet(c.street || '')
                                setCity(c.city || '')
                              }}
                              className={[
                                'flex w-full px-3 py-2 text-left text-sm hover:bg-[var(--bg)]',
                                clientId === c.id
                                  ? 'bg-[var(--accent)]/10 text-[var(--accent)]'
                                  : '',
                              ].join(' ')}
                            >
                              {clientDisplayName(c)}
                            </button>
                          </li>
                        ))}
                      </ul>
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
                      className={field}
                      value={serviceName}
                      onChange={(e) => setServiceName(e.target.value)}
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="mb-1 block text-[var(--text-muted)]">
                      Plan
                    </span>
                    <select
                      className={field}
                      value={servicePlanId}
                      onChange={(e) => setServicePlanId(e.target.value)}
                    >
                      <option value="">Seleccionar…</option>
                      {plans.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              )}

              {step === 3 && (
                <div className="space-y-3 text-sm">
                  <p className="text-[var(--text-muted)]">
                    Se reconfigurará la red de esta ONU hacia el destino del
                    segmento y se verificará que quede navegando.
                  </p>
                  <dl className="grid gap-2 rounded-lg border border-[var(--border)] bg-[var(--bg)]/40 p-3 sm:grid-cols-2">
                    <div>
                      <dt className="text-[11px] text-[var(--text-muted)]">
                        VLAN origen
                      </dt>
                      <dd>
                        {segment.sourceVlan != null
                          ? segment.sourceVlan
                          : candidate.vlans.join(', ') ||
                            candidate.vlan ||
                            '—'}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[11px] text-[var(--text-muted)]">
                        Destino mgmt
                      </dt>
                      <dd>VLAN {segment.mgmtVlanId}</dd>
                    </div>
                    <div>
                      <dt className="text-[11px] text-[var(--text-muted)]">
                        Destino WAN
                      </dt>
                      <dd>VLAN {segment.wanVlanId}</dd>
                    </div>
                    <div>
                      <dt className="text-[11px] text-[var(--text-muted)]">
                        TR069
                      </dt>
                      <dd>{segment.tr069ProfileId ? 'Perfil seleccionado' : '—'}</dd>
                    </div>
                    <div className="sm:col-span-2">
                      <dt className="text-[11px] text-[var(--text-muted)]">
                        Cliente / servicio
                      </dt>
                      <dd>
                        {clientMode === 'existing'
                          ? clientName
                          : [firstName, lastName].filter(Boolean).join(' ')}{' '}
                        · {serviceName}
                      </dd>
                    </div>
                  </dl>
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border)] px-5 py-3">
              <button
                type="button"
                onClick={onPause}
                className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm"
              >
                Pausar
              </button>
              <div className="flex gap-2">
                {step > 1 && (
                  <button
                    type="button"
                    onClick={() => {
                      setError(null)
                      setStep((s) => s - 1)
                    }}
                    className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm"
                  >
                    Atrás
                  </button>
                )}
                {step < 3 ? (
                  <button
                    type="button"
                    onClick={() => {
                      setError(null)
                      if (step === 1) {
                        const e = validateClient()
                        if (e) {
                          setError(e)
                          return
                        }
                      }
                      if (step === 2) {
                        const e = validateService()
                        if (e) {
                          setError(e)
                          return
                        }
                      }
                      setStep((s) => s + 1)
                    }}
                    className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white"
                  >
                    Siguiente
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void startMigration()}
                    className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white"
                  >
                    Migrar ahora
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </ModalPortal>

      <OperationProgressModal
        open={progressOpen}
        title={`Migrando ${candidate.onuIf}`}
        steps={progressSteps}
        running={progressRunning}
        failed={progressFailed}
        allDone={progressDone}
        onRetry={() => void startMigration()}
        onClose={() => {
          setProgressOpen(false)
          if (progressDone) {
            onMigrated(candidate.onuIf)
          }
        }}
      >
        {progressDone ? (
          <p className="text-sm text-emerald-400">
            Migración OK. Cerrar para continuar con la siguiente ONU del
            segmento.
          </p>
        ) : null}
      </OperationProgressModal>
    </>
  )
}

