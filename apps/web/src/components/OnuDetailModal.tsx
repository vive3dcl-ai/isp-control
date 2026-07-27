import type { ReactNode } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'
import { useAuth } from '../auth/AuthContext'
import { findNapForClient, loadMapDrafts } from '../lib/map-elements'
import type { NetworkMapLocations } from '../lib/network-map'
import {
  bpsToMbps,
  formatBps,
  formatSignal,
  type ConnectedOnuDetailResponse,
  type OnuCliReportResponse,
  type OnuMetricsResponse,
  type OnuRunningConfigResponse,
  type OnuSwInfoResponse,
} from '../lib/onu-connected'
import { OnuCliReportModal } from './OnuCliReportModal'
import { OnuLiveTrafficModal } from './OnuLiveTrafficModal'
import { OnuTr069ConfigModal } from './OnuTr069ConfigModal'
import { OnuVlansModal } from './OnuVlansModal'
import { OnuManualModal } from './OnuManualModal'
import type { Tr069OnuConfig } from '../lib/onu-tr069-config'
import type { Tr069ProfilesResponse } from '../lib/tr069'
import type { Zone } from './ZonasSettingsTab'
import { useNotify } from './NotifyProvider'

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

function isUuid(id: string | undefined): id is string {
  return !!id && /^[0-9a-f-]{36}$/i.test(id)
}

