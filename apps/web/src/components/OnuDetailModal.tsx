import type { ReactNode } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'
import { useAuth } from '../auth/AuthContext'
import { findNapForClient, loadMapDrafts } from '../lib/map-elements'
import type { NetworkMapLocations } from '../lib/network-map'
import { canonicalServiceLabel } from '../lib/crm'
import {
  formatSignal,
  type ConnectedOnuDetailResponse,
  type OnuCliReportResponse,
  type OnuMetricsResponse,
  type OnuRunningConfigResponse,
  type OnuSwInfoResponse,
} from '../lib/onu-connected'
import { runOnuApplyAndVerify } from '../lib/onu-apply-verify-progress'
import {
  MetricWindowPicker,
  SignalChart,
  TrafficChart,
  type MetricWindowKey,
} from './OnuMetricCharts'
import { OnuCliReportModal } from './OnuCliReportModal'
import { OnuLiveTrafficModal } from './OnuLiveTrafficModal'
import { OnuTr069ConfigModal } from './OnuTr069ConfigModal'
import { OnuVlansModal } from './OnuVlansModal'
import { OnuManualModal } from './OnuManualModal'
import {
  OperationProgressModal,
  runProgressSteps,
  type ProgressStep,
} from './OperationProgressModal'
import { OnuProvisionProgressModal } from './OnuProvisionProgressModal'
import type { Tr069OnuConfig } from '../lib/onu-tr069-config'
import type { Tr069ProfilesResponse } from '../lib/tr069'
import type { Zone } from './ZonasSettingsTab'
import { useNotify } from './NotifyProvider'
import { ModalPortal } from './ModalPortal'
import {
  DesktopTableWrap,
  MobileList,
  MobileListCard,
  MobileListMeta,
} from './MobileList'

function pendingBtn(label: string) {
  return (
    <button
      type="button"
      disabled
      title="Pendiente"
      className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm opacity-50"
    >
      {label}
    </button>
  )
}

function auditActionLabel(action: string): string {
  const map: Record<string, string> = {
    authorize: 'Autorizar',
    deny: 'Denegar',
    reboot: 'Reboot',
    disable: 'Suspender',
    enable: 'Habilitar',
    delete_onu: 'Borrar ONU',
    apply_wan: 'Aplicar WAN',
    acs_wan: 'WAN ACS',
    dba_heal: 'Heal DBA',
    resync: 'Resync',
  }
  return map[action] ?? action
}

function isUuid(id: string | undefined): id is string {
  return !!id && /^[0-9a-f-]{36}$/i.test(id)
}

function verifyTooltip(detail: Record<string, unknown> | undefined): string {
  if (!detail || typeof detail !== 'object') return ''
  const parts: string[] = []
  for (const key of ['arp', 'connreq', 'wan', 'dns', 'route', 'uplinkVlan', 'lanBind', 'traffic'] as const) {
    const c = detail[key] as { ok?: boolean; message?: string } | undefined
    if (!c?.message) continue
    parts.push(`${key}: ${c.ok ? 'ok' : 'fail'} (${c.message})`)
  }
  const healed = detail.healed
  if (Array.isArray(healed) && healed.length) {
    parts.push(`curado: ${healed.join('; ')}`)
  }
  return parts.join(' · ')
}

function VerifyStatusPill({
  status,
  detail,
  showIdle,
  onOpenProgress,
}: {
  status: 'idle' | 'test' | 'ok' | 'fail' | 'check' | undefined
  detail?: Record<string, unknown>
  /** Si la ONU ya está en ACS pero nunca arrancó el chequeo. */
  showIdle?: boolean
  onOpenProgress?: () => void
}) {
  if (!status || status === 'idle') {
    if (!showIdle) return null
    return (
      <span
        title="En ACS — el chequeo se arma solo; refresca si no pasa a test"
        className="rounded-full bg-[var(--border)]/60 px-2 py-0.5 text-[10px] font-medium text-[var(--text-muted)]"
      >
        pendiente
      </span>
    )
  }
  const title = verifyTooltip(detail) || undefined
  if (status === 'ok') {
    return (
      <span
        title={title}
        className="rounded-full bg-emerald-600/20 px-2 py-0.5 text-[10px] font-medium text-emerald-400"
      >
        OK
      </span>
    )
  }
  if (status === 'test') {
    return (
      <button
        type="button"
        title={title || 'Ver avance del aprovisionamiento'}
        onClick={onOpenProgress}
        className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-medium text-amber-300 hover:bg-amber-500/30"
      >
        test
      </button>
    )
  }
  if (status === 'check') {
    return (
      <span
        title={title || 'Revisar plan / DBA'}
        className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-medium text-amber-400"
      >
        CHECK
      </span>
    )
  }
  return (
    <span
      title={title || 'Chequeo fallido — usa Resync config'}
      className="rounded-full bg-red-600/20 px-2 py-0.5 text-[10px] font-medium text-red-400"
    >
      fail
    </span>
  )
}

