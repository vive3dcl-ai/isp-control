import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'
import type { OltUplinkRow, OltUplinksResponse } from '../lib/topology'
import { ModalPortal } from './ModalPortal'
import {
  oltBtnPrimary,
  oltBtnSecondary,
  oltMetaClass,
  oltToolbarClass,
} from './oltPanelUi'


const inputClass =
  'w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 outline-none ring-[var(--accent)] focus:ring-2'

function statusClass(status: string, adminEnabled: boolean) {
  if (!adminEnabled || /^down$/i.test(status)) {
    return 'font-medium text-[var(--danger)]'
  }
  if (/up|full|g-/i.test(status)) {
    return 'font-medium text-emerald-500'
  }
  return 'font-medium'
}

export function OltUplinksPanel({
  deviceId,
  canWrite,
}: {
  deviceId: string
  canWrite: boolean
}) {
  const queryClient = useQueryClient()
  const [cfg, setCfg] = useState<OltUplinkRow | null>(null)
  const [description, setDescription] = useState('')
  const [addVlans, setAddVlans] = useState('')
  const [removeVlans, setRemoveVlans] = useState('')
  const [adminEnabled, setAdminEnabled] = useState(true)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  const [syncing, setSyncing] = useState(false)

  const uplinksQuery = useQuery({
    queryKey: ['app', 'topology', 'devices', deviceId, 'uplinks'],
    queryFn: () =>
      apiFetch<OltUplinksResponse>(
        `/app/topology/devices/${deviceId}/uplinks`,
      ),
    retry: 1,
  })

  async function syncFromOlt() {
    setSyncing(true)
    try {
      const data = await apiFetch<OltUplinksResponse>(
        `/app/topology/devices/${deviceId}/uplinks?refresh=1`,
      )
      queryClient.setQueryData(
        ['app', 'topology', 'devices', deviceId, 'uplinks'],
        data,
      )
    } finally {
      setSyncing(false)
    }
  }

  const saveMutation = useMutation({
    mutationFn: () => {
      if (!cfg) throw new Error('Sin puerto')
      return apiFetch<{ message?: string }>(`/app/topology/devices/${deviceId}/uplinks/config`, {
        method: 'PATCH',
        body: JSON.stringify({
          ifName: cfg.ifName,
          description,
          addVlans: addVlans.trim() || undefined,
          removeVlans: removeVlans.trim() || undefined,
          adminEnabled,
        }),
      })
    },
    onSuccess: (r: { message?: string }) => {
      setMsg(r.message ?? 'Guardado')
      setError(null)
      setCfg(null)
      void syncFromOlt()
    },
    onError: (e: Error) => setError(e.message),
  })

  function openConfigure(u: OltUplinkRow) {
    setCfg(u)
    setDescription(u.description ?? '')
    setAddVlans('')
    setRemoveVlans('')
    setAdminEnabled(u.adminEnabled)
    setShowAdvanced(false)
    setError(null)
  }

  const uplinks = uplinksQuery.data?.uplinks ?? []

  return (
    <div className="space-y-4">
      <div className={oltToolbarClass}>
        <button
          type="button"
          disabled={uplinksQuery.isFetching || syncing}
          onClick={() => void syncFromOlt()}
          className={oltBtnPrimary}
        >
          {uplinksQuery.isFetching || syncing
            ? 'Sincronizando…'
            : 'Sincronizar'}
        </button>
        {(uplinksQuery.data?.syncedAt || uplinksQuery.data?.probedAt) && (
          <span className={oltMetaClass}>
            Última sincronización:{' '}
            {new Date(
              uplinksQuery.data.syncedAt || uplinksQuery.data.probedAt,
            ).toLocaleString()}
          </span>
        )}
        {uplinksQuery.data?.summary && (
          <span className={oltMetaClass}>{uplinksQuery.data.summary}</span>
        )}
      </div>

      {msg && <p className="text-sm text-emerald-500">{msg}</p>}
      {error && !cfg && (
        <p className="text-sm text-[var(--danger)]">{error}</p>
      )}
      {uplinksQuery.error && (
        <p className="text-sm text-[var(--danger)]">
          {uplinksQuery.error.message}
        </p>
      )}
      {uplinksQuery.isLoading && (
        <p className="text-sm text-[var(--text-muted)]">
          Sincronizando uplinks…
        </p>
      )}

      {!uplinksQuery.isLoading && uplinks.length === 0 && !uplinksQuery.error && (
        <p className="rounded-lg border border-dashed border-[var(--border)] px-4 py-8 text-center text-sm text-[var(--text-muted)]">
          No se encontraron interfaces gei_/xgei_. Comprueba la OLT.
        </p>
      )}

      {uplinks.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
          <table className="w-full min-w-[1100px] text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--bg-elevated)] text-[var(--text-muted)]">
                <th className="px-3 py-2 font-medium">Puerto uplink</th>
                <th className="px-3 py-2 font-medium">Descripción</th>
                <th className="px-3 py-2 font-medium">Tipo</th>
                <th className="px-3 py-2 font-medium">Estado admin.</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Negociación</th>
                <th className="px-3 py-2 font-medium">MTU</th>
                <th className="px-3 py-2 font-medium">Long. onda</th>
                <th className="px-3 py-2 font-medium">Señal dBm</th>
                <th className="px-3 py-2 font-medium">Temp.</th>
                <th className="px-3 py-2 font-medium">PVID untag</th>
                <th className="px-3 py-2 font-medium">
                  Modo: VLANs etiquetadas
                </th>
                <th className="px-3 py-2 font-medium">Acción</th>
              </tr>
            </thead>
            <tbody>
              {uplinks.map((u) => (
                <tr
                  key={u.ifName}
                  className="border-b border-[var(--border)] last:border-0"
                >
                  <td className="px-3 py-2.5">
                    <button
                      type="button"
                      className="font-mono text-xs text-[var(--accent)] hover:underline"
                      onClick={() => openConfigure(u)}
                    >
                      {u.ifName}
                    </button>
                  </td>
                  <td className="px-3 py-2.5 text-xs">
                    {u.description || '—'}
                  </td>
                  <td className="px-3 py-2.5">{u.mediaTypeLabel}</td>
                  <td
                    className={[
                      'px-3 py-2.5',
                      u.adminEnabled
                        ? ''
                        : 'font-medium text-[var(--danger)]',
                    ].join(' ')}
                  >
                    {u.adminEnabled ? 'Habilitado' : 'Deshabilitado'}
                  </td>
                  <td
                    className={`px-3 py-2.5 ${statusClass(u.status, u.adminEnabled)}`}
                  >
                    {u.status}
                  </td>
                  <td className="px-3 py-2.5 text-xs">
                    {u.negotiation ?? '—'}
                  </td>
                  <td className="px-3 py-2.5">{u.mtu ?? '—'}</td>
                  <td className="px-3 py-2.5">
                    {u.wavelengthNm != null ? u.wavelengthNm : 'N/A'}
                  </td>
                  <td className="px-3 py-2.5 font-mono text-xs">
                    {u.signalDbm != null ? u.signalDbm.toFixed(2) : '—'}
                  </td>
                  <td className="px-3 py-2.5">
                    {u.tempC != null ? u.tempC.toFixed(1) : 'N/A'}
                  </td>
                  <td className="px-3 py-2.5">
                    {u.pvidUntag ?? '—'}
                  </td>
                  <td className="px-3 py-2.5 text-xs">
                    {u.modeVlansLabel}
                  </td>
                  <td className="px-3 py-2.5">
                    <button
                      type="button"
                      className="text-xs text-[var(--accent)] hover:underline"
                      onClick={() => openConfigure(u)}
                    >
                      Configurar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {cfg && (
        <ModalPortal><div className="fixed inset-0 z-[110] modal-backdrop flex items-stretch justify-center overflow-hidden bg-black/60 sm:items-center sm:p-4">
          <div
            role="dialog"
            aria-modal="true"
            className="h-[100dvh] max-h-[100dvh] overflow-y-auto overscroll-contain w-full max-w-xl rounded-none border-0 sm:h-auto sm:max-h-[min(92dvh,920px)] sm:rounded-xl sm:border border-[var(--border)] bg-[var(--bg-elevated)] shadow-xl"
          >
            <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
              <h3 className="text-lg font-semibold">
                Configurar puerto uplink {cfg.ifName}
              </h3>
              <button
                type="button"
                className="rounded-md px-2 py-1 text-[var(--text-muted)] hover:bg-[var(--bg)]"
                onClick={() => setCfg(null)}
              >
                ✕
              </button>
            </div>

            <div className="space-y-4 px-5 py-4 text-sm">
              <div className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-4 py-3">
                <p className="mb-3 flex items-center gap-2 font-medium">
                  <span className="text-[var(--accent)]" aria-hidden>
                    ◈
                  </span>
                  Configurar puerto uplink
                </p>

                <dl className="space-y-3">
                  <div className="flex justify-between gap-4">
                    <dt className="text-[var(--text-muted)]">Modo</dt>
                    <dd className="font-medium">{cfg.mode ?? 'Trunk'}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-[var(--text-muted)]">
                      VLANs etiquetadas
                    </dt>
                    <dd className="max-w-[60%] break-all text-right font-medium">
                      {cfg.taggedVlansLabel || '—'}
                    </dd>
                  </div>
                </dl>

                <div className="mt-4 space-y-3">
                  <label className="block">
                    <span className="mb-1 block text-[var(--text-muted)]">
                      Descripción del puerto
                    </span>
                    <input
                      className={inputClass}
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      disabled={!canWrite}
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-[var(--text-muted)]">
                      Agregar VLANs
                    </span>
                    <input
                      className={inputClass}
                      value={addVlans}
                      onChange={(e) => setAddVlans(e.target.value)}
                      placeholder="ej. 100,200-205"
                      disabled={!canWrite}
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-[var(--text-muted)]">
                      Eliminar VLANs
                    </span>
                    <input
                      className={inputClass}
                      value={removeVlans}
                      onChange={(e) => setRemoveVlans(e.target.value)}
                      placeholder="ej. 80,350"
                      disabled={!canWrite}
                    />
                  </label>
                </div>

                <div className="mt-3 flex justify-end">
                  <button
                    type="button"
                    className="text-xs text-[var(--accent)] hover:underline"
                    onClick={() => setShowAdvanced((v) => !v)}
                  >
                    {showAdvanced ? '« Básico' : 'Avanzado »'}
                  </button>
                </div>
                {showAdvanced && (
                  <div className="mt-4 flex items-start justify-between gap-6">
                    <span className="pt-0.5 shrink-0 text-[var(--text-muted)]">
                      Estado admin.
                    </span>
                    <div className="space-y-2">
                      <label className="flex cursor-pointer items-center gap-2">
                        <input
                          type="radio"
                          name="uplink-admin"
                          checked={adminEnabled}
                          disabled={!canWrite}
                          onChange={() => setAdminEnabled(true)}
                          className="accent-[var(--accent)]"
                        />
                        <span>Habilitado</span>
                      </label>
                      <label className="flex cursor-pointer items-center gap-2">
                        <input
                          type="radio"
                          name="uplink-admin"
                          checked={!adminEnabled}
                          disabled={!canWrite}
                          onChange={() => setAdminEnabled(false)}
                          className="accent-[var(--accent)]"
                        />
                        <span>Deshabilitado (apagado del puerto)</span>
                      </label>
                    </div>
                  </div>
                )}
              </div>

              {error && (
                <p className="text-sm text-[var(--danger)]">{error}</p>
              )}
            </div>

            <div className="flex justify-end gap-2 border-t border-[var(--border)] px-5 py-3">
              <button
                type="button"
                className={oltBtnSecondary}
                onClick={() => setCfg(null)}
              >
                Cerrar
              </button>
              {canWrite && (
                <button
                  type="button"
                  disabled={saveMutation.isPending}
                  className={oltBtnPrimary}
                  onClick={() => saveMutation.mutate()}
                >
                  {saveMutation.isPending ? 'Guardando…' : 'Guardar'}
                </button>
              )}
            </div>
          </div>
        </div></ModalPortal>
      )}
    </div>
  )
}
