import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'
import {
  formatSignal,
  type ConnectedOnu,
  type ConnectedOnuDetailResponse,
  type ConnectedOnusResponse,
  type OnuMetricsResponse,
} from '../lib/onu-connected'
import {
  MetricWindowPicker,
  SignalChart,
  TrafficChart,
  type MetricWindowKey,
} from './OnuMetricCharts'
import type { ClientService } from '../lib/crm'
import type {
  ApplyTr069OnuConfigBody,
  ApplyTr069OnuConfigResponse,
  Tr069OnuConfig,
} from '../lib/onu-tr069-config'
import { GoogleMapsCoords } from './GoogleMapsCoords'
import { LocationPickerMap } from './LocationPickerMap'
import { OnuLiveTrafficModal } from './OnuLiveTrafficModal'
import { ModalPortal } from './ModalPortal'

const inputClass =
  'w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm outline-none ring-[var(--accent)] focus:ring-2'

export function ServiceOnuViewModal({
  open,
  onClose,
  service,
  canWrite,
}: {
  open: boolean
  onClose: () => void
  service: ClientService
  canWrite: boolean
}) {
  const queryClient = useQueryClient()
  const [liveOpen, setLiveOpen] = useState(false)
  const [wifiKeys, setWifiKeys] = useState<Record<number, string>>({})
  const [wifiMsg, setWifiMsg] = useState<string | null>(null)
  const [wifiError, setWifiError] = useState<string | null>(null)
  const [chartWindow, setChartWindow] = useState<MetricWindowKey>('1h')

  const onusQuery = useQuery({
    queryKey: ['app', 'onus'],
    queryFn: () => apiFetch<ConnectedOnusResponse>('/app/onus'),
    enabled: open && !!service.onuId,
  })

  const linked: ConnectedOnu | null =
    service.onuId != null
      ? (onusQuery.data?.onus.find((o) => o.id === service.onuId) ?? null)
      : null

  const detailQuery = useQuery({
    queryKey: ['app', 'onus', 'detail', linked?.oltId, linked?.onuIf],
    queryFn: () =>
      apiFetch<ConnectedOnuDetailResponse>(
        `/app/onus/detail?oltId=${encodeURIComponent(linked!.oltId)}&onuIf=${encodeURIComponent(linked!.onuIf)}`,
      ),
    enabled: open && !!linked,
    // DB only. Live metrics?live=1 refreshes this ONU via SNMP.
    staleTime: 2_000,
    refetchInterval: open ? 3_000 : false,
  })

  const onu = detailQuery.data?.onu
  const onuDbId = onu?.id || linked?.id || service.onuId

  const metricsQuery = useQuery({
    queryKey: ['app', 'onus', 'metrics', onuDbId, 'live'],
    queryFn: () =>
      apiFetch<OnuMetricsResponse>(
        `/app/onus/${onuDbId}/metrics?hours=24&live=1`,
      ),
    enabled: open && !!onuDbId,
    refetchInterval: open ? 3_000 : false,
    staleTime: 0,
  })

  const tr069Query = useQuery({
    queryKey: ['app', 'onus', onuDbId, 'tr069-config'],
    queryFn: () =>
      apiFetch<Tr069OnuConfig>(`/app/onus/${onuDbId}/tr069-config`),
    enabled: open && !!onuDbId,
  })

  useEffect(() => {
    if (!open) {
      setLiveOpen(false)
      setWifiKeys({})
      setWifiMsg(null)
      setWifiError(null)
    }
  }, [open])

  useEffect(() => {
    const c = tr069Query.data
    if (!c) return
    // Leave password fields empty (only send when user types a new one).
    setWifiKeys({})
  }, [tr069Query.data])

  // Pull WiFi tree once if empty but ACS is present.
  useEffect(() => {
    const c = tr069Query.data
    if (!c?.inAcs || !onuDbId) return
    if (c.wifi.length > 0) return
    void apiFetch<ApplyTr069OnuConfigResponse>(
      `/app/onus/${onuDbId}/tr069-config`,
      { method: 'POST', body: JSON.stringify({ refresh: true }) },
    ).then((r) => {
      void queryClient.setQueryData(
        ['app', 'onus', onuDbId, 'tr069-config'],
        r.config,
      )
    })
  }, [tr069Query.data, onuDbId, queryClient])

  const wifiMutation = useMutation({
    mutationFn: (body: ApplyTr069OnuConfigBody) =>
      apiFetch<ApplyTr069OnuConfigResponse>(
        `/app/onus/${onuDbId}/tr069-config`,
        { method: 'POST', body: JSON.stringify(body) },
      ),
    onSuccess: (r) => {
      setWifiMsg(r.message || 'Contraseña Wi‑Fi actualizada')
      setWifiError(null)
      setWifiKeys({})
      void queryClient.setQueryData(
        ['app', 'onus', onuDbId, 'tr069-config'],
        r.config,
      )
    },
    onError: (e: Error) => {
      setWifiError(e.message)
      setWifiMsg(null)
    },
  })

  const signalSamples = (metricsQuery.data?.samples ?? []).filter(
    (s) => s.kind === 'signal',
  )
  const downloadSamples = (metricsQuery.data?.samples ?? []).filter(
    (s) => s.kind === 'rx_bps',
  )
  const uploadSamples = (metricsQuery.data?.samples ?? []).filter(
    (s) => s.kind === 'tx_bps',
  )

  if (!open) return null

  const hasLocation = service.latitude != null && service.longitude != null
  const wanIp = onu?.wanIp ?? linked?.wanIp ?? null

  return (
    <>
      <ModalPortal><div className="fixed inset-0 z-[100] modal-backdrop flex items-stretch justify-center overflow-hidden bg-black/60 sm:items-center sm:p-4">
        <div className="flex h-[100dvh] max-h-[100dvh] w-full max-w-2xl flex-col overflow-hidden rounded-none border-0 sm:h-auto sm:max-h-[min(92dvh,920px)] sm:rounded-xl sm:border border-[var(--border)] bg-[var(--bg-elevated)] shadow-xl">
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[var(--border)] px-4 py-3 sm:px-5 sm:py-4">
            <div className="min-w-0">
              <h2 className="text-lg font-semibold">ONU del servicio</h2>
              <p className="truncate text-xs text-[var(--text-muted)]">
                {service.name}
                {linked
                  ? ` · ${linked.sn || linked.onuIf}`
                  : service.onuId
                    ? ' · ONU no encontrada en Conectadas'
                    : ' · Sin ONU enlazada'}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="shrink-0 rounded-md px-2 py-1 text-[var(--text-muted)] hover:bg-[var(--bg)]"
            >
              ✕
            </button>
          </div>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5">
            {!service.onuId && (
              <p className="text-sm text-[var(--text-muted)]">
                Este servicio no tiene ONU. En Editar → Cambiar puedes
                aprovisionar una.
              </p>
            )}

            {service.onuId && onusQuery.isLoading && (
              <p className="text-sm text-[var(--text-muted)]">Cargando ONU…</p>
            )}

            {service.onuId && !onusQuery.isLoading && !linked && (
              <p className="text-sm text-amber-300">
                La ONU enlazada ya no está en Conectadas (puede haberse
                liberado).
              </p>
            )}

            {linked && (
              <>
                <section className="grid gap-3 rounded-lg border border-[var(--border)] bg-[var(--bg)] p-3 sm:grid-cols-3">
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-[var(--text-muted)]">
                      IP WAN
                    </p>
                    <p className="mt-0.5 font-mono text-sm font-medium">
                      {wanIp || '—'}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-[var(--text-muted)]">
                      Señal
                    </p>
                    <p className="mt-0.5 text-sm">
                      {formatSignal(onu?.signalDbm ?? linked.signalDbm)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-[var(--text-muted)]">
                      Estado
                    </p>
                    <p className="mt-0.5 text-sm">
                      {(onu?.online ?? linked.online) ? 'Online' : 'Offline'}
                      {' · '}
                      {linked.oltName}
                    </p>
                  </div>
                </section>

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setLiveOpen(true)}
                    className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500"
                  >
                    LIVE!
                  </button>
                </div>

                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold">Gráficas</h3>
                  <MetricWindowPicker
                    value={chartWindow}
                    onChange={setChartWindow}
                  />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <section className="rounded-lg border border-[var(--border)] p-3">
                    <h3 className="mb-2 text-sm font-semibold">Tráfico</h3>
                    <TrafficChart
                      download={downloadSamples}
                      upload={uploadSamples}
                      windowKey={chartWindow}
                      liveDownloadBps={onu?.downloadBps}
                      liveUploadBps={onu?.uploadBps}
                    />
                  </section>
                  <section className="rounded-lg border border-[var(--border)] p-3">
                    <h3 className="mb-2 text-sm font-semibold">Señal</h3>
                    <SignalChart
                      samples={signalSamples}
                      windowKey={chartWindow}
                    />
                  </section>
                </div>

                <section className="rounded-lg border border-[var(--border)] p-3">
                  <h3 className="mb-2 text-sm font-semibold">
                    Contraseña Wi‑Fi (TR069)
                  </h3>
                  {tr069Query.isLoading && (
                    <p className="text-xs text-[var(--text-muted)]">
                      Consultando ACS…
                    </p>
                  )}
                  {tr069Query.data && !tr069Query.data.inAcs && (
                    <p className="text-xs text-amber-300">
                      La ONU aún no ha informado al ACS. Activa TR069 desde
                      Conectadas para poder cambiar el Wi‑Fi.
                    </p>
                  )}
                  {tr069Query.data?.inAcs &&
                    tr069Query.data.wifi.length === 0 && (
                      <p className="text-xs text-[var(--text-muted)]">
                        Sin radios Wi‑Fi detectadas todavía. Espera un Inform o
                        abre Configurar ONU en Conectadas.
                      </p>
                    )}
                  {tr069Query.data?.inAcs &&
                    tr069Query.data.wifi.map((r) => (
                      <div
                        key={r.index}
                        className="mb-3 grid gap-2 border-b border-[var(--border)] pb-3 last:mb-0 last:border-0 last:pb-0 sm:grid-cols-[1fr_1fr_auto]"
                      >
                        <div>
                          <p className="text-xs text-[var(--text-muted)]">
                            WLAN {r.index}
                          </p>
                          <p className="text-sm font-medium">
                            {r.ssid || 'Sin SSID'}
                          </p>
                        </div>
                        <label className="block text-sm">
                          <span className="mb-1 block text-[11px] text-[var(--text-muted)]">
                            Nueva contraseña
                          </span>
                          <input
                            className={inputClass}
                            type="text"
                            placeholder="Dejar vacío para no cambiar"
                            value={wifiKeys[r.index] ?? ''}
                            disabled={
                              !canWrite ||
                              !r.keyPath ||
                              wifiMutation.isPending
                            }
                            onChange={(e) =>
                              setWifiKeys((prev) => ({
                                ...prev,
                                [r.index]: e.target.value,
                              }))
                            }
                          />
                        </label>
                        <div className="flex items-end">
                          <button
                            type="button"
                            disabled={
                              !canWrite ||
                              !r.keyPath ||
                              !(wifiKeys[r.index] ?? '').trim() ||
                              wifiMutation.isPending
                            }
                            onClick={() => {
                              const key = (wifiKeys[r.index] ?? '').trim()
                              if (!key) return
                              setWifiError(null)
                              wifiMutation.mutate({
                                wifi: [{ index: r.index, key }],
                              })
                            }}
                            className="rounded-lg bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-50"
                          >
                            Aplicar
                          </button>
                        </div>
                      </div>
                    ))}
                  {wifiMsg && (
                    <p className="mt-2 text-xs text-emerald-400">{wifiMsg}</p>
                  )}
                  {wifiError && (
                    <p className="mt-2 text-xs text-[var(--danger)]">
                      {wifiError}
                    </p>
                  )}
                </section>

                <section className="rounded-lg border border-[var(--border)] p-3">
                  <h3 className="mb-2 text-sm font-semibold">
                    Ubicación de instalación
                  </h3>
                  {hasLocation ? (
                    <>
                      <LocationPickerMap
                        lat={service.latitude}
                        lng={service.longitude}
                        readOnly
                        className="h-56 w-full rounded-lg"
                      />
                      <p className="mt-2 text-xs text-[var(--text-muted)]">
                        {[service.street, service.city]
                          .filter(Boolean)
                          .join(', ') || 'Sin dirección textual'}
                      </p>
                      <GoogleMapsCoords
                        className="mt-1.5"
                        lat={service.latitude!}
                        lng={service.longitude!}
                      />
                    </>
                  ) : (
                    <p className="text-xs text-[var(--text-muted)]">
                      Este servicio no tiene ubicación marcada en el mapa.
                    </p>
                  )}
                </section>
              </>
            )}
          </div>

          <div className="flex justify-end border-t border-[var(--border)] px-5 py-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm"
            >
              Cerrar
            </button>
          </div>
        </div>
      </div></ModalPortal>

      {liveOpen && linked && (
        <OnuLiveTrafficModal
          oltId={linked.oltId}
          onuIf={linked.onuIf}
          onClose={() => setLiveOpen(false)}
        />
      )}
    </>
  )
}
