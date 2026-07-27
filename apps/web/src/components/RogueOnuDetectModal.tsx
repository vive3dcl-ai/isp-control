import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'

type RogueCard = {
  slot: string
  boardType: string
  detect: boolean
  locate: boolean
  autoShutdown: boolean
}

type RogueDetectResponse = {
  deviceId: string
  cards: RogueCard[]
}

function StatusBadge({
  enabled,
  labelOn = 'Habilitado',
  labelOff = 'Deshabilitado',
}: {
  enabled: boolean
  labelOn?: string
  labelOff?: string
}) {
  return (
    <span
      className={[
        'inline-flex rounded px-2 py-0.5 text-xs font-medium',
        enabled
          ? 'bg-[var(--accent)]/20 text-[var(--accent)]'
          : 'bg-[var(--bg)] text-[var(--text-muted)]',
      ].join(' ')}
    >
      {enabled ? labelOn : labelOff}
    </span>
  )
}

export function RogueOnuDetectModal({
  open,
  deviceId,
  canWrite,
  initialSlot,
  onClose,
}: {
  open: boolean
  deviceId: string
  canWrite: boolean
  initialSlot?: string | null
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [selected, setSelected] = useState<string[]>([])
  const [optLocate, setOptLocate] = useState(true)
  const [optAutoShutdown, setOptAutoShutdown] = useState(true)
  const [checkLines, setCheckLines] = useState<string[] | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const rogueQuery = useQuery({
    queryKey: ['app', 'topology', 'devices', deviceId, 'rogue-detect'],
    queryFn: () =>
      apiFetch<RogueDetectResponse>(
        `/app/topology/devices/${deviceId}/rogue-detect`,
      ),
    enabled: open && !!deviceId,
  })

  useEffect(() => {
    if (!open) return
    setCheckLines(null)
    setMsg(null)
    setError(null)
  }, [open])

  useEffect(() => {
    const cards = rogueQuery.data?.cards ?? []
    if (!cards.length) return
    if (initialSlot && cards.some((c) => c.slot === initialSlot)) {
      setSelected([initialSlot])
    } else {
      setSelected(cards.map((c) => c.slot))
    }
  }, [rogueQuery.data, initialSlot, open])

  function invalidate() {
    void queryClient.invalidateQueries({
      queryKey: ['app', 'topology', 'devices', deviceId, 'rogue-detect'],
    })
    void queryClient.invalidateQueries({
      queryKey: ['app', 'topology', 'devices', deviceId, 'pon-ports'],
    })
  }

  const applyMutation = useMutation({
    mutationFn: (enable: boolean) =>
      apiFetch<{ message?: string }>(`/app/topology/devices/${deviceId}/rogue-detect`, {
        method: 'POST',
        body: JSON.stringify({
          slots: selected,
          enable,
          locate: optLocate,
          autoShutdown: optAutoShutdown,
        }),
      }),
    onSuccess: (r: { message?: string }) => {
      setMsg(r.message ?? 'Aplicado')
      setError(null)
      invalidate()
      void rogueQuery.refetch()
    },
    onError: (e: Error) => setError(e.message),
  })

  const checkMutation = useMutation({
    mutationFn: () =>
      apiFetch<{ lines: string[]; message?: string }>(
        `/app/topology/devices/${deviceId}/rogue-detect/check`,
        { method: 'POST' },
      ),
    onSuccess: (r) => {
      setCheckLines(r.lines ?? [])
      setMsg(r.message ?? null)
      setError(null)
    },
    onError: (e: Error) => setError(e.message),
  })

  if (!open) return null

  const cards = rogueQuery.data?.cards ?? []
  const allSelected =
    cards.length > 0 && selected.length === cards.length

  function toggleSlot(slot: string) {
    setSelected((prev) =>
      prev.includes(slot) ? prev.filter((s) => s !== slot) : [...prev, slot],
    )
  }

  function toggleAll() {
    if (allSelected) setSelected([])
    else setSelected(cards.map((c) => c.slot))
  }

  return (
    <div className="fixed inset-0 z-[85] flex items-start justify-center overflow-y-auto bg-black/60 p-3 sm:items-center sm:p-4">
      <div
        role="dialog"
        aria-modal="true"
        className="my-2 flex max-h-[min(92vh,100dvh)] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] shadow-xl"
      >
        <div className="flex shrink-0 items-start justify-between gap-2 border-b border-[var(--border)] px-4 py-3 sm:px-5 sm:py-4">
          <h3 className="flex min-w-0 items-center gap-2 text-base font-semibold sm:text-lg">
            <span
              className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--danger)] text-xs text-white"
              aria-hidden
            >
              ⌖
            </span>
            <span className="min-w-0">Detección de ONU deshonesta</span>
          </h3>
          <button
            type="button"
            className="shrink-0 rounded-md px-2 py-1 text-[var(--text-muted)] hover:bg-[var(--bg)]"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-4 text-sm sm:px-5">
          <p className="leading-relaxed text-[var(--text-muted)]">
            Una ONU deshonesta transmite fuera de sus ranuras de tiempo
            asignadas y puede degradar o tumbar el servicio de otros clientes
            en la misma red PON. La detección se configura por tarjeta GPON:
            selecciona las tarjetas, elige las opciones y aplica.
          </p>

          {rogueQuery.isLoading && (
            <p className="text-[var(--text-muted)]">Cargando tarjetas…</p>
          )}
          {rogueQuery.error && (
            <p className="text-[var(--danger)]">{rogueQuery.error.message}</p>
          )}
          {error && <p className="text-[var(--danger)]">{error}</p>}
          {msg && <p className="text-emerald-500">{msg}</p>}

          {!rogueQuery.isLoading && cards.length === 0 && !rogueQuery.error && (
            <p className="text-[var(--text-muted)]">
              No hay tarjetas GPON en servicio.
            </p>
          )}

          {cards.length > 0 && (
            <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)] bg-[var(--bg)] text-[var(--text-muted)]">
                    <th className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={allSelected}
                        onChange={toggleAll}
                        aria-label="Seleccionar todas"
                      />
                    </th>
                    <th className="px-3 py-2 font-medium">Ranura OLT</th>
                    <th className="px-3 py-2 font-medium">Tipo</th>
                    <th className="px-3 py-2 font-medium">Detectar</th>
                    <th className="px-3 py-2 font-medium">Localizar</th>
                    <th className="px-3 py-2 font-medium">Apagado auto</th>
                  </tr>
                </thead>
                <tbody>
                  {cards.map((c) => (
                    <tr
                      key={c.slot}
                      className="border-b border-[var(--border)] last:border-0"
                    >
                      <td className="px-3 py-2.5">
                        <input
                          type="checkbox"
                          checked={selected.includes(c.slot)}
                          onChange={() => toggleSlot(c.slot)}
                        />
                      </td>
                      <td className="px-3 py-2.5 font-medium">{c.slot}</td>
                      <td className="px-3 py-2.5">{c.boardType}</td>
                      <td className="px-3 py-2.5">
                        <StatusBadge enabled={c.detect} />
                      </td>
                      <td className="px-3 py-2.5">
                        <StatusBadge enabled={c.locate} />
                      </td>
                      <td className="px-3 py-2.5">
                        <StatusBadge enabled={c.autoShutdown} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="space-y-2">
            <p className="font-medium">Opciones a habilitar</p>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={optLocate}
                onChange={(e) => setOptLocate(e.target.checked)}
                disabled={!canWrite}
              />
              Localizar la ONU deshonesta
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={optAutoShutdown}
                onChange={(e) => setOptAutoShutdown(e.target.checked)}
                disabled={!canWrite}
              />
              Apagado automático
            </label>
            <p className="text-xs text-[var(--text-muted)]">
              El apagado automático deshabilitará una ONU detectada como
              deshonesta. Reemplazar la ONU defectuosa es la solución
              recomendada; también conviene revisar la ODN (atenuación,
              splitters).
            </p>
          </div>

          {checkLines && (
            <div className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2">
              <p className="mb-1 text-xs font-medium text-[var(--text-muted)]">
                Resultado de comprobación
              </p>
              {checkLines.length === 0 ? (
                <p className="text-xs text-[var(--text-muted)]">
                  Sin entradas Rogue en el log de alarmas.
                </p>
              ) : (
                <ul className="max-h-32 space-y-1 overflow-y-auto font-mono text-xs">
                  {checkLines.map((l, i) => (
                    <li key={i}>{l}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-wrap justify-end gap-2 border-t border-[var(--border)] px-5 py-3">
          <button
            type="button"
            className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm"
            onClick={onClose}
          >
            Cerrar
          </button>
          {canWrite && (
            <>
              <button
                type="button"
                disabled={checkMutation.isPending}
                className="rounded-lg bg-sky-600 px-3 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-60"
                onClick={() => checkMutation.mutate()}
              >
                {checkMutation.isPending
                  ? 'Comprobando…'
                  : 'Comprobar ONUs deshonestas'}
              </button>
              <button
                type="button"
                disabled={
                  applyMutation.isPending || selected.length === 0
                }
                className="rounded-lg bg-orange-600 px-3 py-2 text-sm font-medium text-white hover:bg-orange-500 disabled:opacity-60"
                onClick={() => applyMutation.mutate(false)}
              >
                Deshabilitar en seleccionadas
              </button>
              <button
                type="button"
                disabled={
                  applyMutation.isPending || selected.length === 0
                }
                className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-60"
                onClick={() => applyMutation.mutate(true)}
              >
                Habilitar en seleccionadas
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
