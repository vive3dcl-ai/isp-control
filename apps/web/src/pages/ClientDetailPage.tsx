import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthContext'
import { apiFetch } from '../lib/api'
import {
  canWriteCrm,
  canonicalServiceLabel,
  clientDisplayName,
  serviceStatusLabel,
  type Client,
  type ClientDetail,
  type ClientService,
  type ClientServiceStatus,
} from '../lib/crm'
import {
  formatSignal,
  signalBand,
  type ConnectedOnu,
  type ConnectedOnusResponse,
} from '../lib/onu-connected'
import { useMoney } from '../lib/currency'
import { PanelShell } from '../components/PanelShell'
import { ClientFormModal } from '../components/ClientFormModal'
import { ClientServiceFormModal } from '../components/ClientServiceFormModal'
import { NewServiceWizardModal } from '../components/NewServiceWizardModal'
import { ServiceOnuViewModal } from '../components/ServiceOnuViewModal'
import { ClientInvoicesSection } from '../components/ClientInvoicesSection'
import { GoogleMapsCoords } from '../components/GoogleMapsCoords'
import { LocationPickerMap } from '../components/LocationPickerMap'
import { useNotify } from '../components/NotifyProvider'

export function ClientDetailPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const canWrite = canWriteCrm(user?.tenantRole)
  const { confirm, alert } = useNotify()
  const queryClient = useQueryClient()
  const money = useMoney()
  const [editOpen, setEditOpen] = useState(false)
  const [serviceOpen, setServiceOpen] = useState(false)
  const [editService, setEditService] = useState<ClientService | null>(null)
  const [viewOnuService, setViewOnuService] = useState<ClientService | null>(
    null,
  )

  const clientQuery = useQuery({
    queryKey: ['app', 'clients', id],
    queryFn: () => apiFetch<ClientDetail>(`/app/clients/${id}`),
    enabled: !!id,
  })

  const portalStatusQuery = useQuery({
    queryKey: ['app', 'client-portal', id],
    queryFn: () =>
      apiFetch<
        | { linked: false }
        | {
            linked: true
            status: string
            email: string
            archivedAt: string | null
          }
      >(`/app/client-portal/clients/${id}`),
    enabled: !!id,
  })

  const inviteMutation = useMutation({
    mutationFn: () =>
      apiFetch<{ ok: boolean; sent?: boolean }>(
        `/app/client-portal/clients/${id}/invite`,
        { method: 'POST' },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ['app', 'client-portal', id],
      })
      void alert('Invitación enviada al correo del cliente')
    },
    onError: (err: Error) => void alert(err.message),
  })

  const onusQuery = useQuery({
    queryKey: ['app', 'onus'],
    queryFn: () => apiFetch<ConnectedOnusResponse>('/app/onus'),
    staleTime: 30_000,
  })

  const onuById = useMemo(() => {
    const map = new Map<string, ConnectedOnu>()
    for (const o of onusQuery.data?.onus ?? []) map.set(o.id, o)
    return map
  }, [onusQuery.data?.onus])

  const actionMutation = useMutation({
    mutationFn: ({
      serviceId,
      action,
    }: {
      serviceId: string
      action: 'suspend' | 'end' | 'activate'
    }) =>
      apiFetch(`/app/client-services/${serviceId}/${action}`, {
        method: 'POST',
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['app', 'clients', id] })
      void queryClient.invalidateQueries({ queryKey: ['app', 'dashboard'] })
    },
  })

  const reconcileMutation = useMutation({
    mutationFn: ({
      serviceId,
      removeOnu,
    }: {
      serviceId: string
      removeOnu?: boolean
    }) =>
      apiFetch(`/app/client-services/${serviceId}/reconcile-olt`, {
        method: 'POST',
        body: JSON.stringify({ removeOnu: !!removeOnu }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['app', 'clients', id] })
      void queryClient.invalidateQueries({ queryKey: ['app', 'onus'] })
      void queryClient.invalidateQueries({ queryKey: ['app', 'dashboard'] })
    },
    onError: (err: Error) => void alert(err.message),
  })

  const syncOnuNameMutation = useMutation({
    mutationFn: (serviceId: string) =>
      apiFetch<{ ok: boolean; name?: string; message?: string }>(
        `/app/client-services/${serviceId}/sync-onu-name`,
        { method: 'POST' },
      ),
    onSuccess: (res) => {
      void queryClient.invalidateQueries({ queryKey: ['app', 'clients', id] })
      void queryClient.invalidateQueries({ queryKey: ['app', 'onus'] })
      void alert(res.message || 'Nombre ONU sincronizado')
    },
    onError: (err: Error) => void alert(err.message),
  })

  const archiveMutation = useMutation({
    mutationFn: (isActive: boolean) =>
      apiFetch<Client>(`/app/clients/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive }),
      }),
    onSuccess: (updated) => {
      void queryClient.invalidateQueries({ queryKey: ['app', 'clients'] })
      void queryClient.invalidateQueries({ queryKey: ['app', 'dashboard'] })
      queryClient.setQueryData<ClientDetail>(
        ['app', 'clients', id],
        (current) =>
          current ? { ...current, isActive: updated.isActive } : current,
      )
      if (!updated.isActive) navigate('/app/clients')
    },
  })

  const client = clientQuery.data

  return (
    <PanelShell
      title={client ? clientDisplayName(client) : 'Cliente'}
      subtitle="Ficha y contratos"
      variant="tenant"
    >
      <div className="mb-4">
        <Link
          to="/app/clients"
          className="text-sm text-[var(--accent)] hover:underline"
        >
          ← Volver a clientes
        </Link>
      </div>

      {clientQuery.error && (
        <p className="mb-4 text-sm text-[var(--danger)]">
          {clientQuery.error.message}
        </p>
      )}
      {clientQuery.isLoading && (
        <p className="text-[var(--text-muted)]">Cargando…</p>
      )}

      {client && (
        <>
          <div className="mb-8 space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--bg)] px-5 py-4">
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="truncate text-lg font-semibold">
                    {clientDisplayName(client)}
                  </h2>
                  <ClientStatusBadge client={client} />
                </div>
                {(client.firstName || client.lastName) && client.companyName && (
                  <p className="text-sm text-[var(--text-muted)]">
                    {[client.firstName, client.lastName]
                      .filter(Boolean)
                      .join(' ')}{' '}
                    · {client.companyName}
                  </p>
                )}
              </div>
              {canWrite && (
                <div className="flex shrink-0 flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setEditOpen(true)}
                    className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm hover:border-[var(--accent)] hover:text-[var(--accent)]"
                  >
                    Editar
                  </button>
                  {!client.isLead && client.isActive && client.email && (
                    <button
                      type="button"
                      disabled={inviteMutation.isPending}
                      onClick={() => inviteMutation.mutate()}
                      className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-60"
                    >
                      {inviteMutation.isPending
                        ? 'Enviando…'
                        : portalStatusQuery.data?.linked
                          ? 'Reenviar invitación portal'
                          : 'Invitar al portal'}
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={archiveMutation.isPending}
                    onClick={() => {
                      if (!client.isActive) {
                        archiveMutation.mutate(true)
                        return
                      }
                      void confirm(
                        `¿Archivar a ${clientDisplayName(client)}? Ya no aparecerá en la lista principal.`,
                        {
                          title: 'Archivar cliente',
                          confirmLabel: 'Archivar',
                        },
                      ).then((ok) => {
                        if (ok) archiveMutation.mutate(false)
                      })
                    }}
                    className="rounded-lg border border-amber-500/50 px-3 py-1.5 text-sm text-amber-300 hover:bg-amber-500/10 disabled:opacity-60"
                  >
                    {client.isActive ? 'Archivar' : 'Restaurar'}
                  </button>
                </div>
              )}
            </div>
            {portalStatusQuery.data?.linked && (
              <p className="text-xs text-[var(--text-muted)]">
                Portal:{' '}
                <span className="text-[var(--text)]">
                  {portalStatusQuery.data.status}
                </span>
                {portalStatusQuery.data.email
                  ? ` · ${portalStatusQuery.data.email}`
                  : ''}
              </p>
            )}

            <div className="grid gap-4 lg:grid-cols-2 lg:items-stretch">
              <section className="rounded-xl border border-[var(--border)] bg-[var(--bg)] p-5">
                <h3 className="mb-3 text-sm font-semibold">Contacto</h3>
                  <dl className="grid gap-x-4 gap-y-3 text-sm sm:grid-cols-2">
                  <Field label="Email" value={client.email} />
                  <Field label="Teléfono" value={client.phone} />
                  <Field
                    label="Nombre"
                    value={[client.firstName, client.lastName]
                      .filter(Boolean)
                      .join(' ')}
                  />
                  <Field
                    label={client.documentType || 'Documento'}
                    value={client.documentNumber}
                  />
                  <ClientZoneField zoneId={client.zoneId} />
                  {(client.isCompany || client.companyName) && (
                    <>
                      <Field label="Empresa" value={client.companyName} />
                      <Field
                        label="Documento empresa"
                        value={client.companyTaxId}
                      />
                    </>
                  )}
                </dl>
              </section>

              <section className="grid gap-4 rounded-xl border border-[var(--border)] bg-[var(--bg)] p-5 sm:grid-cols-[minmax(11rem,0.7fr)_minmax(16rem,1.3fr)] sm:items-stretch">
                <div className="min-w-0">
                  <h3 className="mb-3 text-sm font-semibold">Dirección</h3>
                  <dl className="grid content-start gap-3 text-sm">
                    <Field label="Dirección" value={client.street} />
                    <Field label="Ciudad" value={client.city} />
                  </dl>
                  {client.latitude != null && client.longitude != null && (
                    <GoogleMapsCoords
                      className="mt-3"
                      lat={client.latitude}
                      lng={client.longitude}
                    />
                  )}
                </div>
                <div className="min-h-[10rem] w-full min-w-0 overflow-hidden rounded-lg border border-[var(--border)]">
                  {client.latitude != null && client.longitude != null ? (
                    <LocationPickerMap
                      lat={client.latitude}
                      lng={client.longitude}
                      readOnly
                      className="h-full min-h-[10rem] w-full"
                    />
                  ) : (
                    <div className="flex h-full min-h-[10rem] items-center justify-center bg-[var(--bg-elevated)] px-2 text-center text-[11px] leading-snug text-[var(--text-muted)]">
                      Sin ubicación
                    </div>
                  )}
                </div>
              </section>
            </div>

            {client.note && (
              <section className="rounded-xl border border-[var(--border)] bg-[var(--bg)] p-5">
                <h3 className="mb-2 text-sm font-semibold">Nota</h3>
                <p className="whitespace-pre-wrap text-sm text-[var(--text-muted)]">
                  {client.note}
                </p>
              </section>
            )}
          </div>

          <div className="mb-4 flex items-center justify-between gap-3">
            <h3 className="text-base font-semibold">Servicios / contratos</h3>
            {canWrite && (
              <button
                type="button"
                onClick={() => setServiceOpen(true)}
                className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-white hover:bg-[var(--accent-hover)]"
              >
                Nuevo servicio
              </button>
            )}
          </div>
          {actionMutation.error && (
            <p className="mb-3 text-sm text-[var(--danger)]">
              {actionMutation.error.message}
            </p>
          )}

          <div className="overflow-x-auto overflow-hidden rounded-xl border border-[var(--border)]">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="bg-[var(--bg)] text-[var(--text-muted)]">
                <tr>
                  <th className="px-4 py-3 font-medium">Servicio</th>
                  <th className="px-4 py-3 font-medium">Plan</th>
                  <th className="px-4 py-3 font-medium">Precio</th>
                  <th className="px-4 py-3 font-medium">Desde</th>
                  <th className="px-4 py-3 font-medium">Estado</th>
                  <th className="w-0 whitespace-nowrap px-4 py-3 text-right font-medium">
                    Acciones
                  </th>
                </tr>
              </thead>
              <tbody>
                {client.services.length === 0 && (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-4 py-6 text-[var(--text-muted)]"
                    >
                      Sin servicios. Asigna un plan para crear un contrato.
                    </td>
                  </tr>
                )}
                {client.services.map((s) => {
                  const linkedOnu = s.onuId ? onuById.get(s.onuId) : undefined
                  const canSyncOnuName =
                    !!client.migratedAt &&
                    !!s.migratedAt &&
                    !s.onuNameSyncedAt &&
                    !!s.onuId
                  return (
                    <tr key={s.id} className="border-t border-[var(--border)]">
                      <td className="px-4 py-3">
                        <div className="font-medium">{s.name}</div>
                        {(s.street || s.city) && (
                          <div className="text-xs text-[var(--text-muted)]">
                            {[s.street, s.city].filter(Boolean).join(', ')}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {s.servicePlan?.name ?? '—'}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {money(s.price)}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {s.activeFrom ?? '—'}
                      </td>
                      <td className="px-4 py-3">
                        <div className="inline-flex items-center gap-2">
                          <span>
                            {serviceStatusLabel[
                              s.status as ClientServiceStatus
                            ] ?? s.status}
                          </span>
                          {s.serviceState?.canonical &&
                          s.serviceState.canonical !== s.status ? (
                            <span className="text-[10px] text-[var(--text-muted)]">
                              (
                              {canonicalServiceLabel[s.serviceState.canonical]})
                            </span>
                          ) : null}
                          {s.serviceState?.drift ? (
                            <span
                              className="rounded-full border border-[var(--danger)] px-2 py-0.5 text-[10px] text-[var(--danger)]"
                              title={s.serviceState.drift.message}
                            >
                              Desvío
                            </span>
                          ) : null}
                          {s.onuId ? (
                            <ServiceSignalIcon onu={linkedOnu} />
                          ) : null}
                        </div>
                      </td>
                      <td className="w-0 whitespace-nowrap px-4 py-3 text-right">
                        {canWrite && (
                          <div className="inline-flex flex-nowrap justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => setEditService(s)}
                              className="rounded-md border border-[var(--border)] px-2.5 py-1 text-xs hover:border-[var(--accent)] hover:text-[var(--accent)]"
                            >
                              Editar
                            </button>
                            {canSyncOnuName && (
                              <button
                                type="button"
                                disabled={syncOnuNameMutation.isPending}
                                title="Actualiza el name de la ONU en la OLT con Cliente + Servicio"
                                onClick={() =>
                                  syncOnuNameMutation.mutate(s.id)
                                }
                                className="rounded-md border border-[var(--border)] px-2.5 py-1 text-xs hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-60"
                              >
                                {syncOnuNameMutation.isPending &&
                                syncOnuNameMutation.variables === s.id
                                  ? 'Sincronizando…'
                                  : 'Sincronizar'}
                              </button>
                            )}
                            {s.onuId && (
                              <button
                                type="button"
                                onClick={() => setViewOnuService(s)}
                                className="rounded-md bg-[var(--accent)] px-2.5 py-1 text-xs font-medium text-white hover:bg-[var(--accent-hover)]"
                              >
                                Ver ONU
                              </button>
                            )}
                            {s.status !== 'ended' && s.status !== 'active' && (
                              <button
                                type="button"
                                disabled={actionMutation.isPending}
                                onClick={() =>
                                  actionMutation.mutate({
                                    serviceId: s.id,
                                    action: 'activate',
                                  })
                                }
                                className="rounded-md border border-[var(--border)] px-2.5 py-1 text-xs hover:border-[var(--success)] hover:text-[var(--success)]"
                              >
                                Activar
                              </button>
                            )}
                            {s.status === 'active' && (
                              <button
                                type="button"
                                disabled={actionMutation.isPending}
                                onClick={() =>
                                  actionMutation.mutate({
                                    serviceId: s.id,
                                    action: 'suspend',
                                  })
                                }
                                className="rounded-md border border-[var(--border)] px-2.5 py-1 text-xs hover:border-[var(--accent)] hover:text-[var(--accent)]"
                              >
                                Suspender
                              </button>
                            )}
                            {s.serviceState?.drift && (
                              <button
                                type="button"
                                disabled={reconcileMutation.isPending}
                                onClick={() => {
                                  const removeOnu =
                                    s.serviceState?.drift?.code ===
                                    'crm_ended_onu_present'
                                  const run = () =>
                                    reconcileMutation.mutate({
                                      serviceId: s.id,
                                      removeOnu,
                                    })
                                  if (!removeOnu) {
                                    run()
                                    return
                                  }
                                  void confirm(
                                    '¿Quitar la ONU de la OLT (`no onu`)? El SN volverá a Huérfanas.',
                                    {
                                      title: 'Reconciliar OLT',
                                      danger: true,
                                      confirmLabel: 'Quitar ONU',
                                    },
                                  ).then((ok) => {
                                    if (ok) run()
                                  })
                                }}
                                className="rounded-md border border-[var(--warning,var(--accent))] px-2.5 py-1 text-xs hover:border-[var(--accent)] hover:text-[var(--accent)]"
                                title={s.serviceState.drift.message}
                              >
                                Reconciliar OLT
                              </button>
                            )}
                            {s.status !== 'ended' && (
                              <button
                                type="button"
                                disabled={actionMutation.isPending}
                                onClick={() => {
                                  void confirm('¿Finalizar este servicio?', {
                                    title: 'Finalizar servicio',
                                    danger: true,
                                    confirmLabel: 'Finalizar',
                                  }).then((ok) => {
                                    if (ok) {
                                      actionMutation.mutate({
                                        serviceId: s.id,
                                        action: 'end',
                                      })
                                    }
                                  })
                                }}
                                className="rounded-md border border-[var(--border)] px-2.5 py-1 text-xs text-[var(--danger)] hover:border-[var(--danger)]"
                              >
                                Finalizar
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <ClientInvoicesSection
            clientId={client.id}
            clientEmail={client.email}
            canWrite={canWrite}
          />

          <ClientFormModal
            open={editOpen}
            client={client}
            onClose={() => setEditOpen(false)}
          />
          <NewServiceWizardModal
            open={serviceOpen}
            clientId={client.id}
            clientName={
              [client.firstName, client.lastName].filter(Boolean).join(' ').trim() ||
              client.companyName ||
              clientDisplayName(client)
            }
            client={client}
            onClose={() => setServiceOpen(false)}
          />
          <ClientServiceFormModal
            open={!!editService}
            clientId={client.id}
            clientName={
              [client.firstName, client.lastName].filter(Boolean).join(' ').trim() ||
              client.companyName ||
              clientDisplayName(client)
            }
            client={client}
            service={editService}
            onClose={() => setEditService(null)}
          />
          {viewOnuService && (
            <ServiceOnuViewModal
              open={!!viewOnuService}
              service={viewOnuService}
              canWrite={canWrite}
              onClose={() => setViewOnuService(null)}
            />
          )}
        </>
      )}
    </PanelShell>
  )
}

function Field({
  label,
  value,
  className = '',
}: {
  label: string
  value?: string | null
  className?: string
}) {
  return (
    <div className={className}>
      <dt className="text-[11px] uppercase tracking-wide text-[var(--text-muted)]">
        {label}
      </dt>
      <dd className="mt-0.5 break-words">{value?.trim() ? value : '—'}</dd>
    </div>
  )
}

function ClientZoneField({ zoneId }: { zoneId?: string | null }) {
  const zonesQuery = useQuery({
    queryKey: ['app', 'zones'],
    queryFn: () =>
      apiFetch<Array<{ id: string; name: string }>>('/app/zones'),
    staleTime: 60_000,
  })
  const name = zoneId
    ? (zonesQuery.data?.find((z) => z.id === zoneId)?.name ?? null)
    : null
  return <Field label="Zona" value={name} />
}

function ClientStatusBadge({ client }: { client: Client }) {
  if (client.isLead) {
    return (
      <span className="inline-flex rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-300">
        Lead
      </span>
    )
  }
  if (client.isActive) {
    return (
      <span className="inline-flex rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-300">
        Activo
      </span>
    )
  }
  return (
    <span className="inline-flex rounded-full bg-zinc-500/15 px-2 py-0.5 text-xs font-medium text-zinc-400">
      Archivado
    </span>
  )
}

/** Barras de señal con colores del mapa de calor (topología). */
function ServiceSignalIcon({ onu }: { onu?: ConnectedOnu }) {
  if (!onu) {
    return (
      <span
        className="inline-flex h-6 w-6 items-center justify-center rounded-md text-[var(--text-muted)]"
        title="Señal no disponible"
      >
        <SignalBars level={1} />
      </span>
    )
  }

  if (!onu.online) {
    return (
      <span
        className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-slate-500/15 text-slate-400"
        title={`Offline · ${formatSignal(onu.signalDbm)}`}
      >
        <SignalBars level={1} />
      </span>
    )
  }

  const band = signalBand(onu.signalDbm)
  const level: 1 | 2 | 3 =
    band === 'good' ? 3 : band === 'fair' ? 2 : band === 'poor' ? 1 : 1
  const style =
    band === 'good'
      ? 'bg-emerald-500/15 text-emerald-400'
      : band === 'fair'
        ? 'bg-amber-500/15 text-amber-400'
        : band === 'poor'
          ? 'bg-red-500/15 text-red-400'
          : 'bg-sky-500/15 text-sky-400'
  const label =
    band === 'good'
      ? 'Buena'
      : band === 'fair'
        ? 'Media'
        : band === 'poor'
          ? 'Mala'
          : 'Sin dato'

  return (
    <span
      className={`inline-flex h-6 w-6 items-center justify-center rounded-md ${style}`}
      title={`Señal ${label} · ${formatSignal(onu.signalDbm)}`}
    >
      <SignalBars level={level} />
    </span>
  )
}

function SignalBars({ level }: { level: 1 | 2 | 3 }) {
  return (
    <span className="inline-flex h-3.5 items-end gap-0.5" aria-hidden>
      {[1, 2, 3].map((n) => (
        <span
          key={n}
          className={[
            'w-1 rounded-sm bg-current',
            n === 1 ? 'h-1.5' : n === 2 ? 'h-2.5' : 'h-3.5',
            n <= level ? 'opacity-100' : 'opacity-25',
          ].join(' ')}
        />
      ))}
    </span>
  )
}