export function OnuDetailModal({
  oltId,
  onuIf,
  canWrite,
  onClose,
  onRebooted,
  embedded = false,
}: {
  oltId: string
  onuIf: string
  canWrite: boolean
  onClose: () => void
  onRebooted?: () => void
  /** Renderiza el contenido sin portal/backdrop (panel del Asistente). */
  embedded?: boolean
}) {
  const queryClient = useQueryClient()
  const { confirm } = useNotify()
  const [cliModal, setCliModal] = useState<{
    kind: 'status' | 'config' | 'sw'
    title: string
    body: string
  } | null>(null)
  const [cliLoading, setCliLoading] = useState(false)
  const [cliError, setCliError] = useState<string | null>(null)
  const [liveOpen, setLiveOpen] = useState(false)
  const [tr069ConfigOpen, setTr069ConfigOpen] = useState(false)
  const [vlansModalOpen, setVlansModalOpen] = useState(false)
  const [manualModalOpen, setManualModalOpen] = useState(false)
  const [descModalOpen, setDescModalOpen] = useState(false)
  const [descDraft, setDescDraft] = useState('')
  const [zoneModalOpen, setZoneModalOpen] = useState(false)
  const [zoneDraft, setZoneDraft] = useState('')
  const [tr069ProfilePick, setTr069ProfilePick] = useState('')
  /** Sticky UI state so the toggle doesn't flicker off while detail refetches. */
  const [tr069LocalOn, setTr069LocalOn] = useState<boolean | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tr069Error, setTr069Error] = useState<string | null>(null)
  const [chartWindow, setChartWindow] = useState<MetricWindowKey>('1h')
  const [resyncOpen, setResyncOpen] = useState(false)
  const [resyncSteps, setResyncSteps] = useState<ProgressStep[]>([])
  const [resyncRunning, setResyncRunning] = useState(false)
  const [resyncFailed, setResyncFailed] = useState(false)
  const [resyncDone, setResyncDone] = useState(false)
  const [resyncDriverId, setResyncDriverId] = useState<string | null>(null)
  const resyncGeneration = useRef(0)
  const [checkOpen, setCheckOpen] = useState(false)
  const [checkRunOnOpen, setCheckRunOnOpen] = useState(false)
  const [imageZoomOpen, setImageZoomOpen] = useState(false)

  const detailQuery = useQuery({
    queryKey: ['app', 'onus', 'detail', oltId, onuIf],
    queryFn: () =>
      apiFetch<ConnectedOnuDetailResponse>(
        `/app/onus/detail?oltId=${encodeURIComponent(oltId)}&onuIf=${encodeURIComponent(onuIf)}`,
      ),
    // Mientras el chequeo corre, refresca el indicador; si no, cada 3 s basta.
    refetchInterval: (q) =>
      q.state.data?.onu?.verifyStatus === 'test' ? 5_000 : 3_000,
  })

  const onuDbId = detailQuery.data?.onu?.id

  const { user } = useAuth()
  const tenantKey = user?.tenantSlug ?? user?.tenantId

  const locationsQuery = useQuery({
    queryKey: ['app', 'network-map', 'locations'],
    queryFn: () =>
      apiFetch<NetworkMapLocations>('/app/network-map/locations'),
  })

  const serviceClient = detailQuery.data?.client
  const clientLink = useMemo(() => {
    // El servicio ligado es la fuente fiable; el mapa solo trae ONUs con
    // coordenadas, así que sirve únicamente como respaldo.
    if (serviceClient) {
      return {
        clientId: serviceClient.clientId,
        label: serviceClient.label,
      }
    }
    const locs = locationsQuery.data
    if (!locs || !onuDbId) return null
    const marker = locs.onus.find((o) => o.onuId === onuDbId)
    if (!marker) return null
    const client = locs.clients.find((c) => c.clientId === marker.clientId)
    return {
      clientId: marker.clientId,
      label: client?.label ?? marker.label,
    }
  }, [serviceClient, locationsQuery.data, onuDbId])

  const napName = useMemo(() => {
    if (!clientLink) return null
    const drafts = loadMapDrafts(tenantKey)
    return findNapForClient(clientLink.clientId, drafts)?.name ?? null
  }, [clientLink, tenantKey])

  const zonesQuery = useQuery({
    queryKey: ['app', 'zones'],
    queryFn: () => apiFetch<Zone[]>('/app/zones'),
    staleTime: 60_000,
  })

  const metricsQuery = useQuery({
    queryKey: ['app', 'onus', 'metrics', onuDbId, 'live'],
    queryFn: () =>
      apiFetch<OnuMetricsResponse>(
        `/app/onus/${onuDbId}/metrics?hours=24&live=1`,
      ),
    enabled: isUuid(onuDbId),
    refetchInterval: 3_000,
    staleTime: 0,
  })

  const profilesQuery = useQuery({
    queryKey: ['app', 'settings', 'tr069', 'profiles'],
    queryFn: () =>
      apiFetch<Tr069ProfilesResponse>('/app/settings/tr069/profiles'),
    enabled: !!detailQuery.data?.onu,
  })

  const tr069AcsQuery = useQuery({
    queryKey: ['app', 'onus', onuDbId, 'tr069-config'],
    queryFn: () =>
      apiFetch<Tr069OnuConfig>(`/app/onus/${onuDbId}/tr069-config`),
    enabled:
      isUuid(onuDbId) &&
      !!(detailQuery.data?.onu?.tr069Enabled || detailQuery.data?.onu?.mgmtIp),
    refetchInterval: 20_000,
  })

  const auditQuery = useQuery({
    queryKey: ['app', 'onus', onuDbId, 'audit'],
    queryFn: () =>
      apiFetch<{
        onuId: string
        sn: string | null
        events: Array<{
          id: string
          occurredAt: string
          actorEmail: string | null
          actorKind: string
          action: string
          ok: boolean
          durationMs: number
          detail: Record<string, unknown>
        }>
      }>(`/app/onus/${onuDbId}/audit?limit=50`),
    enabled: isUuid(onuDbId),
    staleTime: 15_000,
  })

  // (El avance del script se abre con Check ONU / VLANs; no auto-abrir
  // aquí para no duplicar la modal cuando apply pone verifyStatus=test.)

  const oltProfiles = useMemo(() => {
    const oltIdForOnu = detailQuery.data?.onu?.oltId
    const all = profilesQuery.data?.profiles ?? []
    if (!oltIdForOnu) return all
    const attached = all.filter((p) => p.oltIds?.includes(oltIdForOnu))
    return attached.length ? attached : all
  }, [profilesQuery.data?.profiles, detailQuery.data?.onu?.oltId])

  useEffect(() => {
    if (tr069ProfilePick) return
    if (oltProfiles.length === 1) {
      setTr069ProfilePick(oltProfiles[0].id)
    }
  }, [oltProfiles, tr069ProfilePick])

  const statusMutation = useMutation({
    mutationFn: () =>
      apiFetch<OnuCliReportResponse>(
        `/app/onus/status?oltId=${encodeURIComponent(oltId)}&onuIf=${encodeURIComponent(onuIf)}`,
      ),
    onMutate: () => {
      setCliError(null)
      setCliLoading(true)
      setCliModal({
        kind: 'status',
        title: 'Estado ONU (SmartOLT)',
        body: '',
      })
    },
    onSuccess: (r) => {
      setCliLoading(false)
      setCliModal({
        kind: 'status',
        title: 'Estado ONU',
        body: r.report,
      })
      setMsg(null)
      setError(null)
      void detailQuery.refetch()
      void queryClient.invalidateQueries({ queryKey: ['app', 'onus'] })
    },
    onError: (e: Error) => {
      setCliLoading(false)
      setCliError(e.message)
    },
  })

  const configMutation = useMutation({
    mutationFn: async () => {
      const cached = detailQuery.data?.onu?.runningConfig
      if (cached?.trim()) {
        return {
          runningConfig: cached,
          probedAt: detailQuery.data?.probedAt ?? new Date().toISOString(),
        } as OnuRunningConfigResponse
      }
      return apiFetch<OnuRunningConfigResponse>(
        `/app/onus/running-config?oltId=${encodeURIComponent(oltId)}&onuIf=${encodeURIComponent(onuIf)}`,
      )
    },
    onMutate: () => {
      setCliError(null)
      setCliLoading(true)
      setCliModal({
        kind: 'config',
        title: 'Running-config',
        body: '',
      })
    },
    onSuccess: (r) => {
      setCliLoading(false)
      setCliModal({
        kind: 'config',
        title: 'Running-config',
        body: r.runningConfig || '(vacío)',
      })
    },
    onError: (e: Error) => {
      setCliLoading(false)
      setCliError(e.message)
    },
  })

  const swMutation = useMutation({
    mutationFn: () =>
      apiFetch<OnuSwInfoResponse>(
        `/app/onus/sw-info?oltId=${encodeURIComponent(oltId)}&onuIf=${encodeURIComponent(onuIf)}`,
      ),
    onMutate: () => {
      setCliError(null)
      setCliLoading(true)
      setCliModal({
        kind: 'sw',
        title: 'SW info',
        body: '',
      })
    },
    onSuccess: (r) => {
      setCliLoading(false)
      setCliModal({
        kind: 'sw',
        title: 'SW info · Software ONU',
        body: r.report,
      })
    },
    onError: (e: Error) => {
      setCliLoading(false)
      setCliError(e.message)
    },
  })

  const rebootMutation = useMutation({
    mutationFn: () =>
      apiFetch<{ message?: string }>('/app/onus/reboot', {
        method: 'POST',
        body: JSON.stringify({ oltId, onuIf }),
      }),
    onSuccess: (r) => {
      setMsg(r.message ?? 'Reinicio enviado')
      setError(null)
      onRebooted?.()
      void detailQuery.refetch()
      void queryClient.invalidateQueries({ queryKey: ['app', 'onus'] })
    },
    onError: (e: Error) => setError(e.message),
  })

  const disableMutation = useMutation({
    mutationFn: () =>
      apiFetch<{ message?: string }>('/app/onus/disable', {
        method: 'POST',
        body: JSON.stringify({ oltId, onuIf }),
      }),
    onSuccess: (r) => {
      setMsg(r.message ?? 'ONU deshabilitada')
      setError(null)
      void detailQuery.refetch()
      void queryClient.invalidateQueries({ queryKey: ['app', 'onus'] })
      void queryClient.invalidateQueries({ queryKey: ['app', 'onus', 'denied'] })
      void queryClient.invalidateQueries({ queryKey: ['app', 'clients'] })
      void queryClient.invalidateQueries({ queryKey: ['app', 'dashboard'] })
    },
    onError: (e: Error) => setError(e.message),
  })

  const enableMutation = useMutation({
    mutationFn: () =>
      apiFetch<{ message?: string }>('/app/onus/enable', {
        method: 'POST',
        body: JSON.stringify({ oltId, onuIf }),
      }),
    onSuccess: (r) => {
      setMsg(r.message ?? 'ONU rehabilitada')
      setError(null)
      void detailQuery.refetch()
      void queryClient.invalidateQueries({ queryKey: ['app', 'onus'] })
      void queryClient.invalidateQueries({ queryKey: ['app', 'onus', 'denied'] })
      void queryClient.invalidateQueries({ queryKey: ['app', 'clients'] })
      void queryClient.invalidateQueries({ queryKey: ['app', 'dashboard'] })
    },
    onError: (e: Error) => setError(e.message),
  })

  const deleteMutation = useMutation({
    mutationFn: () =>
      apiFetch<{ message?: string }>('/app/onus/delete', {
        method: 'POST',
        body: JSON.stringify({ oltId, onuIf }),
      }),
    onSuccess: (r) => {
      setMsg(r.message ?? 'ONU eliminada')
      setError(null)
      void queryClient.invalidateQueries({ queryKey: ['app', 'onus'] })
      void queryClient.invalidateQueries({ queryKey: ['app', 'onus', 'uncfg'] })
      void queryClient.invalidateQueries({ queryKey: ['app', 'onus', 'denied'] })
      onClose()
    },
    onError: (e: Error) => setError(e.message),
  })

  const dbaProbeMutation = useMutation({
    mutationFn: () => {
      if (!isUuid(onuDbId)) throw new Error('ONU no importada')
      return apiFetch<{
        ok: boolean
        matched: boolean
        expected: string | null
        actual: string | null
        message: string
      }>(`/app/onus/${onuDbId}/dba/probe`, { method: 'POST' })
    },
    onSuccess: (r) => {
      setMsg(r.message)
      void queryClient.invalidateQueries({
        queryKey: ['app', 'onus', 'detail', oltId, onuIf],
      })
    },
    onError: (e: Error) => setError(e.message),
  })

  const dbaApplyMutation = useMutation({
    mutationFn: () => {
      if (!isUuid(onuDbId)) throw new Error('ONU no importada')
      return apiFetch<{
        ok: boolean
        matched: boolean
        message: string
        verifyStatus?: string
      }>(`/app/onus/${onuDbId}/dba/apply`, { method: 'POST' })
    },
    onSuccess: (r) => {
      setMsg(
        `${r.message}${r.verifyStatus ? ` · Salud ${r.verifyStatus}` : ''}`,
      )
      void queryClient.invalidateQueries({ queryKey: ['app', 'onus'] })
      void queryClient.invalidateQueries({
        queryKey: ['app', 'onus', 'detail', oltId, onuIf],
      })
    },
    onError: (e: Error) => setError(e.message),
  })

  const tr069Mutation = useMutation({
    mutationFn: (args: {
      enabled: boolean
      profileId?: string
      vlanId?: number
    }) => {
      if (!isUuid(onuDbId)) {
        throw new Error('ONU no importada; no se puede activar TR069')
      }
      return apiFetch<{
        enabled: boolean
        tr069ProfileId: string | null
        tr069ProfileName: string | null
        mgmtIp: string | null
        omciOk?: boolean | null
        omciMessage?: string | null
        message?: string
      }>(`/app/onus/${onuDbId}/tr069`, {
        method: 'POST',
        body: JSON.stringify({
          enabled: args.enabled,
          profileId: args.profileId,
          vlanId: args.vlanId,
        }),
      })
    },
    onSuccess: (r) => {
      setTr069LocalOn(r.enabled)
      setTr069Error(
        r.enabled && r.omciOk === false
          ? r.omciMessage || r.message || 'OMCI falló'
          : null,
      )
      setMsg(r.message ?? (r.enabled ? 'TR069 activo' : 'TR069 desactivado'))
      void detailQuery.refetch()
      void queryClient.invalidateQueries({
        queryKey: ['app', 'onus', onuDbId, 'tr069-config'],
      })
      void queryClient.invalidateQueries({
        queryKey: ['app', 'settings', 'ip-pools'],
      })
    },
    onError: (e: Error) => {
      setTr069Error(e.message)
      setTr069LocalOn(null)
    },
  })

  const descMutation = useMutation({
    mutationFn: (description: string) => {
      if (!isUuid(onuDbId)) throw new Error('ONU sin ID local')
      return apiFetch<{
        ok: boolean
        message?: string
        description: string | null
      }>(`/app/onus/${onuDbId}/description`, {
        method: 'PATCH',
        body: JSON.stringify({ description }),
      })
    },
    onSuccess: (r) => {
      setMsg(r.message || 'Dirección / comentario actualizado')
      setDescModalOpen(false)
      void detailQuery.refetch()
      void queryClient.invalidateQueries({ queryKey: ['app', 'onus'] })
    },
    onError: (e: Error) => setError(e.message),
  })

  const zoneMutation = useMutation({
    mutationFn: (zoneId: string | null) => {
      if (!isUuid(onuDbId)) throw new Error('ONU sin ID local')
      return apiFetch<{
        ok: boolean
        message?: string
        zone: string | null
        zoneId: string | null
      }>(`/app/onus/${onuDbId}/zone`, {
        method: 'PATCH',
        body: JSON.stringify({ zoneId }),
      })
    },
    onSuccess: async (r) => {
      setMsg(r.message || 'Zona actualizada')
      setZoneModalOpen(false)
      // Si hay cliente vinculado, alinear su zona CRM.
      if (clientLink?.clientId) {
        try {
          await apiFetch(`/app/clients/${clientLink.clientId}`, {
            method: 'PATCH',
            body: JSON.stringify({ zoneId: r.zoneId }),
          })
          void queryClient.invalidateQueries({
            queryKey: ['app', 'clients', clientLink.clientId],
          })
          void queryClient.invalidateQueries({ queryKey: ['app', 'zones'] })
        } catch {
          /* la ONU ya quedó; el cliente se puede editar aparte */
        }
      }
      void detailQuery.refetch()
      void queryClient.invalidateQueries({ queryKey: ['app', 'onus'] })
    },
    onError: (e: Error) => setError(e.message),
  })

  const actionBusy =
    rebootMutation.isPending ||
    disableMutation.isPending ||
    enableMutation.isPending ||
    deleteMutation.isPending ||
    tr069Mutation.isPending ||
    descMutation.isPending ||
    zoneMutation.isPending

  const o = detailQuery.data?.onu
  const isAdminDisabled = /disable|disabled/i.test(o?.adminState ?? '')
  const crmServiceSuspended = serviceClient?.serviceStatus === 'suspended'
  /** Con portal la ONU puede seguir “enable” aunque el cliente esté suspendido. */
  const showEnableAccess = isAdminDisabled || crmServiceSuspended
  const tr069OnFromServer = !!(o?.tr069Enabled || o?.tr069ProfileId)
  const tr069On =
    tr069LocalOn != null ? tr069LocalOn : tr069OnFromServer
  const descText = (o?.address ?? o?.description ?? '').trim()
  const descDisplay = descText || '—'
  const descTruncated =
    descText.length > 48 ? `${descText.slice(0, 48)}…` : descDisplay
  const zoneLabel = (o?.zone ?? '').trim()
  const resolvedZoneId =
    o?.zoneId ??
    (zonesQuery.data ?? []).find(
      (z) =>
        !!zoneLabel &&
        z.name.trim().toLocaleLowerCase() === zoneLabel.toLocaleLowerCase(),
    )?.id ??
    ''

  useEffect(() => {
    if (tr069LocalOn == null) return
    if (tr069LocalOn === tr069OnFromServer) {
      setTr069LocalOn(null)
    }
  }, [tr069LocalOn, tr069OnFromServer])

  async function executeResync() {
    if (!isUuid(onuDbId) || !o) return
    const gen = ++resyncGeneration.current
    setResyncRunning(true)
    setResyncFailed(false)
    setResyncDone(false)
    setResyncDriverId(null)
    setError(null)

    const body = {
      ...(o.mgmtVlanId != null ? { mgmtVlanId: o.mgmtVlanId } : {}),
      wanVlanId: o.wanVlanId ?? null,
      ...(o.tr069ProfileId ? { tr069ProfileId: o.tr069ProfileId } : {}),
    }

    const pre: ProgressStep[] = [
      {
        id: 'model',
        label: 'Detectando modelo real en ACS (ProductClass)',
        status: 'pending',
      },
      {
        id: 'olt',
        label: 'Reaplicando VLANs en la OLT (service-port / OMCI)',
        status: 'pending',
      },
      {
        id: 'assign',
        label: 'Reasignando IPs del pool (mgmt / WAN)',
        status: 'pending',
      },
    ]
    setResyncSteps(pre)

    const preResult = await runProgressSteps(pre, setResyncSteps, {
      model: async () => {
        const r = await apiFetch<{ message?: string }>(
          `/app/onus/${onuDbId}/model/sync-acs`,
          { method: 'POST' },
        )
        return r.message || 'Modelo ACS OK'
      },
      olt: async () => {
        const r = await apiFetch<{ message?: string }>(
          `/app/onus/${onuDbId}/network-vlans/olt`,
          { method: 'POST', body: JSON.stringify(body) },
        )
        return r.message || 'OLT OK'
      },
      assign: async () => {
        const r = await apiFetch<{ message?: string }>(
          `/app/onus/${onuDbId}/network-vlans/assign`,
          { method: 'POST', body: JSON.stringify(body) },
        )
        return r.message || 'Asignación OK'
      },
    })

    if (gen !== resyncGeneration.current) return

    if (!preResult.ok) {
      setResyncRunning(false)
      setResyncFailed(true)
      return
    }

    const applyResult = await runOnuApplyAndVerify({
      onuId: onuDbId,
      body,
      headSteps: preResult.steps,
      setProgressSteps: setResyncSteps,
      setDriverId: setResyncDriverId,
      expect: {
        ...(o.mgmtVlanId != null ? { mgmtVlan: o.mgmtVlanId } : {}),
        wanVlan: o.wanVlanId ?? null,
        requireWanIp: o.wanVlanId != null,
      },
      waitMs: 120_000,
    })

    if (gen !== resyncGeneration.current) return

    void queryClient.invalidateQueries({
      queryKey: ['app', 'onus', 'detail', oltId, onuIf],
    })
    void queryClient.invalidateQueries({ queryKey: ['app', 'onus'] })
    setResyncRunning(false)
    if (applyResult.ok) {
      setResyncDone(true)
      setMsg(
        applyResult.verifyStatus === 'ok'
          ? 'Resync OK — ONU reaprovisionada'
          : 'Resync aplicado — el chequeo sigue en segundo plano',
      )
    } else {
      setResyncFailed(true)
      setError(applyResult.error || 'Resync falló')
    }
  }

  function startResync() {
    if (!isUuid(onuDbId) || !o) return
    if (o.mgmtVlanId == null && o.wanVlanId == null) {
      setError(
        'La ONU no tiene VLANs de mgmt/WAN: configúralas antes de Resync.',
      )
      return
    }
    setResyncOpen(true)
    void executeResync()
  }

  function startCheckOnu() {
    if (!isUuid(onuDbId)) return
    setCheckRunOnOpen(true)
    setCheckOpen(true)
  }

  const imageSrc =
    o?.imageUrl ||
    (o?.onuType?.toLowerCase().includes('huawei')
      ? '/onu/huawei-hgu.svg'
      : '/onu/zte-hgu.svg')

  const signalSamples = (metricsQuery.data?.samples ?? []).filter(
    (s) => s.kind === 'signal',
  )
  const downloadSamples = (metricsQuery.data?.samples ?? []).filter(
    (s) => s.kind === 'rx_bps',
  )
  const uploadSamples = (metricsQuery.data?.samples ?? []).filter(
    (s) => s.kind === 'tx_bps',
  )

  const panelClass = embedded
    ? 'flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden bg-[var(--bg-elevated)]'
    : 'flex h-[100dvh] max-h-[100dvh] w-full max-w-4xl flex-col overflow-hidden rounded-none border-0 sm:h-auto sm:max-h-[min(92dvh,920px)] sm:rounded-xl sm:border border-[var(--border)] bg-[var(--bg-elevated)] shadow-xl'

  const panel = (
      <div className={panelClass}>
        {!embedded && (
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[var(--border)] px-4 py-3 sm:px-5">
          <h3 className="min-w-0 truncate text-lg font-semibold">ONU · {onuIf}</h3>
          <button
            type="button"
            className="shrink-0 rounded-md px-2 py-1 text-[var(--text-muted)] hover:bg-[var(--bg)]"
            onClick={onClose}
          >
            ✕
          </button>
        </div>
        )}

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-4 py-4 text-sm sm:px-5">
          {detailQuery.isLoading && (
            <p className="text-[var(--text-muted)]">Cargando detalle…</p>
          )}
          {detailQuery.error && (
            <p className="text-[var(--danger)]">
              {(detailQuery.error as Error).message}
            </p>
          )}
          {error && <p className="text-[var(--danger)]">{error}</p>}
          {msg && <p className="text-emerald-500">{msg}</p>}

          {o && (
            <>
              <div className="relative">
                <dl className="space-y-1.5 text-sm md:w-[calc(50%-0.5rem)]">
                  <Row label="OLT" value={o.oltName} />
                  <Row label="Board" value={o.board} />
                  <Row label="Port" value={o.port} />
                  <Row label="ONU" value={o.onuIf} />
                  <Row
                    label="Canal"
                    value={o.ponType?.toUpperCase() ?? '—'}
                  />
                  <Row label="SN" value={o.sn ?? '—'} mono />
                  <Row label="Tipo ONU" value={o.onuType ?? '—'} />
                  <div className="flex gap-2">
                    <dt className="w-40 shrink-0 text-[var(--text-muted)]">
                      Zona
                    </dt>
                    <dd className="min-w-0 flex-1">
                      <button
                        type="button"
                        title={zoneLabel || 'Asignar zona'}
                        onClick={() => {
                          setZoneDraft(resolvedZoneId)
                          setZoneModalOpen(true)
                          setError(null)
                        }}
                        className={[
                          'block w-full truncate text-left hover:underline',
                          zoneLabel
                            ? canWrite
                              ? 'text-[var(--accent)]'
                              : ''
                            : 'text-[var(--text-muted)]',
                        ].join(' ')}
                      >
                        {zoneLabel || 'Pendiente'}
                      </button>
                    </dd>
                  </div>
                  <Row label="NAP" value={napName ?? 'Pendiente'} muted />
                  <Row label="Nombre" value={o.name ?? '—'} />
                  <div className="flex gap-2">
                    <dt className="w-40 shrink-0 text-[var(--text-muted)]">
                      Dirección / comentario
                    </dt>
                    <dd className="min-w-0 flex-1">
                      <button
                        type="button"
                        title={descText || 'Editar dirección / comentario'}
                        onClick={() => {
                          setDescDraft(descText)
                          setDescModalOpen(true)
                          setError(null)
                        }}
                        className={[
                          'block w-full truncate text-left hover:underline',
                          descText
                            ? canWrite
                              ? 'text-[var(--accent)]'
                              : ''
                            : 'text-[var(--text-muted)]',
                          !canWrite && !descText ? '' : '',
                        ].join(' ')}
                      >
                        {descTruncated}
                      </button>
                    </dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="w-40 shrink-0 text-[var(--text-muted)]">
                      Cliente
                    </dt>
                    <dd className="min-w-0 break-all">
                      {clientLink ? (
                        <Link
                          to={`/app/clients/${clientLink.clientId}`}
                          className="text-[var(--accent)] hover:underline"
                          onClick={onClose}
                        >
                          {clientLink.label}
                        </Link>
                      ) : (
                        <span className="text-[var(--text-muted)]">
                          Sin cliente
                        </span>
                      )}
                    </dd>
                  </div>
                  {(() => {
                    const st =
                      o.serviceState ??
                      detailQuery.data?.client?.serviceState ??
                      null
                    if (!st) return null
                    return (
                      <div className="flex gap-2">
                        <dt className="w-40 shrink-0 text-[var(--text-muted)]">
                          Estado servicio
                        </dt>
                        <dd className="min-w-0">
                          {canonicalServiceLabel[st.canonical]}
                          {st.drift ? (
                            <span
                              className="mt-0.5 block text-xs text-[var(--danger)]"
                              title={st.drift.code}
                            >
                              {st.drift.message}
                            </span>
                          ) : null}
                        </dd>
                      </div>
                    )
                  })()}
                  <Row
                    label="Fecha autorización"
                    value={o.authDate ?? 'Pendiente'}
                    muted
                  />
                  <Row label="ID externo" value={o.sn ?? '—'} mono />
                </dl>

                  <div className="mt-4 flex flex-col md:absolute md:inset-y-0 md:left-[calc(50%+0.5rem)] md:right-0 md:mt-0">
                  <button
                    type="button"
                    title="Clic para ampliar"
                    onClick={() => setImageZoomOpen(true)}
                    className="flex min-h-[180px] flex-1 cursor-zoom-in items-center justify-center overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg)] p-2 md:min-h-0"
                  >
                    <img
                      src={imageSrc}
                      alt={o.onuType ?? 'ONU'}
                      className="max-h-full max-w-full object-contain"
                    />
                  </button>
                  <div className="shrink-0 space-y-1.5 pt-3">
                    <p>
                      <span className="text-[var(--text-muted)]">Estado: </span>
                      {o.online ? (
                        <span className="font-medium text-emerald-400">
                          Online
                        </span>
                      ) : (
                        <span className="font-medium text-red-400">
                          {o.phaseState || 'Offline'}
                        </span>
                      )}
                      {o.onlineDuration ? (
                        <span className="text-[var(--text-muted)]">
                          {' '}
                          · {o.onlineDuration}
                        </span>
                      ) : null}
                    </p>
                    <p>
                      <span className="text-[var(--text-muted)]">Admin: </span>
                      {isAdminDisabled ? (
                        <span className="font-medium text-amber-400">
                          disable
                        </span>
                      ) : (
                        <span className="font-medium text-emerald-400">
                          {o.adminState || 'enable'}
                        </span>
                      )}
                    </p>
                    <p>
                      <span className="text-[var(--text-muted)]">
                        ONU / OLT Rx:{' '}
                      </span>
                      {formatSignal(o.signalDbm)} /{' '}
                      {formatSignal(o.oltRxDbm)}
                      {o.distanceM != null ? (
                        <span className="text-[var(--text-muted)]">
                          {' '}
                          ({o.distanceM} m)
                        </span>
                      ) : null}
                    </p>
                    <div className="space-y-1.5">
                      <p className="flex flex-wrap items-center gap-2">
                        <span className="text-[var(--text-muted)]">
                          TR069:{' '}
                        </span>
                        {canWrite && isUuid(o.id) ? (
                          <label className="inline-flex items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              className="h-4 w-4 rounded border-[var(--border)]"
                              checked={
                                tr069Mutation.isPending
                                  ? tr069Mutation.variables?.enabled === true
                                  : tr069On
                              }
                              disabled={tr069Mutation.isPending}
                              onChange={(e) => {
                                setTr069Error(null)
                                const on = e.target.checked
                                if (!on) {
                                  setTr069LocalOn(false)
                                  void tr069Mutation.mutateAsync({
                                    enabled: false,
                                  })
                                  return
                                }
                                const profileId =
                                  tr069ProfilePick ||
                                  o.tr069ProfileId ||
                                  oltProfiles[0]?.id ||
                                  ''
                                if (!profileId) {
                                  setTr069Error(
                                    'Crea un perfil en Ajustes → TR069 y adjúntalo a esta OLT',
                                  )
                                  return
                                }
                                if (
                                  !tr069ProfilePick &&
                                  !o.tr069ProfileId &&
                                  oltProfiles.length > 1
                                ) {
                                  setTr069Error(
                                    'Elige un perfil TR069 antes de activar',
                                  )
                                  return
                                }
                                setTr069LocalOn(true)
                                void tr069Mutation.mutateAsync({
                                  enabled: true,
                                  profileId,
                                  vlanId: o.mgmtVlanId ?? undefined,
                                })
                              }}
                            />
                            <span>
                              {tr069Mutation.isPending
                                ? 'Aplicando OMCI…'
                                : tr069On
                                  ? 'Activo'
                                  : 'Inactivo'}
                            </span>
                          </label>
                        ) : (
                          <span>{tr069On ? 'Activo' : 'Inactivo'}</span>
                        )}
                        {canWrite && isUuid(o.id) && !tr069On ? (
                          <select
                            className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-xs outline-none"
                            value={tr069ProfilePick}
                            onChange={(e) =>
                              setTr069ProfilePick(e.target.value)
                            }
                            disabled={tr069Mutation.isPending}
                          >
                            <option value="">Perfil TR069…</option>
                            {oltProfiles.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name}
                              </option>
                            ))}
                          </select>
                        ) : tr069On ? (
                          <span className="text-xs text-[var(--text-muted)]">
                            Perfil:{' '}
                            <span className="text-[var(--text)]">
                              {o.tr069Profile ?? '—'}
                            </span>
                          </span>
                        ) : null}
                        {tr069AcsQuery.data?.inAcs ? (
                          <span className="rounded-full bg-emerald-600/20 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
                            ACS
                          </span>
                        ) : tr069On ? (
                          <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-medium text-amber-300">
                            Esperando Inform
                          </span>
                        ) : null}
                        <VerifyStatusPill
                          status={o.verifyStatus}
                          detail={o.verifyDetail}
                          showIdle={
                            !!tr069AcsQuery.data?.inAcs &&
                            !!o.wanIp &&
                            o.provisionMode !== 'manual'
                          }
                          onOpenProgress={() => {
                            // test/fail: disparar checker (heal) al abrir;
                            // ok/idle: solo ver progreso.
                            setCheckRunOnOpen(
                              o.verifyStatus === 'test' ||
                                o.verifyStatus === 'fail',
                            )
                            setCheckOpen(true)
                          }}
                        />
                      </p>
                      {(() => {
                        const uv = o.verifyDetail?.uplinkVlan as
                          | { ok?: boolean; message?: string }
                          | undefined
                        if (!uv || uv.ok !== false || !uv.message) return null
                        return (
                          <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-xs text-amber-200">
                            {uv.message}
                            {canWrite
                              ? ' · Resync config la agrega al uplink automáticamente'
                              : ''}
                          </p>
                        )
                      })()}
                      {tr069Error && (
                        <p className="text-xs text-[var(--danger)]">
                          {tr069Error}
                        </p>
                      )}
                    </div>
                    <p className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[var(--text-muted)]">VLANs:</span>
                      {o.mgmtVlanId != null || o.wanVlanId != null ? (
                        <>
                          {o.mgmtVlanId != null && (
                            <button
                              type="button"
                              disabled={!isUuid(o.id)}
                              title={
                                canWrite
                                  ? 'Cambiar VLANs'
                                  : 'VLAN management'
                              }
                              onClick={() =>
                                isUuid(o.id) && setVlansModalOpen(true)
                              }
                              className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-0.5 text-xs hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-50"
                            >
                              Mgmt {o.mgmtVlanId}
                            </button>
                          )}
                          {o.wanVlanId != null && (
                            <button
                              type="button"
                              disabled={!isUuid(o.id)}
                              title={canWrite ? 'Cambiar VLANs' : 'VLAN WAN'}
                              onClick={() =>
                                isUuid(o.id) && setVlansModalOpen(true)
                              }
                              className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-0.5 text-xs hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-50"
                            >
                              WAN {o.wanVlanId}
                            </button>
                          )}
                        </>
                      ) : o.vlans?.length ? (
                        o.vlans.map((v) => (
                          <button
                            key={v}
                            type="button"
                            disabled={!isUuid(o.id) || !canWrite}
                            title={
                              canWrite
                                ? 'Asignar pools management / WAN'
                                : `VLAN ${v}`
                            }
                            onClick={() =>
                              isUuid(o.id) && setVlansModalOpen(true)
                            }
                            className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-0.5 text-xs hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:cursor-default disabled:opacity-70"
                          >
                            {v}
                          </button>
                        ))
                      ) : canWrite && isUuid(o.id) ? (
                        <button
                          type="button"
                          onClick={() => setVlansModalOpen(true)}
                          className="text-xs text-[var(--accent)] hover:underline"
                        >
                          Asignar…
                        </button>
                      ) : (
                        <span>—</span>
                      )}
                      {canWrite &&
                        isUuid(o.id) &&
                        (o.mgmtVlanId != null || o.wanVlanId != null) && (
                          <button
                            type="button"
                            onClick={() => setVlansModalOpen(true)}
                            className="text-[11px] text-[var(--text-muted)] hover:text-[var(--accent)] hover:underline"
                          >
                            cambiar
                          </button>
                        )}
                    </p>
                    <p>
                      <span className="text-[var(--text-muted)]">Modo: </span>
                      {o.mode === 'router'
                        ? `Routing${o.vlan != null ? ` · WAN vlan ${o.vlan}` : ''}`
                        : o.mode === 'bridge'
                          ? 'Bridge'
                          : 'Pendiente'}
                    </p>
                    <p>
                      <span className="text-[var(--text-muted)]">
                        WAN IP:{' '}
                      </span>
                      {o.wanIp ? (
                        <span className="font-medium">{o.wanIp}</span>
                      ) : (
                        'Sin asignar'
                      )}
                    </p>
                    {o.provisionMode === 'manual' && (
                      <p className="flex flex-wrap items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-xs text-amber-200">
                        <span>⚠ ONU manual — configurar por la web de la ONU</span>
                        {isUuid(onuDbId) && (
                          <button
                            type="button"
                            onClick={() => setManualModalOpen(true)}
                            className="rounded border border-amber-500/50 px-2 py-0.5 font-medium hover:bg-amber-500/20"
                          >
                            Ver datos
                          </button>
                        )}
                      </p>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={statusMutation.isPending}
                  onClick={() => void statusMutation.mutateAsync()}
                  className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-60"
                >
                  {statusMutation.isPending
                    ? 'Obteniendo…'
                    : 'Obtener estado'}
                </button>
                {tr069AcsQuery.data?.inAcs && isUuid(o.id) ? (
                  <button
                    type="button"
                    onClick={() => setTr069ConfigOpen(true)}
                    className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-white hover:bg-[var(--accent-hover)]"
                  >
                    Configurar ONU
                  </button>
                ) : null}
                <button
                  type="button"
                  disabled={configMutation.isPending}
                  onClick={() => void configMutation.mutateAsync()}
                  className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-60"
                >
                  {configMutation.isPending
                    ? 'Cargando…'
                    : 'Ver running-config'}
                </button>
                <button
                  type="button"
                  disabled={swMutation.isPending}
                  onClick={() => void swMutation.mutateAsync()}
                  className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-60"
                >
                  {swMutation.isPending ? 'Cargando…' : 'SW info'}
                </button>
                <button
                  type="button"
                  onClick={() => setLiveOpen(true)}
                  className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-bold text-white hover:bg-red-500"
                >
                  LIVE!
                </button>
              </div>

              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-medium text-[var(--text-muted)]">
                  Ventana de las gráficas
                </p>
                <MetricWindowPicker
                  value={chartWindow}
                  onChange={setChartWindow}
                />
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-lg border border-[var(--border)] p-3">
                  <p className="mb-2 text-xs font-medium text-[var(--text-muted)]">
                    Tráfico
                  </p>
                  <TrafficChart
                    download={downloadSamples}
                    upload={uploadSamples}
                    windowKey={chartWindow}
                    liveDownloadBps={o.downloadBps}
                    liveUploadBps={o.uploadBps}
                  />
                </div>
                <div className="rounded-lg border border-[var(--border)] p-3">
                  <p className="mb-2 text-xs font-medium text-[var(--text-muted)]">
                    Señal
                  </p>
                  <SignalChart
                    samples={signalSamples}
                    windowKey={chartWindow}
                  />
                </div>
              </div>

              <Section title="Perfiles de velocidad (DBA OLT)">
                {/* Móvil: bloque apilado (1 fila); desktop: tabla */}
                <dl className="space-y-2 text-sm md:hidden">
                  <div>
                    <dt className="text-xs text-[var(--text-muted)]">Plan</dt>
                    <dd>
                      {o.speedProfile?.name ? (
                        <>
                          <div>{o.speedProfile.name}</div>
                          <div className="text-xs text-[var(--text-muted)]">
                            ↓{o.speedProfile.download ?? '—'} · ↑
                            {o.speedProfile.upload ?? '—'}
                          </div>
                        </>
                      ) : (
                        'Sin plan ligado'
                      )}
                    </dd>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <dt className="text-xs text-[var(--text-muted)]">
                        Esperado OLT
                      </dt>
                      <dd className="font-mono text-xs">
                        {o.speedProfile?.oltUpProfile ?? '—'}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-[var(--text-muted)]">
                        En OLT ahora
                      </dt>
                      <dd className="font-mono text-xs">
                        {o.speedProfile?.actualUpProfile ??
                          (o.speedProfile?.dbaMessage?.includes('—')
                            ? '— (sin leer)'
                            : '—')}
                      </dd>
                    </div>
                  </div>
                  <div>
                    <dt className="text-xs text-[var(--text-muted)]">Estado</dt>
                    <dd>
                      {o.speedProfile?.dbaOk === true ? (
                        <span className="text-emerald-400">OK</span>
                      ) : o.speedProfile?.dbaOk === false ? (
                        <span className="text-amber-400">Desviado</span>
                      ) : (
                        <span className="text-[var(--text-muted)]">
                          Sin verificar
                        </span>
                      )}
                    </dd>
                  </div>
                </dl>
                <table className="hidden w-full text-sm md:table">
                  <thead>
                    <tr className="text-[var(--text-muted)]">
                      <th className="py-1 text-left font-medium">Plan</th>
                      <th className="py-1 text-left font-medium">Esperado OLT</th>
                      <th className="py-1 text-left font-medium">En OLT ahora</th>
                      <th className="py-1 text-left font-medium">Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="py-1">
                        {o.speedProfile?.name ? (
                          <>
                            <div>{o.speedProfile.name}</div>
                            <div className="text-xs text-[var(--text-muted)]">
                              ↓{o.speedProfile.download ?? '—'} · ↑
                              {o.speedProfile.upload ?? '—'}
                            </div>
                          </>
                        ) : (
                          'Sin plan ligado'
                        )}
                      </td>
                      <td className="py-1 font-mono text-xs">
                        {o.speedProfile?.oltUpProfile ?? '—'}
                      </td>
                      <td className="py-1 font-mono text-xs">
                        {o.speedProfile?.actualUpProfile ??
                          (o.speedProfile?.dbaMessage?.includes('—')
                            ? '— (sin leer)'
                            : '—')}
                      </td>
                      <td className="py-1">
                        {o.speedProfile?.dbaOk === true ? (
                          <span className="text-emerald-400">OK</span>
                        ) : o.speedProfile?.dbaOk === false ? (
                          <span className="text-amber-400">Desviado</span>
                        ) : (
                          <span className="text-[var(--text-muted)]">
                            Sin verificar
                          </span>
                        )}
                      </td>
                    </tr>
                  </tbody>
                </table>
                {o.speedProfile?.dbaMessage ? (
                  <p className="mt-2 text-xs text-[var(--text-muted)]">
                    {o.speedProfile.dbaMessage}
                  </p>
                ) : null}
                {canWrite && isUuid(onuDbId) && o.speedProfile?.oltUpProfile ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={
                        dbaProbeMutation.isPending || dbaApplyMutation.isPending
                      }
                      onClick={() => void dbaProbeMutation.mutateAsync()}
                      className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs hover:bg-[var(--bg)] disabled:opacity-60"
                    >
                      {dbaProbeMutation.isPending
                        ? 'Leyendo OLT…'
                        : 'Leer T-CONT en OLT'}
                    </button>
                    <button
                      type="button"
                      disabled={
                        dbaApplyMutation.isPending || dbaProbeMutation.isPending
                      }
                      onClick={() => void dbaApplyMutation.mutateAsync()}
                      className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-60"
                    >
                      {dbaApplyMutation.isPending
                        ? 'Aplicando…'
                        : 'Aplicar perfil del plan'}
                    </button>
                  </div>
                ) : canWrite &&
                  isUuid(onuDbId) &&
                  o.speedProfile?.name &&
                  !o.speedProfile?.oltUpProfile ? (
                  <p className="mt-3 text-xs text-amber-300">
                    El plan está ligado al cliente, pero falta el perfil de
                    velocidad (speed profile) en el plan CRM para poder
                    aplicarlo en la OLT.
                  </p>
                ) : null}
              </Section>

              <Section title="Puertos Ethernet">
                {o.ethernetPorts.length === 0 ? (
                  <p className="text-[var(--text-muted)]">
                    Sin datos en running-config (Pendiente OMCI)
                  </p>
                ) : (
                  <>
                    <MobileList>
                      {o.ethernetPorts.map((p) => (
                        <MobileListCard key={p.port} className="py-2">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm font-semibold">
                              {p.port}
                            </span>
                            <span className="text-xs text-[var(--text-muted)]">
                              Configurar (Pendiente)
                            </span>
                          </div>
                          <MobileListMeta>
                            <span>Admin {p.adminState}</span>
                            <span>·</span>
                            <span>{p.mode}</span>
                            <span>·</span>
                            <span>DHCP {p.dhcp}</span>
                          </MobileListMeta>
                        </MobileListCard>
                      ))}
                    </MobileList>
                    <DesktopTableWrap bordered={false}>
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-[var(--text-muted)]">
                            <th className="py-1 text-left font-medium">
                              Puerto
                            </th>
                            <th className="py-1 text-left font-medium">Admin</th>
                            <th className="py-1 text-left font-medium">Modo</th>
                            <th className="py-1 text-left font-medium">DHCP</th>
                            <th className="py-1 text-left font-medium">
                              Acción
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {o.ethernetPorts.map((p) => (
                            <tr
                              key={p.port}
                              className="border-t border-[var(--border)]"
                            >
                              <td className="py-1.5">{p.port}</td>
                              <td className="py-1.5">{p.adminState}</td>
                              <td className="py-1.5">{p.mode}</td>
                              <td className="py-1.5">{p.dhcp}</td>
                              <td className="py-1.5 text-[var(--text-muted)]">
                                Configurar (Pendiente)
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </DesktopTableWrap>
                  </>
                )}
              </Section>

              <Section title="WiFi">
                {o.wifiPorts.length === 0 ? (
                  <p className="text-[var(--text-muted)]">
                    No detectado / Pendiente
                  </p>
                ) : (
                  <>
                    <MobileList>
                      {o.wifiPorts.map((p) => (
                        <MobileListCard key={p.port} className="py-2">
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <span className="rounded bg-[var(--accent)]/20 px-1.5 text-xs text-[var(--accent)]">
                                {p.band}
                              </span>
                              <p className="mt-0.5 truncate text-sm font-semibold">
                                {p.ssid || '—'}
                              </p>
                              <p className="text-[11px] text-[var(--text-muted)]">
                                {p.port}
                              </p>
                            </div>
                            <span className="shrink-0 text-xs text-[var(--text-muted)]">
                              Configurar (Pendiente)
                            </span>
                          </div>
                          <MobileListMeta>
                            <span>Admin {p.adminState}</span>
                            <span>·</span>
                            <span>{p.mode}</span>
                            <span>·</span>
                            <span>DHCP {p.dhcp}</span>
                          </MobileListMeta>
                        </MobileListCard>
                      ))}
                    </MobileList>
                    <DesktopTableWrap bordered={false}>
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-[var(--text-muted)]">
                            <th className="py-1 text-left font-medium">
                              Puerto
                            </th>
                            <th className="py-1 text-left font-medium">Admin</th>
                            <th className="py-1 text-left font-medium">Modo</th>
                            <th className="py-1 text-left font-medium">SSID</th>
                            <th className="py-1 text-left font-medium">DHCP</th>
                            <th className="py-1 text-left font-medium">
                              Acción
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {o.wifiPorts.map((p) => (
                            <tr
                              key={p.port}
                              className="border-t border-[var(--border)]"
                            >
                              <td className="py-1.5">
                                <span className="rounded bg-[var(--accent)]/20 px-1.5 text-xs text-[var(--accent)]">
                                  {p.band}
                                </span>
                                <div className="text-xs text-[var(--text-muted)]">
                                  {p.port}
                                </div>
                              </td>
                              <td className="py-1.5">{p.adminState}</td>
                              <td className="py-1.5">{p.mode}</td>
                              <td className="py-1.5">{p.ssid || '—'}</td>
                              <td className="py-1.5">{p.dhcp}</td>
                              <td className="py-1.5 text-[var(--text-muted)]">
                                Configurar (Pendiente)
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </DesktopTableWrap>
                  </>
                )}
              </Section>

              <div className="space-y-1">
                <p>
                  <span className="text-[var(--text-muted)]">
                    Servicio VoIP:{' '}
                  </span>
                  {o.voipSupported === true
                    ? 'Soportado (Pendiente estado)'
                    : o.voipSupported === false
                      ? 'Disabled'
                      : 'Pendiente'}
                </p>
                <p>
                  <span className="text-[var(--text-muted)]">CATV: </span>
                  {o.catvSupported === true
                    ? 'Soportado (Pendiente)'
                    : o.catvSupported === false
                      ? 'No soportado por tipo'
                      : 'Pendiente / no detectado'}
                </p>
              </div>

              <Section title="Historial">
                {auditQuery.isLoading ? (
                  <p className="text-xs text-[var(--text-muted)]">Cargando…</p>
                ) : (auditQuery.data?.events.length ?? 0) === 0 ? (
                  <p className="text-xs text-[var(--text-muted)]">
                    Sin acciones de red registradas aún.
                  </p>
                ) : (
                  <ul className="max-h-48 space-y-1 overflow-y-auto text-xs">
                    {auditQuery.data!.events.map((ev) => (
                      <li
                        key={ev.id}
                        className="flex flex-wrap gap-x-2 border-t border-[var(--border)] py-1 first:border-t-0"
                      >
                        <span className="text-[var(--text-muted)]">
                          {new Date(ev.occurredAt).toLocaleString()}
                        </span>
                        <span
                          className={
                            ev.ok ? 'text-emerald-400' : 'text-red-400'
                          }
                        >
                          {ev.ok ? 'ok' : 'fail'}
                        </span>
                        <span className="font-medium">
                          {auditActionLabel(ev.action)}
                        </span>
                        <span className="text-[var(--text-muted)]">
                          {ev.actorEmail || ev.actorKind}
                        </span>
                        {typeof ev.detail?.message === 'string' ? (
                          <span className="w-full text-[var(--text-muted)]">
                            {ev.detail.message}
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </Section>

              <div className="flex flex-wrap gap-2 border-t border-[var(--border)] pt-4">
                {canWrite ? (
                  <>
                    <button
                      type="button"
                      disabled={actionBusy}
                      onClick={() => {
                        void confirm(
                          `¿Reiniciar ONU ${onuIf}? Solo envía reboot OMCI; no borra configuración.`,
                          {
                            title: 'Reiniciar ONU',
                            danger: true,
                            confirmLabel: 'Reiniciar',
                          },
                        ).then((ok) => {
                          if (ok) rebootMutation.mutate()
                        })
                      }}
                      className="rounded-lg bg-orange-600 px-3 py-2 text-sm font-medium text-white hover:bg-orange-500 disabled:opacity-60"
                    >
                      {rebootMutation.isPending ? 'Reiniciando…' : 'Reboot'}
                    </button>
                    <button
                      type="button"
                      disabled={actionBusy}
                      onClick={() => {
                        if (showEnableAccess) {
                          const crmNote = clientLink
                            ? `\n\nEsta ONU está ligada a ${clientLink.label}: se reactivarán todos sus servicios suspendidos (portal o enable OLT según la empresa).`
                            : ''
                          void confirm(
                            `¿Rehabilitar acceso${clientLink ? ' del cliente' : ` ONU ${onuIf}`}?${crmNote || `\n\nENABLE: vuelve a dar servicio sin pedir autorización de nuevo.`}`,
                            {
                              title: clientLink
                                ? 'Reactivar cliente'
                                : 'Rehabilitar ONU',
                              confirmLabel: clientLink
                                ? 'Reactivar'
                                : 'Enable',
                            },
                          ).then((ok) => {
                            if (ok) enableMutation.mutate()
                          })
                          return
                        }
                        const crmNote = clientLink
                          ? `\n\nEsta ONU está ligada a ${clientLink.label}: se suspenderán todos sus servicios (portal cautivo o disable en OLT, según la empresa).`
                          : `\n\nDISABLE: queda autorizada en la OLT pero sin servicio (admin disable).\nNo pide autorización de nuevo. Para eso usa Delete.`
                        void confirm(
                          `¿Suspender${clientLink ? ` a ${clientLink.label}` : ` ONU ${onuIf}`}?${crmNote}`,
                          {
                            title: clientLink
                              ? 'Suspender cliente'
                              : 'Deshabilitar ONU',
                            danger: true,
                            confirmLabel: clientLink ? 'Suspender' : 'Disable',
                          },
                        ).then((ok) => {
                          if (ok) disableMutation.mutate()
                        })
                      }}
                      className={
                        showEnableAccess
                          ? 'rounded-lg border border-emerald-500/50 bg-emerald-500/10 px-3 py-2 text-sm font-medium text-emerald-400 hover:bg-emerald-500/20 disabled:opacity-60'
                          : 'rounded-lg border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-sm font-medium text-amber-400 hover:bg-amber-500/20 disabled:opacity-60'
                      }
                    >
                      {showEnableAccess
                        ? enableMutation.isPending
                          ? 'Reactivando…'
                          : clientLink
                            ? 'Reactivar cliente'
                            : 'Enable ONU'
                        : disableMutation.isPending
                          ? 'Suspendiendo…'
                          : clientLink
                            ? 'Suspender cliente'
                            : 'Disable ONU'}
                    </button>
                    <button
                      type="button"
                      disabled={actionBusy}
                      onClick={() => {
                        void confirm(
                          `¿ELIMINAR ONU ${onuIf} de la OLT?\n\n` +
                            `DELETE (no onu): borra la autorización. No es lo mismo que Disable.\n` +
                            `Si sigue conectada, volverá a Huérfanas y habrá que autorizarla otra vez.\n` +
                            `También se quita de Conectadas.`,
                          {
                            title: 'Eliminar ONU',
                            danger: true,
                            confirmLabel: 'Delete',
                          },
                        ).then((ok) => {
                          if (ok) deleteMutation.mutate()
                        })
                      }}
                      className="rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-60"
                    >
                      {deleteMutation.isPending ? 'Eliminando…' : 'Delete'}
                    </button>
                  </>
                ) : null}
                {canWrite && isUuid(onuDbId) ? (
                  <button
                    type="button"
                    disabled={resyncRunning || checkOpen || actionBusy}
                    onClick={() => startResync()}
                    title="Reaprovisionamiento completo: modelo ACS, VLANs OLT, IPs, OMCI/TR-069 y arranque del chequeo. Puedes cerrar y seguir en segundo plano."
                    className="rounded-lg border border-amber-500/50 bg-amber-500/10 px-3 py-1.5 text-sm font-medium text-amber-200 hover:bg-amber-500/20 disabled:opacity-50"
                  >
                    {resyncRunning ? 'Resync…' : 'Resync config'}
                  </button>
                ) : (
                  pendingBtn('Resync config')
                )}
                {canWrite && isUuid(onuDbId) ? (
                  <button
                    type="button"
                    disabled={checkOpen || resyncRunning || actionBusy}
                    onClick={() => startCheckOnu()}
                    title="Chequeo del plan de verify: mide y repara si algo falla (no reaprovisiona todo)."
                    className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm font-medium hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-50"
                  >
                    {checkOpen ? 'Checking…' : 'Check ONU'}
                  </button>
                ) : (
                  pendingBtn('Check ONU')
                )}
              </div>
            </>
          )}
        </div>

      <OperationProgressModal
        open={resyncOpen}
        title="Resync config — reaprovisionamiento completo"
        steps={resyncSteps}
        running={resyncRunning}
        failed={resyncFailed}
        allDone={resyncDone}
        doneLabel={
          resyncDriverId
            ? `ONU reaprovisionada · driver ${resyncDriverId}`
            : 'ONU reaprovisionada'
        }
        failedLabel="Resync falló — puedes reintentar o seguir en segundo plano"
        closeWhileRunning
        closeLabel={
          resyncRunning
            ? 'Seguir en segundo plano'
            : resyncDone
              ? 'Listo'
              : 'Cerrar'
        }
        onRetry={
          resyncFailed
            ? () => {
                void executeResync()
              }
            : undefined
        }
        onClose={() => {
          setResyncOpen(false)
          void queryClient.invalidateQueries({
            queryKey: ['app', 'onus', 'detail', oltId, onuIf],
          })
        }}
      >
        <p className="mx-5 mb-2 text-xs text-[var(--text-muted)]">
          Vuelve a empujar OLT + IPs + OMCI/ACS. No es solo un chequeo: para
          eso usa <span className="text-[var(--text)]">Check ONU</span>.
        </p>
      </OperationProgressModal>

      <OnuProvisionProgressModal
        open={checkOpen && isUuid(onuDbId)}
        onuId={onuDbId ?? ''}
        title="Check ONU — chequeo y reparación"
        runCheckOnOpen={checkRunOnOpen}
        onClose={() => {
          setCheckOpen(false)
          setCheckRunOnOpen(false)
          void queryClient.invalidateQueries({
            queryKey: ['app', 'onus', 'detail', oltId, onuIf],
          })
        }}
        onFinished={() => {
          void queryClient.invalidateQueries({
            queryKey: ['app', 'onus', 'detail', oltId, onuIf],
          })
        }}
      />

      {cliModal && (
        <OnuCliReportModal
          title={cliModal.title}
          subtitle={onuIf}
          body={cliModal.body}
          loading={cliLoading}
          error={cliError}
          onClose={() => {
            setCliModal(null)
            setCliError(null)
            setCliLoading(false)
          }}
        />
      )}
      {liveOpen && (
        <OnuLiveTrafficModal
          oltId={oltId}
          onuIf={onuIf}
          onClose={() => setLiveOpen(false)}
        />
      )}
      {tr069ConfigOpen && isUuid(onuDbId) && (
        <OnuTr069ConfigModal
          onuId={onuDbId}
          canWrite={canWrite}
          onClose={() => setTr069ConfigOpen(false)}
        />
      )}
      {vlansModalOpen && isUuid(onuDbId) && o && (
        <OnuVlansModal
          onuId={onuDbId}
          oltId={oltId}
          canWrite={canWrite}
          mgmtVlanId={o.mgmtVlanId ?? null}
          wanVlanId={o.wanVlanId ?? null}
          wanIp={o.wanIp ?? null}
          onClose={() => setVlansModalOpen(false)}
          onSaved={() => {
            void detailQuery.refetch()
            setMsg('VLANs actualizadas')
          }}
        />
      )}
      {manualModalOpen && isUuid(onuDbId) && (
        <OnuManualModal
          onuId={onuDbId}
          canWrite={canWrite}
          onClose={() => setManualModalOpen(false)}
          onChanged={() => {
            void detailQuery.refetch()
            setMsg('Modo de aprovisionamiento actualizado')
          }}
        />
      )}
      {descModalOpen && (
        <ModalPortal><div className="fixed inset-0 z-[110] modal-backdrop flex items-stretch justify-center overflow-hidden bg-black/50 sm:items-center sm:p-4">
          <div className="h-[100dvh] max-h-[100dvh] overflow-y-auto overscroll-contain w-full max-w-lg rounded-none border-0 sm:h-auto sm:max-h-[min(92dvh,920px)] sm:rounded-xl sm:border border-[var(--border)] bg-[var(--bg-elevated)] shadow-xl">
            <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
              <h4 className="font-semibold">Dirección / comentario (OLT)</h4>
              <button
                type="button"
                className="rounded-md px-2 py-1 text-[var(--text-muted)] hover:bg-[var(--bg)]"
                onClick={() => setDescModalOpen(false)}
              >
                ✕
              </button>
            </div>
            <div className="space-y-3 px-4 py-4">
              <p className="text-xs text-[var(--text-muted)]">
                Texto libre en el campo <code>description</code> de la ONU en
                la OLT (máx. 200 caracteres). Independiente del nombre.
              </p>
              <textarea
                rows={5}
                maxLength={200}
                disabled={!canWrite || descMutation.isPending}
                value={descDraft}
                onChange={(e) => setDescDraft(e.target.value)}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm outline-none ring-[var(--accent)] focus:ring-2 disabled:opacity-60"
                placeholder="dirección - Calle 123, Ciudad…"
              />
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs text-[var(--text-muted)]">
                  {descDraft.trim().length}/200
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setDescModalOpen(false)}
                    className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm hover:bg-[var(--bg)]"
                  >
                    Cerrar
                  </button>
                  {canWrite && (
                    <button
                      type="button"
                      disabled={descMutation.isPending || !isUuid(onuDbId)}
                      onClick={() => descMutation.mutate(descDraft)}
                      className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-60"
                    >
                      {descMutation.isPending ? 'Guardando…' : 'Guardar'}
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div></ModalPortal>
      )}
      {zoneModalOpen && (
        <ModalPortal><div className="fixed inset-0 z-[110] modal-backdrop flex items-stretch justify-center overflow-hidden bg-black/50 sm:items-center sm:p-4">
          <div className="h-[100dvh] max-h-[100dvh] overflow-y-auto overscroll-contain w-full max-w-md rounded-none border-0 sm:h-auto sm:max-h-[min(92dvh,920px)] sm:rounded-xl sm:border border-[var(--border)] bg-[var(--bg-elevated)] shadow-xl">
            <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
              <h4 className="font-semibold">Zona</h4>
              <button
                type="button"
                className="rounded-md px-2 py-1 text-[var(--text-muted)] hover:bg-[var(--bg)]"
                onClick={() => setZoneModalOpen(false)}
              >
                ✕
              </button>
            </div>
            <div className="space-y-3 px-4 py-4">
              <p className="text-xs text-[var(--text-muted)]">
                Elige una zona del catálogo (Ajustes → Zonas). Si la ONU tiene
                cliente, también se actualiza ahí.
              </p>
              <select
                disabled={!canWrite || zoneMutation.isPending}
                value={zoneDraft}
                onChange={(e) => setZoneDraft(e.target.value)}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm outline-none ring-[var(--accent)] focus:ring-2 disabled:opacity-60"
              >
                <option value="">Sin zona</option>
                {(zonesQuery.data ?? []).map((z) => (
                  <option key={z.id} value={z.id}>
                    {z.name}
                  </option>
                ))}
              </select>
              {(zonesQuery.data?.length ?? 0) === 0 && (
                <p className="text-xs text-[var(--text-muted)]">
                  No hay zonas todavía. Crea una en Ajustes → Zonas.
                </p>
              )}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setZoneModalOpen(false)}
                  className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm hover:bg-[var(--bg)]"
                >
                  Cerrar
                </button>
                {canWrite && (
                  <button
                    type="button"
                    disabled={zoneMutation.isPending || !isUuid(onuDbId)}
                    onClick={() =>
                      zoneMutation.mutate(zoneDraft ? zoneDraft : null)
                    }
                    className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-60"
                  >
                    {zoneMutation.isPending ? 'Guardando…' : 'Guardar'}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div></ModalPortal>
      )}

      {imageZoomOpen && (
        <ModalPortal>
          <div
            className="fixed inset-0 z-[120] modal-backdrop flex items-center justify-center bg-black/80 p-4"
            role="dialog"
            aria-modal="true"
            aria-label="Imagen ONU ampliada"
            onClick={() => setImageZoomOpen(false)}
          >
            <button
              type="button"
              className="absolute right-4 top-4 rounded-md bg-black/50 px-3 py-1.5 text-sm text-white hover:bg-black/70"
              onClick={() => setImageZoomOpen(false)}
            >
              ✕
            </button>
            <img
              src={imageSrc}
              alt={o?.onuType ?? 'ONU'}
              className="max-h-[min(92dvh,900px)] max-w-[min(96vw,1100px)] object-contain"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        </ModalPortal>
      )}
    </div>
  )

  if (embedded) return panel
  return (
    <ModalPortal>
      <div className="fixed inset-0 z-[100] modal-backdrop flex items-stretch justify-center overflow-hidden bg-black/60 sm:items-center sm:p-4">
        {panel}
      </div>
    </ModalPortal>
  )
}

function Row({
  label,
  value,
  mono,
  muted,
}: {
  label: string
  value: string
  mono?: boolean
  muted?: boolean
}) {
  return (
    <div className="flex gap-2">
      <dt className="w-40 shrink-0 text-[var(--text-muted)]">{label}</dt>
      <dd
        className={[
          'min-w-0 break-all',
          mono ? 'font-mono text-xs' : '',
          muted ? 'text-[var(--text-muted)]' : '',
        ].join(' ')}
      >
        {value}
      </dd>
    </div>
  )
}

function Section({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  return (
    <section className="space-y-2">
      <h4 className="font-semibold uppercase tracking-wide text-[var(--text-muted)]">
        {title}
      </h4>
      {children}
    </section>
  )
}
