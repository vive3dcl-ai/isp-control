import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'
import type { OnuManualConfig } from '../lib/onu-connected'

function CopyRow({ label, value }: { label: string; value: string | null }) {
  if (!value) return null
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <span className="text-[var(--text-muted)]">{label}</span>
      <button
        type="button"
        title="Copiar"
        onClick={() => void navigator.clipboard?.writeText(value)}
        className="max-w-[60%] truncate rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1 font-mono text-xs hover:border-[var(--accent)] hover:text-[var(--accent)]"
      >
        {value}
      </button>
    </div>
  )
}

/**
 * Datos que el técnico debe ingresar por la web de la ONU cuando está en
 * modo manual (auto-aprovisionamiento no compatible).
 */
export function OnuManualModal({
  onuId,
  canWrite,
  onClose,
  onChanged,
}: {
  onuId: string
  canWrite?: boolean
  onClose: () => void
  onChanged?: () => void
}) {
  const queryClient = useQueryClient()
  const [switchingAuto, setSwitchingAuto] = useState(false)
  const query = useQuery({
    queryKey: ['app', 'onus', onuId, 'manual-config'],
    queryFn: () =>
      apiFetch<OnuManualConfig>(`/app/onus/${onuId}/manual-config`),
  })

  const cfg = query.data

  async function backToAuto() {
    setSwitchingAuto(true)
    try {
      await apiFetch(`/app/onus/${onuId}/provision-mode`, {
        method: 'POST',
        body: JSON.stringify({ mode: 'auto' }),
      })
      void queryClient.invalidateQueries({
        queryKey: ['app', 'onus', onuId, 'tr069-config'],
      })
      onChanged?.()
      onClose()
    } finally {
      setSwitchingAuto(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[110] flex items-start justify-center overflow-y-auto bg-black/60 p-3 sm:items-center sm:p-4">
      <div className="max-h-[min(92vh,100dvh)] overflow-y-auto w-full max-w-md rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] text-[var(--text)] shadow-xl">
        <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-3">
          <h3 className="text-lg font-semibold">Datos para configurar manualmente</h3>
          <button
            type="button"
            className="rounded-md px-2 py-1 text-[var(--text-muted)] hover:bg-[var(--bg)]"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        <div className="space-y-4 px-5 py-4 text-sm">
          <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
            Ingresa estos valores en la interfaz web de la ONU. Configura la WAN
            en modo <strong>Router (IP estática)</strong> con la VLAN indicada.
          </p>

          {query.isLoading && (
            <p className="text-[var(--text-muted)]">Cargando…</p>
          )}

          {cfg?.wan ? (
            <section>
              <h4 className="mb-1 font-semibold text-[var(--accent)]">
                WAN / Internet
              </h4>
              <div className="divide-y divide-[var(--border)]">
                <CopyRow label="Modo" value="Router · IP estática" />
                <CopyRow label="VLAN WAN" value={String(cfg.wan.vlan)} />
                <CopyRow label="IP" value={cfg.wan.ip} />
                <CopyRow
                  label="Máscara"
                  value={`${cfg.wan.mask} (/${cfg.wan.prefix})`}
                />
                <CopyRow label="Gateway" value={cfg.wan.gateway} />
                <CopyRow label="DNS 1" value={cfg.wan.dns1} />
                <CopyRow label="DNS 2" value={cfg.wan.dns2} />
              </div>
            </section>
          ) : (
            !query.isLoading && (
              <p className="text-xs text-[var(--text-muted)]">
                Sin WAN asignada. Asigna una VLAN WAN con pool antes de
                configurar manualmente.
              </p>
            )
          )}

          {cfg?.mgmt && (
            <section>
              <h4 className="mb-1 font-semibold text-[var(--accent)]">
                Management
              </h4>
              <div className="divide-y divide-[var(--border)]">
                <CopyRow label="VLAN mgmt" value={String(cfg.mgmt.vlan)} />
                <CopyRow label="IP" value={cfg.mgmt.ip} />
                <CopyRow
                  label="Máscara"
                  value={`${cfg.mgmt.mask} (/${cfg.mgmt.prefix})`}
                />
                <CopyRow label="Gateway" value={cfg.mgmt.gateway} />
              </div>
            </section>
          )}
        </div>

        <div className="flex flex-wrap justify-end gap-2 border-t border-[var(--border)] px-5 py-3">
          {canWrite && (
            <button
              type="button"
              disabled={switchingAuto}
              onClick={() => void backToAuto()}
              className="mr-auto rounded-lg border border-[var(--border)] px-3 py-2 text-sm hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-50"
            >
              {switchingAuto ? 'Cambiando…' : 'Volver a modo automático'}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  )
}