function SignalChart({
  samples,
}: {
  samples: Array<{ value: number; sampledAt: string }>
}) {
  const points = useMemo(() => {
    if (samples.length === 0) return null
    const vals = samples.map((s) => s.value)
    const min = Math.min(...vals) - 1
    const max = Math.max(...vals) + 1
    const span = Math.max(max - min, 0.5)
    const w = 320
    const h = 100
    const pad = 8
    const coords = samples.map((s, i) => {
      const x =
        pad +
        (samples.length === 1
          ? (w - pad * 2) / 2
          : (i / (samples.length - 1)) * (w - pad * 2))
      const y = pad + ((max - s.value) / span) * (h - pad * 2)
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    return { w, h, path: coords.join(' '), min, max }
  }, [samples])

  if (!points) {
    return (
      <p className="text-xs text-[var(--text-muted)]">
        Sin muestras aún. El poll automático (~1 min) llenará el historial.
      </p>
    )
  }

  return (
    <div>
      <svg
        viewBox={`0 0 ${points.w} ${points.h}`}
        className="h-28 w-full text-[var(--accent)]"
        role="img"
        aria-label="Señal histórica"
      >
        <polyline
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          points={points.path}
        />
      </svg>
      <p className="mt-1 text-xs text-[var(--text-muted)]">
        {points.min.toFixed(1)} … {points.max.toFixed(1)} dBm · {samples.length}{' '}
        muestras
      </p>
    </div>
  )
}

function TrafficChart({
  download,
  upload,
  liveDownloadBps,
  liveUploadBps,
}: {
  download: Array<{ value: number; sampledAt: string }>
  upload: Array<{ value: number; sampledAt: string }>
  liveDownloadBps?: number | null
  liveUploadBps?: number | null
}) {
  const chart = useMemo(() => {
    const times = new Map<string, { down?: number; up?: number }>()
    for (const s of download) {
      const t = times.get(s.sampledAt) ?? {}
      t.down = bpsToMbps(s.value)
      times.set(s.sampledAt, t)
    }
    for (const s of upload) {
      const t = times.get(s.sampledAt) ?? {}
      t.up = bpsToMbps(s.value)
      times.set(s.sampledAt, t)
    }
    const keys = [...times.keys()].sort()
    if (keys.length === 0) return null
    const downs = keys.map((k) => times.get(k)?.down ?? 0)
    const ups = keys.map((k) => times.get(k)?.up ?? 0)
    const max = Math.max(...downs, ...ups, 0.1)
    const w = 320
    const h = 100
    const pad = 8
    const toPath = (vals: number[]) =>
      vals
        .map((v, i) => {
          const x =
            pad +
            (vals.length === 1
              ? (w - pad * 2) / 2
              : (i / (vals.length - 1)) * (w - pad * 2))
          const y = pad + ((max - v) / max) * (h - pad * 2)
          return `${x.toFixed(1)},${y.toFixed(1)}`
        })
        .join(' ')
    return {
      w,
      h,
      downPath: toPath(downs),
      upPath: toPath(ups),
      max,
      n: keys.length,
    }
  }, [download, upload])

  if (!chart) {
    return (
      <p className="text-xs text-[var(--text-muted)]">
        Sin muestras de tráfico aún. Se actualizan con el poll (~1 min) o
        «Obtener estado».
      </p>
    )
  }

  return (
    <div>
      <div className="mb-1 flex flex-wrap gap-3 text-xs">
        <span>
          <span className="text-sky-400">●</span> Bajada{' '}
          {formatBps(liveDownloadBps ?? download.at(-1)?.value ?? null)}
        </span>
        <span>
          <span className="text-emerald-400">●</span> Subida{' '}
          {formatBps(liveUploadBps ?? upload.at(-1)?.value ?? null)}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${chart.w} ${chart.h}`}
        className="h-28 w-full"
        role="img"
        aria-label="Tráfico histórico"
      >
        <polyline
          fill="none"
          stroke="#38bdf8"
          strokeWidth="2"
          points={chart.downPath}
        />
        <polyline
          fill="none"
          stroke="#34d399"
          strokeWidth="2"
          points={chart.upPath}
        />
      </svg>
      <p className="mt-1 text-xs text-[var(--text-muted)]">
        0 … {chart.max.toFixed(2)} Mbps · {chart.n} muestras
      </p>
    </div>
  )
}

export function OnuDetailModal({
  oltId,
  onuIf,
  canWrite,
  onClose,
  onRebooted,
}: {
  oltId: string
  onuIf: string
  canWrite: boolean
  onClose: () => void
  onRebooted?: () => void
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

  const detailQuery = useQuery({
    queryKey: ['app', 'onus', 'detail', oltId, onuIf],
    queryFn: () =>
      apiFetch<ConnectedOnuDetailResponse>(
        `/app/onus/detail?oltId=${encodeURIComponent(oltId)}&onuIf=${encodeURIComponent(onuIf)}`,
      ),
  })

  const onuDbId = detailQuery.data?.onu?.id

  const { user } = useAuth()
  const tenantKey = user?.tenantSlug ?? user?.tenantId

  const locationsQuery = useQuery({
    queryKey: ['app', 'network-map', 'locations'],
    queryFn: () =>
      apiFetch<NetworkMapLocations>('/app/network-map/locations'),
  })

  const clientLink = useMemo(() => {
    const locs = locationsQuery.data
    if (!locs || !onuDbId) return null
    const marker = locs.onus.find((o) => o.onuId === onuDbId)
    if (!marker) return null
    const client = locs.clients.find((c) => c.clientId === marker.clientId)
    return {
      clientId: marker.clientId,
      label: client?.label ?? marker.label,
    }
  }, [locationsQuery.data, onuDbId])

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
    queryKey: ['app', 'onus', 'metrics', onuDbId],
    queryFn: () =>
      apiFetch<OnuMetricsResponse>(
        `/app/onus/${onuDbId}/metrics?hours=6`,
      ),
    enabled: isUuid(onuDbId),
    refetchInterval: 60_000,
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

  return (
    <div className="fixed inset-0 z-[90] flex items-start justify-center overflow-y-auto bg-black/60 p-3 sm:items-center sm:p-4">
      <div className="my-2 flex max-h-[min(92vh,100dvh)] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] shadow-xl">
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
              <div className="grid gap-4 md:grid-cols-2">
                <dl className="space-y-1.5 text-sm">
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
                  <Row
                    label="Fecha autorización"
                    value={o.authDate ?? 'Pendiente'}
                    muted
                  />
                  <Row label="ID externo" value={o.sn ?? '—'} mono />
                </dl>

                <div className="space-y-3">
                  <div className="rounded-lg border border-[var(--border)] bg-[var(--bg)] p-3">
                    <img
                      src={imageSrc}
                      alt={o.onuType ?? 'ONU'}
                      className="mx-auto h-[100px] object-contain"
                    />
                  </div>
                  <div className="space-y-1.5">
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
                      </p>
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

              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-lg border border-[var(--border)] p-3">
                  <p className="mb-2 text-xs font-medium text-[var(--text-muted)]">
                    Tráfico (6 h)
                  </p>
                  <TrafficChart
                    download={downloadSamples}
                    upload={uploadSamples}
                    liveDownloadBps={o.downloadBps}
                    liveUploadBps={o.uploadBps}
                  />
                </div>
                <div className="rounded-lg border border-[var(--border)] p-3">
                  <p className="mb-2 text-xs font-medium text-[var(--text-muted)]">
                    Señal histórica (6 h)
                  </p>
                  <SignalChart samples={signalSamples} />
                </div>
              </div>

              <Section title="Perfiles de velocidad">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-[var(--text-muted)]">
                      <th className="py-1 text-left font-medium">Download</th>
                      <th className="py-1 text-left font-medium">Upload</th>
                      <th className="py-1 text-left font-medium">Acción</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="py-1">
                        {o.speedProfile?.download ?? 'Pendiente'}
                      </td>
                      <td className="py-1">
                        {o.speedProfile?.upload ?? 'Pendiente'}
                      </td>
                      <td className="py-1">
                        <span className="text-[var(--text-muted)]">
                          Configurar (Pendiente)
                        </span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </Section>

              <Section title="Puertos Ethernet">
                {o.ethernetPorts.length === 0 ? (
                  <p className="text-[var(--text-muted)]">
                    Sin datos en running-config (Pendiente OMCI)
                  </p>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-[var(--text-muted)]">
                        <th className="py-1 text-left font-medium">Puerto</th>
                        <th className="py-1 text-left font-medium">Admin</th>
                        <th className="py-1 text-left font-medium">Modo</th>
                        <th className="py-1 text-left font-medium">DHCP</th>
                        <th className="py-1 text-left font-medium">Acción</th>
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
                )}
              </Section>

              <Section title="WiFi">
                {o.wifiPorts.length === 0 ? (
                  <p className="text-[var(--text-muted)]">
                    No detectado / Pendiente
                  </p>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-[var(--text-muted)]">
                        <th className="py-1 text-left font-medium">Puerto</th>
                        <th className="py-1 text-left font-medium">Admin</th>
                        <th className="py-1 text-left font-medium">Modo</th>
                        <th className="py-1 text-left font-medium">SSID</th>
                        <th className="py-1 text-left font-medium">DHCP</th>
                        <th className="py-1 text-left font-medium">Acción</th>
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
                        if (isAdminDisabled) {
                          void confirm(
                            `¿Rehabilitar ONU ${onuIf}?\n\n` +
                              `ENABLE: vuelve a dar servicio sin pedir autorización de nuevo.`,
                            {
                              title: 'Rehabilitar ONU',
                              confirmLabel: 'Enable',
                            },
                          ).then((ok) => {
                            if (ok) enableMutation.mutate()
                          })
                          return
                        }
                        void confirm(
                          `¿Deshabilitar ONU ${onuIf}?\n\n` +
                            `DISABLE: queda autorizada en la OLT pero sin servicio (admin disable).\n` +
                            `No pide autorización de nuevo. Para eso usa Delete.`,
                          {
                            title: 'Deshabilitar ONU',
                            danger: true,
                            confirmLabel: 'Disable',
                          },
                        ).then((ok) => {
                          if (ok) disableMutation.mutate()
                        })
                      }}
                      className={
                        isAdminDisabled
                          ? 'rounded-lg border border-emerald-500/50 bg-emerald-500/10 px-3 py-2 text-sm font-medium text-emerald-400 hover:bg-emerald-500/20 disabled:opacity-60'
                          : 'rounded-lg border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-sm font-medium text-amber-400 hover:bg-amber-500/20 disabled:opacity-60'
                      }
                    >
                      {isAdminDisabled
                        ? enableMutation.isPending
                          ? 'Rehabilitando…'
                          : 'Enable ONU'
                        : disableMutation.isPending
                          ? 'Deshabilitando…'
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
                {pendingBtn('Resync config')}
                {pendingBtn('Restore defaults')}
              </div>
            </>
          )}
        </div>
      </div>

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
        <div className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-black/50 p-3 sm:items-center sm:p-4">
          <div className="max-h-[min(92vh,100dvh)] overflow-y-auto w-full max-w-lg rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] shadow-xl">
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
        </div>
      )}
      {zoneModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-black/50 p-3 sm:items-center sm:p-4">
          <div className="max-h-[min(92vh,100dvh)] overflow-y-auto w-full max-w-md rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] shadow-xl">
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
        </div>
      )}
    </div>
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
