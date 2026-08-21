import { useEffect, useRef, useState } from 'react'
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
  const [wifiSsids, setWifiSsids] = useState<Record<number, string>>({})
  const [wifiKeys, setWifiKeys] = useState<Record<number, string>>({})
  const [wifiDraftsSeeded, setWifiDraftsSeeded] = useState(false)
  const [wifiMsg, setWifiMsg] = useState<string | null>(null)
  const [wifiError, setWifiError] = useState<string | null>(null)
  const [wifiFetching, setWifiFetching] = useState(false)
  const [chartWindow, setChartWindow] = useState<MetricWindowKey>('1h')
  const wifiFetchGen = useRef(0)
  const wifiFetchStartedFor = useRef<string | null>(null)

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
      setWifiSsids({})
      setWifiKeys({})
      setWifiDraftsSeeded(false)
      setWifiMsg(null)
      setWifiError(null)
      setWifiFetching(false)
      wifiFetchGen.current += 1
      wifiFetchStartedFor.current = null
    }
  }, [open])

  // SSID editable; contraseña siempre vacía (nunca mostrar la antigua).
  useEffect(() => {
    const c = tr069Query.data
    if (!c?.inAcs || wifiDraftsSeeded) return
    if (c.wifi.length === 0) return
    const next: Record<number, string> = {}
    for (const r of c.wifi) next[r.index] = r.ssid ?? ''
    setWifiSsids(next)
    setWifiKeys({})
    setWifiDraftsSeeded(true)
  }, [tr069Query.data, wifiDraftsSeeded])

  /** Pide el árbol Wi‑Fi al ACS y reintenta hasta que aparezcan radios. */
  async function fetchWifiRadios(force = false) {
    if (!onuDbId) return
    if (!force && wifiFetchStartedFor.current === onuDbId && wifiFetching) {
      return
    }
    wifiFetchStartedFor.current = onuDbId
    const gen = ++wifiFetchGen.current
    setWifiFetching(true)
    setWifiError(null)
    setWifiMsg('Obteniendo radios Wi‑Fi desde la ONU…')

    const stillActive = () => gen === wifiFetchGen.current

    const publish = (cfg: Tr069OnuConfig) => {
      void queryClient.setQueryData(
        ['app', 'onus', onuDbId, 'tr069-config'],
        cfg,
      )
      if (cfg.wifi.length > 0) {
        setWifiDraftsSeeded(false)
      }
    }

    try {
      // 1) refreshObject + GPV en el ACS (puede tardar / encolar).
      const refreshed = await apiFetch<ApplyTr069OnuConfigResponse>(
        `/app/onus/${onuDbId}/tr069-config`,
        { method: 'POST', body: JSON.stringify({ refresh: true }) },
      )
      if (!stillActive()) return
      publish(refreshed.config)
      if (refreshed.config.wifi.length > 0) {
        setWifiMsg(refreshed.message || 'Radios Wi‑Fi listas')
        return
      }

      // 2) El CPE a veces solo rellena en el Inform: reconsultar + 2º refresh.
      for (let i = 0; i < 6; i++) {
        await new Promise((r) => setTimeout(r, 2_500))
        if (!stillActive()) return
        if (i === 2) {
          try {
            const again = await apiFetch<ApplyTr069OnuConfigResponse>(
              `/app/onus/${onuDbId}/tr069-config`,
              { method: 'POST', body: JSON.stringify({ refresh: true }) },
            )
            if (!stillActive()) return
            publish(again.config)
            if (again.config.wifi.length > 0) {
              setWifiMsg(again.message || 'Radios Wi‑Fi listas')
              return
            }
          } catch {
            /* seguir con GET */
          }
        }
        const cfg = await apiFetch<Tr069OnuConfig>(
          `/app/onus/${onuDbId}/tr069-config`,
        )
        if (!stillActive()) return
        publish(cfg)
        if (cfg.wifi.length > 0) {
          setWifiMsg('Radios Wi‑Fi listas')
          return
        }
        setWifiMsg(`Esperando radios Wi‑Fi del ACS… (${i + 1}/6)`)
      }

      if (!stillActive()) return
      setWifiMsg(null)
      setWifiError(
        'No aparecieron radios Wi‑Fi. Comprueba que la ONU esté online en el ACS e inténtalo de nuevo.',
      )
    } catch (e) {
      if (!stillActive()) return
      setWifiMsg(null)
      setWifiError(e instanceof Error ? e.message : String(e))
    } finally {
      if (stillActive()) setWifiFetching(false)
    }
  }

  // Al abrir: si está en ACS y no hay radios, obtenerlas solas.
  useEffect(() => {
    if (!open || !onuDbId) return
    const c = tr069Query.data
    if (!c?.inAcs) return
    if (c.wifi.length > 0) return
    if (wifiFetchStartedFor.current === onuDbId) return
    void fetchWifiRadios()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one auto-fetch per ONU open
  }, [open, onuDbId, tr069Query.data?.inAcs, tr069Query.data?.wifi.length])

  const wifiMutation = useMutation({
    mutationFn: (body: ApplyTr069OnuConfigBody) =>
      apiFetch<ApplyTr069OnuConfigResponse>(
        `/app/onus/${onuDbId}/tr069-config`,
        { method: 'POST', body: JSON.stringify(body) },
      ),
    onSuccess: (r, vars) => {
      const changedSsid = (vars.wifi ?? []).some((w) => w.ssid != null)
      const changedKey = (vars.wifi ?? []).some((w) => w.key != null)
      setWifiMsg(
        r.message ||
          (changedSsid && changedKey
            ? 'Wi‑Fi actualizado'
            : changedSsid
              ? 'Nombre Wi‑Fi actualizado'
              : 'Contraseña Wi‑Fi actualizada'),
      )
      setWifiError(null)
      setWifiKeys({})
      // Mantener SSID escrito; alinear con lo enviado (ACS puede tardar Inform).
      setWifiSsids((prev) => {
        const next = { ...prev }
        for (const w of vars.wifi ?? []) {
          if (w.ssid != null) next[w.index] = w.ssid
        }
        return next
      })
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
                  <div className="mb-2 flex items-start justify-between gap-2">
                    <h3 className="text-sm font-semibold">Ajustes wifi</h3>
                    {tr069Query.data?.inAcs &&
                      (tr069Query.data.wifi.length === 0 || wifiFetching) && (
                        <button
                          type="button"
                          disabled={wifiFetching || !onuDbId}
                          onClick={() => {
                            wifiFetchStartedFor.current = null
                            void fetchWifiRadios(true)
                          }}
                          className="shrink-0 rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-xs disabled:opacity-50"
                        >
                          {wifiFetching ? 'Obteniendo…' : 'Reintentar'}
                        </button>
                      )}
                  </div>
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
                        {wifiFetching
                          ? 'Leyendo radios Wi‑Fi desde la ONU…'
                          : 'Sin radios Wi‑Fi todavía. Pulsa Reintentar para pedirlas al ACS.'}
                      </p>
                    )}
                  {tr069Query.data?.inAcs &&
                    tr069Query.data.wifi.map((r) => {
                      const ssidDraft = wifiSsids[r.index] ?? r.ssid ?? ''
                      const keyDraft = wifiKeys[r.index] ?? ''
                      const ssidChanged =
                        ssidDraft.trim() !== (r.ssid ?? '').trim()
                      const keyChanged = keyDraft.trim().length > 0
                      const canApply =
                        canWrite &&
                        (ssidChanged || keyChanged) &&
                        (!ssidChanged || !!r.ssidPath) &&
                        (!keyChanged || !!r.keyPath) &&
                        !wifiMutation.isPending &&
                        !wifiFetching
                      return (
                        <div
                          key={r.index}
                          className="mb-3 space-y-2 border-b border-[var(--border)] pb-3 last:mb-0 last:border-0 last:pb-0"
                        >
                          <p className="text-xs text-[var(--text-muted)]">
                            WLAN {r.index}
                          </p>
                          <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                            <label className="block text-sm">
                              <span className="mb-1 block text-[11px] text-[var(--text-muted)]">
                                Nombre (SSID)
                              </span>
                              <input
                                className={inputClass}
                                type="text"
                                maxLength={32}
                                value={ssidDraft}
                                disabled={
                                  !canWrite ||
                                  !r.ssidPath ||
                                  wifiMutation.isPending ||
                                  wifiFetching
                                }
                                onChange={(e) =>
                                  setWifiSsids((prev) => ({
                                    ...prev,
                                    [r.index]: e.target.value,
                                  }))
                                }
                              />
                            </label>
                            <label className="block text-sm">
                              <span className="mb-1 block text-[11px] text-[var(--text-muted)]">
                                Nueva contraseña
                              </span>
                              <input
                                className={inputClass}
                                type="password"
                                autoComplete="new-password"
                                placeholder="Vacío = no cambiar"
                                value={keyDraft}
                                disabled={
                                  !canWrite ||
                                  !r.keyPath ||
                                  wifiMutation.isPending ||
                                  wifiFetching
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
                                disabled={!canApply}
                                onClick={() => {
                                  const patch: NonNullable<
                                    ApplyTr069OnuConfigBody['wifi']
                                  >[number] = { index: r.index }
                                  if (ssidChanged) {
                                    const ssid = ssidDraft.trim()
                                    if (!ssid) {
                                      setWifiError(
                                        'El SSID no puede quedar vacío',
                                      )
                                      return
                                    }
                                    patch.ssid = ssid
                                  }
                                  if (keyChanged) {
                                    const key = keyDraft.trim()
                                    if (key.length < 8) {
                                      setWifiError(
                                        'La contraseña debe tener al menos 8 caracteres',
                                      )
                                      return
                                    }
                                    patch.key = key
                                  }
                                  setWifiError(null)
                                  wifiMutation.mutate({ wifi: [patch] })
                                }}
                                className="rounded-lg bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-50"
                              >
                                Aplicar
                              </button>
                            </div>
                          </div>
                        </div>
                      )
                    })}
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
