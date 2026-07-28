import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'
import type { OltPonPortRow, OltPonPortsResponse } from '../lib/topology'
import { RogueOnuDetectModal } from './RogueOnuDetectModal'
import { useNotify } from './NotifyProvider'
import { ModalPortal } from './ModalPortal'


const inputClass =
  'w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 outline-none ring-[var(--accent)] focus:ring-2'

function LoadBar({
  online,
  max,
  pct,
}: {
  online: number
  max: number
  pct: number
}) {
  const active = online > 0
  return (
    <div className="min-w-[120px]">
      <div className="mb-0.5 h-2 overflow-hidden rounded bg-[var(--bg)]">
        <div
          className={[
            'h-full rounded',
            active ? 'bg-emerald-500' : 'bg-[var(--border)]',
          ].join(' ')}
          style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
        />
      </div>
      <p className="text-xs text-[var(--text-muted)]">
        {online} / {max} ({pct}%)
      </p>
    </div>
  )
}

export function OltPonPortsPanel({
  deviceId,
  canWrite,
}: {
  deviceId: string
  canWrite: boolean
}) {
  const queryClient = useQueryClient()
  const { alert, confirm } = useNotify()
  const [slotFilter, setSlotFilter] = useState<string>('any')
  const [configurePort, setConfigurePort] = useState<OltPonPortRow | null>(
    null,
  )
  const [cfgAdmin, setCfgAdmin] = useState(true)
  const [cfgDesc, setCfgDesc] = useState('')
  const [cfgMin, setCfgMin] = useState('0')
  const [cfgMax, setCfgMax] = useState('20000')
  const [cfgMaxOnus, setCfgMaxOnus] = useState('')
  const [actionError, setActionError] = useState<string | null>(null)
  const [actionMsg, setActionMsg] = useState<string | null>(null)
  const [rogueOpen, setRogueOpen] = useState(false)
  const [rogueSlot, setRogueSlot] = useState<string | null>(null)

  const portsQuery = useQuery({
    queryKey: ['app', 'topology', 'devices', deviceId, 'pon-ports'],
    queryFn: () =>
      apiFetch<OltPonPortsResponse>(
        `/app/topology/devices/${deviceId}/pon-ports`,
      ),
    retry: 1,
  })

  function invalidate() {
    void queryClient.invalidateQueries({
      queryKey: ['app', 'topology', 'devices', deviceId, 'pon-ports'],
    })
  }

  const enableAllMutation = useMutation({
    mutationFn: () =>
      apiFetch<{ message?: string }>(
        `/app/topology/devices/${deviceId}/pon-ports/enable-all`,
        { method: 'POST' },
      ),
    onSuccess: (r: { message?: string }) => {
      setActionMsg(r.message ?? 'Puertos habilitados')
      setActionError(null)
      invalidate()
    },
    onError: (e: Error) => setActionError(e.message),
  })

  const rebootOnusMutation = useMutation({
    mutationFn: (body: { ifName?: string; slot?: string; all?: boolean }) =>
      apiFetch<{ message?: string }>(
        `/app/topology/devices/${deviceId}/pon-ports/reboot-onus`,
        { method: 'POST', body: JSON.stringify(body) },
      ),
    onSuccess: (r: { message?: string }) => {
      setActionMsg(r.message ?? 'Reinicio enviado')
      setActionError(null)
      invalidate()
    },
    onError: (e: Error) => setActionError(e.message),
  })

  const saveConfigMutation = useMutation({
    mutationFn: () => {
      if (!configurePort) throw new Error('Sin puerto')
      return apiFetch(`/app/topology/devices/${deviceId}/pon-ports/config`, {
        method: 'PATCH',
        body: JSON.stringify({
          ifName: configurePort.ifName,
          adminEnabled: cfgAdmin,
          description: cfgDesc,
          minRangeM: Number(cfgMin) || 0,
          maxRangeM: Number(cfgMax) || 20000,
          maxOnus: cfgMaxOnus.trim() ? Number(cfgMaxOnus) : null,
        }),
      })
    },
    onSuccess: () => {
      setConfigurePort(null)
      setActionMsg('Puerto guardado')
      invalidate()
    },
    onError: (e: Error) => setActionError(e.message),
  })

  const ports = portsQuery.data?.ports ?? []
  const slots = useMemo(
    () => [...new Set(ports.map((p) => p.slot))].sort((a, b) => Number(a) - Number(b)),
    [ports],
  )

  const filtered = useMemo(
    () =>
      slotFilter === 'any'
        ? ports
        : ports.filter((p) => p.slot === slotFilter),
    [ports, slotFilter],
  )

  const bySlot = useMemo(() => {
    const map = new Map<string, OltPonPortRow[]>()
    for (const p of filtered) {
      const list = map.get(p.slot) ?? []
      list.push(p)
      map.set(p.slot, list)
    }
    return [...map.entries()].sort((a, b) => Number(a[0]) - Number(b[0]))
  }, [filtered])

  function openConfigure(p: OltPonPortRow) {
    setConfigurePort(p)
    setCfgAdmin(p.adminEnabled)
    setCfgDesc(p.description ?? '')
    setCfgMin(String(p.minRangeM ?? 0))
    setCfgMax(String(p.maxRangeM ?? 20000))
    setCfgMaxOnus('')
    setActionError(null)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={portsQuery.isFetching}
          onClick={() => void portsQuery.refetch()}
          className="rounded-lg bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-60"
        >
          {portsQuery.isFetching
            ? 'Actualizando…'
            : 'Refrescar info de puertos PON'}
        </button>
        {canWrite && (
          <>
            <button
              type="button"
              disabled={enableAllMutation.isPending}
              onClick={() => {
                void confirm(
                  '¿Habilitar todos los puertos PON (no shutdown)?',
                  {
                    title: 'Habilitar puertos PON',
                    confirmLabel: 'Habilitar',
                  },
                ).then((ok) => {
                  if (ok) enableAllMutation.mutate()
                })
              }}
              className="rounded-lg bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
            >
              Habilitar todos los puertos PON
            </button>
            <button
              type="button"
              disabled={rebootOnusMutation.isPending}
              onClick={() => {
                void confirm(
                  '¿Reiniciar TODAS las ONUs de esta OLT? Puede cortar servicio.',
                  {
                    title: 'Reiniciar ONUs',
                    danger: true,
                    confirmLabel: 'Reiniciar',
                  },
                ).then((ok) => {
                  if (ok) rebootOnusMutation.mutate({ all: true })
                })
              }}
              className="rounded-lg bg-orange-600 px-3 py-2 text-sm font-medium text-white hover:bg-orange-500 disabled:opacity-60"
            >
              Reiniciar todas las ONUs
            </button>
            <button
              type="button"
              onClick={() => {
                setRogueSlot(null)
                setRogueOpen(true)
              }}
              className="rounded-lg bg-[var(--danger)] px-3 py-2 text-sm font-medium text-white hover:opacity-90"
            >
              Detección de ONU deshonesta
            </button>
          </>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label className="flex items-center gap-2">
          <span className="text-[var(--text-muted)]">Ranura OLT</span>
          <select
            className="rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-2 py-1.5"
            value={slotFilter}
            onChange={(e) => setSlotFilter(e.target.value)}
          >
            <option value="any">Cualquiera</option>
            {slots.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <span className="text-[var(--text-muted)]">
          {portsQuery.isLoading
            ? 'Cargando…'
            : portsQuery.data
              ? 'Todos cargados.'
              : ''}
        </span>
        {portsQuery.data?.summary && (
          <span className="text-xs text-[var(--text-muted)]">
            {portsQuery.data.summary}
          </span>
        )}
      </div>

      {actionError && (
        <p className="text-sm text-[var(--danger)]">{actionError}</p>
      )}
      {actionMsg && (
        <p className="text-sm text-emerald-500">{actionMsg}</p>
      )}
      {portsQuery.error && (
        <p className="text-sm text-[var(--danger)]">
          {portsQuery.error.message}
        </p>
      )}

      {portsQuery.isLoading && (
        <p className="text-sm text-[var(--text-muted)]">
          Consultando OLT (show card + estado ONU + óptico)… puede tardar.
        </p>
      )}

      {!portsQuery.isLoading && bySlot.length === 0 && !portsQuery.error && (
        <p className="rounded-lg border border-dashed border-[var(--border)] px-4 py-8 text-center text-sm text-[var(--text-muted)]">
          No hay puertos PON. Comprueba tarjetas GPON/EPON en línea.
        </p>
      )}

      {bySlot.map(([slot, slotPorts]) => {
        const board = slotPorts[0]?.boardType ?? '—'
        return (
          <section
            key={slot}
            className="overflow-hidden rounded-xl border border-[var(--border)]"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] bg-[var(--bg-elevated)] px-4 py-3">
              <p className="text-sm font-medium">
                Ranura OLT {slot}, tipo de tarjeta: {board}
              </p>
              <div className="flex flex-wrap gap-3 text-xs">
                <button
                  type="button"
                  className="text-[var(--accent)] hover:underline"
                  onClick={() =>
                    void alert(
                      'Configurar máximo de ONUs por PON: usa Configurar en cada puerto (Máximo de ONUs).',
                      { title: 'Máximo de ONUs por PON' },
                    )
                  }
                >
                  Configurar máximo de ONUs por PON
                </button>
                {canWrite && (
                  <button
                    type="button"
                    className="text-[var(--accent)] hover:underline disabled:opacity-50"
                    disabled={rebootOnusMutation.isPending}
                    onClick={() => {
                      void confirm(
                        `¿Reiniciar todas las ONUs en la ranura ${slot}?`,
                        {
                          title: 'Reiniciar ONUs',
                          danger: true,
                          confirmLabel: 'Reiniciar',
                        },
                      ).then((ok) => {
                        if (ok) rebootOnusMutation.mutate({ slot })
                      })
                    }}
                  >
                    Reiniciar todas las ONUs en la ranura {slot}
                  </button>
                )}
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[1100px] text-left text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)] text-[var(--text-muted)]">
                    <th className="px-3 py-2 font-medium">Puerto</th>
                    <th className="px-3 py-2 font-medium">Tipo</th>
                    <th className="px-3 py-2 font-medium">Estado admin</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 font-medium">ONUs</th>
                    <th className="px-3 py-2 font-medium">Carga</th>
                    <th className="px-3 py-2 font-medium">Señal promedio</th>
                    <th className="px-3 py-2 font-medium">Descripción</th>
                    <th className="px-3 py-2 font-medium">Propiedades</th>
                    <th className="px-3 py-2 font-medium">Potencia de Tx</th>
                    <th className="px-3 py-2 font-medium">Acción</th>
                  </tr>
                </thead>
                <tbody>
                  {slotPorts.map((p) => (
                    <tr
                      key={p.ifName}
                      className="border-b border-[var(--border)] last:border-0"
                    >
                      <td className="px-3 py-2.5 font-medium">{p.port}</td>
                      <td className="px-3 py-2.5">
                        {p.ponType === 'epon' ? 'EPON' : 'GPON'}
                      </td>
                      <td className="px-3 py-2.5">
                        {p.adminEnabled ? 'Habilitado' : 'Deshabilitado'}
                      </td>
                      <td className="px-3 py-2.5">
                        <span
                          className={
                            p.status === 'Up'
                              ? 'font-medium text-emerald-500'
                              : 'font-medium text-[var(--danger)]'
                          }
                        >
                          {p.status}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-xs whitespace-nowrap">
                        <div>En línea: {p.onuOnline}</div>
                        <div className="text-[var(--text-muted)]">
                          Total: {p.onuTotal}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <LoadBar
                          online={p.onuOnline}
                          max={p.maxOnus}
                          pct={p.loadPct}
                        />
                      </td>
                      <td className="px-3 py-2.5 font-mono text-xs whitespace-nowrap">
                        {p.avgSignalDbm != null ? (
                          <span className="inline-flex items-center gap-1.5 text-emerald-500">
                            <span aria-hidden className="opacity-80">
                              ▂▃▅▇
                            </span>
                            {p.avgSignalDbm.toFixed(2)}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-xs">
                        {p.description || '—'}
                      </td>
                      <td className="px-3 py-2.5 text-xs text-[var(--text-muted)]">
                        <div>
                          Rango: {p.minRangeM} - {p.maxRangeM} m
                        </div>
                        <div>
                          Detección de ONU deshonesta:{' '}
                          <button
                            type="button"
                            className={[
                              'font-medium underline-offset-2 hover:underline',
                              p.rogueDetectEnabled
                                ? 'text-[var(--accent)]'
                                : 'text-[var(--text-muted)] hover:text-[var(--accent)]',
                            ].join(' ')}
                            onClick={() => {
                              setRogueSlot(p.slot)
                              setRogueOpen(true)
                            }}
                          >
                            {p.rogueDetectEnabled
                              ? 'Habilitado'
                              : 'Deshabilitado'}
                          </button>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 font-mono text-xs">
                        {p.txPowerDbm != null ? p.txPowerDbm.toFixed(2) : '—'}
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex flex-col gap-1 text-xs">
                          <button
                            type="button"
                            className="text-left text-[var(--accent)] hover:underline"
                            onClick={() => openConfigure(p)}
                          >
                            Configurar
                          </button>
                          {canWrite && (
                            <button
                              type="button"
                              className="text-left text-[var(--accent)] hover:underline disabled:opacity-50"
                              disabled={rebootOnusMutation.isPending}
                              onClick={() => {
                                void confirm(
                                  `¿Reiniciar ONUs del puerto ${p.port}?`,
                                  {
                                    title: 'Reiniciar ONUs',
                                    danger: true,
                                    confirmLabel: 'Reiniciar',
                                  },
                                ).then((ok) => {
                                  if (ok) {
                                    rebootOnusMutation.mutate({
                                      ifName: p.ifName,
                                    })
                                  }
                                })
                              }}
                            >
                              Reiniciar ONUs
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )
      })}

      {configurePort && (
        <ModalPortal><div className="fixed inset-0 z-[110] modal-backdrop flex items-stretch justify-center overflow-hidden bg-black/60 sm:items-center sm:p-4">
          <div
            role="dialog"
            aria-modal="true"
            className="h-[100dvh] max-h-[100dvh] overflow-y-auto overscroll-contain w-full max-w-md rounded-none border-0 sm:h-auto sm:max-h-[min(92dvh,920px)] sm:rounded-xl sm:border border-[var(--border)] bg-[var(--bg-elevated)] shadow-xl"
          >
            <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
              <h3 className="text-lg font-semibold">
                Configurar puerto PON {configurePort.port}
              </h3>
              <button
                type="button"
                className="rounded-md px-2 py-1 text-[var(--text-muted)] hover:bg-[var(--bg)]"
                onClick={() => setConfigurePort(null)}
              >
                ✕
              </button>
            </div>
            <div className="space-y-4 px-5 py-4 text-sm">
              <fieldset>
                <legend className="mb-2 text-[var(--text-muted)]">
                  Estado administrativo
                </legend>
                <div className="flex gap-4">
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      checked={cfgAdmin}
                      onChange={() => setCfgAdmin(true)}
                      disabled={!canWrite}
                    />
                    Habilitado
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      checked={!cfgAdmin}
                      onChange={() => setCfgAdmin(false)}
                      disabled={!canWrite}
                    />
                    Deshabilitado
                  </label>
                </div>
              </fieldset>
              <label className="block">
                <span className="mb-1 block text-[var(--text-muted)]">
                  Descripción del puerto
                </span>
                <input
                  className={inputClass}
                  value={cfgDesc}
                  onChange={(e) => setCfgDesc(e.target.value)}
                  disabled={!canWrite}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-[var(--text-muted)]">
                  Rango mínimo
                </span>
                <input
                  className={inputClass}
                  value={cfgMin}
                  onChange={(e) => setCfgMin(e.target.value)}
                  disabled={!canWrite}
                />
                <span className="mt-1 block text-xs text-[var(--text-muted)]">
                  metros
                </span>
              </label>
              <label className="block">
                <span className="mb-1 block text-[var(--text-muted)]">
                  Rango máximo
                </span>
                <input
                  className={inputClass}
                  value={cfgMax}
                  onChange={(e) => setCfgMax(e.target.value)}
                  disabled={!canWrite}
                />
                <span className="mt-1 block text-xs text-[var(--text-muted)]">
                  metros
                </span>
              </label>
              <label className="block">
                <span className="mb-1 block text-[var(--text-muted)]">
                  Máximo de ONUs
                </span>
                <input
                  className={inputClass}
                  value={cfgMaxOnus}
                  onChange={(e) => setCfgMaxOnus(e.target.value)}
                  placeholder="automático (por tipo)"
                  disabled={!canWrite}
                />
              </label>
            </div>
            <div className="flex justify-end gap-2 border-t border-[var(--border)] px-5 py-3">
              <button
                type="button"
                className="rounded-lg px-3 py-2 text-sm text-[var(--text-muted)] hover:text-[var(--text)]"
                onClick={() => setConfigurePort(null)}
              >
                Cerrar
              </button>
              {canWrite && (
                <button
                  type="button"
                  disabled={saveConfigMutation.isPending}
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-60"
                  onClick={() => saveConfigMutation.mutate()}
                >
                  {saveConfigMutation.isPending ? 'Guardando…' : 'Guardar'}
                </button>
              )}
            </div>
          </div>
        </div></ModalPortal>
      )}

      <RogueOnuDetectModal
        open={rogueOpen}
        deviceId={deviceId}
        canWrite={canWrite}
        initialSlot={rogueSlot}
        onClose={() => {
          setRogueOpen(false)
          setRogueSlot(null)
        }}
      />
    </div>
  )
}
