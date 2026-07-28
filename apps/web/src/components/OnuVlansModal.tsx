import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'
import type { IpPoolsResponse } from '../lib/ip-pools'
import {
  OperationProgressModal,
  runProgressSteps,
  type ProgressStep,
} from './OperationProgressModal'
import { ModalPortal } from './ModalPortal'

const inputClass =
  'w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm outline-none ring-[var(--accent)] focus:ring-2'

type NetworkVlansBody = {
  mgmtVlanId?: number
  wanVlanId?: number | null
}

export function OnuVlansModal({
  onuId,
  oltId,
  canWrite,
  mgmtVlanId,
  wanVlanId,
  onClose,
  onSaved,
}: {
  onuId: string
  oltId: string
  canWrite: boolean
  mgmtVlanId: number | null
  wanVlanId: number | null
  onClose: () => void
  onSaved?: () => void
}) {
  const queryClient = useQueryClient()
  const [mgmtVlanPick, setMgmtVlanPick] = useState(
    mgmtVlanId != null ? String(mgmtVlanId) : '',
  )
  const [wanVlanPick, setWanVlanPick] = useState(
    wanVlanId != null ? String(wanVlanId) : '',
  )
  const [error, setError] = useState<string | null>(null)

  const [progressOpen, setProgressOpen] = useState(false)
  const [progressSteps, setProgressSteps] = useState<ProgressStep[]>([])
  const [progressRunning, setProgressRunning] = useState(false)
  const [progressFailed, setProgressFailed] = useState(false)
  const [progressDone, setProgressDone] = useState(false)
  const [progressRunners, setProgressRunners] = useState<
    Record<string, () => Promise<string | void>>
  >({})
  const [switchingManual, setSwitchingManual] = useState(false)

  async function switchToManual() {
    setSwitchingManual(true)
    try {
      await apiFetch(`/app/onus/${onuId}/provision-mode`, {
        method: 'POST',
        body: JSON.stringify({ mode: 'manual' }),
      })
      void queryClient.invalidateQueries({
        queryKey: ['app', 'onus', onuId, 'tr069-config'],
      })
      onSaved?.()
      setProgressOpen(false)
      onClose()
    } finally {
      setSwitchingManual(false)
    }
  }

  const mgmtPoolsQuery = useQuery({
    queryKey: ['app', 'settings', 'ip-pools', 'management', oltId],
    queryFn: () =>
      apiFetch<IpPoolsResponse>(
        `/app/settings/ip-pools?purpose=management&oltId=${encodeURIComponent(oltId)}`,
      ),
  })

  const wanPoolsQuery = useQuery({
    queryKey: ['app', 'settings', 'ip-pools', 'internet', oltId],
    queryFn: () =>
      apiFetch<IpPoolsResponse>(
        `/app/settings/ip-pools?purpose=internet&oltId=${encodeURIComponent(oltId)}`,
      ),
  })

  useEffect(() => {
    if (mgmtVlanId != null) setMgmtVlanPick(String(mgmtVlanId))
    else if ((mgmtPoolsQuery.data?.pools ?? []).length === 1) {
      setMgmtVlanPick(String(mgmtPoolsQuery.data!.pools[0].vlanId))
    }
  }, [mgmtVlanId, mgmtPoolsQuery.data?.pools])

  useEffect(() => {
    if (wanVlanId != null) setWanVlanPick(String(wanVlanId))
  }, [wanVlanId])

  const mgmtPools = mgmtPoolsQuery.data?.pools ?? []
  const wanPools = wanPoolsQuery.data?.pools ?? []

  function buildBody(opts: {
    mgmtChanged: boolean
    wanChanged: boolean
  }): NetworkVlansBody {
    const body: NetworkVlansBody = {}
    // Solo enviamos los campos que realmente cambiaron para no reprocesar
    // (p.ej. una WAN heredada sin pool) y disparar errores espurios.
    if (opts.mgmtChanged && mgmtVlanPick) {
      body.mgmtVlanId = Number(mgmtVlanPick)
    }
    if (opts.wanChanged) {
      body.wanVlanId = wanVlanPick ? Number(wanVlanPick) : null
    }
    return body
  }

  async function executeProgress(
    steps: ProgressStep[],
    runners: Record<string, () => Promise<string | void>>,
  ) {
    setProgressRunning(true)
    setProgressFailed(false)
    setProgressDone(false)
    const result = await runProgressSteps(steps, setProgressSteps, runners)
    setProgressRunning(false)
    if (result.ok) {
      setProgressDone(true)
      void queryClient.invalidateQueries({
        queryKey: ['app', 'settings', 'ip-pools'],
      })
      void queryClient.invalidateQueries({
        queryKey: ['app', 'onus', onuId, 'tr069-config'],
      })
      onSaved?.()
    } else {
      setProgressFailed(true)
    }
  }

  function startApply() {
    setError(null)
    const nextMgmt = mgmtVlanPick ? Number(mgmtVlanPick) : null
    const nextWan = wanVlanPick ? Number(wanVlanPick) : null
    const mgmtChanged = nextMgmt != null && nextMgmt !== mgmtVlanId
    const wanChanged = nextWan !== wanVlanId

    if (!mgmtChanged && !wanChanged) {
      setError('No hay cambios de VLAN que aplicar')
      return
    }

    const body = buildBody({ mgmtChanged, wanChanged })
    const steps: ProgressStep[] = [
      {
        id: 'olt',
        label: 'Cambiando VLANs en la OLT (service-port)',
        status: 'pending',
      },
      {
        id: 'assign',
        label: 'Asignando IPs del pool (mgmt / WAN)',
        status: 'pending',
      },
      {
        id: 'apply',
        label: 'Aplicando a la ONU (OMCI wan-ip + TR069)',
        status: 'pending',
      },
      {
        id: 'verify',
        label: 'Esperando ONU online y verificando configuración',
        status: 'pending',
      },
    ]

    const runners: Record<string, () => Promise<string | void>> = {
      olt: async () => {
        const r = await apiFetch<{ message?: string }>(
          `/app/onus/${onuId}/network-vlans/olt`,
          { method: 'POST', body: JSON.stringify(body) },
        )
        return r.message || 'OLT OK'
      },
      assign: async () => {
        const r = await apiFetch<{ message?: string }>(
          `/app/onus/${onuId}/network-vlans/assign`,
          { method: 'POST', body: JSON.stringify(body) },
        )
        return r.message || 'Asignación OK'
      },
      apply: async () => {
        // Auto-provisioning depende de que la ONU sea compatible: 2 intentos.
        let lastErr: unknown = null
        for (let attempt = 1; attempt <= 2; attempt++) {
          try {
            const r = await apiFetch<{ message?: string }>(
              `/app/onus/${onuId}/network-vlans/apply`,
              { method: 'POST', body: JSON.stringify(body) },
            )
            return `${r.message || 'ONU OK'}${attempt > 1 ? ` (intento ${attempt})` : ''}`
          } catch (e) {
            lastErr = e
          }
        }
        throw new Error(
          `${lastErr instanceof Error ? lastErr.message : String(lastErr)} — 2 intentos fallidos. Reintenta o cambia a modo manual.`,
        )
      },
      verify: async () => {
        const r = await apiFetch<{
          ok: boolean
          message?: string
          mgmtVlanId?: number | null
          wanVlanId?: number | null
        }>(`/app/onus/${onuId}/network-vlans/verify`, { method: 'POST' })
        if (mgmtChanged && nextMgmt != null && r.mgmtVlanId !== nextMgmt) {
          throw new Error(
            `Mgmt quedó en VLAN ${r.mgmtVlanId ?? '—'}, se esperaba ${nextMgmt}`,
          )
        }
        if (wanChanged && r.wanVlanId !== nextWan) {
          throw new Error(
            `WAN quedó en VLAN ${r.wanVlanId ?? '—'}, se esperaba ${nextWan ?? 'ninguna'}`,
          )
        }
        return r.message || 'Config actualizada'
      },
    }

    setProgressSteps(steps)
    setProgressRunners(runners)
    setProgressOpen(true)
    void executeProgress(steps, runners)
  }

  return (
    <>
      <ModalPortal><div className="fixed inset-0 z-[100] modal-backdrop flex items-stretch justify-center overflow-hidden bg-black/60 sm:items-center sm:p-4">
        <div className="h-[100dvh] max-h-[100dvh] overflow-y-auto overscroll-contain w-full max-w-md rounded-none border-0 sm:h-auto sm:max-h-[min(92dvh,920px)] sm:rounded-xl sm:border border-[var(--border)] bg-[var(--bg-elevated)] text-[var(--text)] shadow-xl">
          <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-3">
            <h3 className="text-lg font-semibold">VLANs de la ONU</h3>
            <button
              type="button"
              className="rounded-md px-2 py-1 text-[var(--text-muted)] hover:bg-[var(--bg)]"
              onClick={onClose}
              disabled={progressRunning}
            >
              ✕
            </button>
          </div>

          <div className="space-y-4 px-5 py-4 text-sm">
            <p className="text-xs text-[var(--text-muted)]">
              Solo pools de la OLT de esta ONU. Al aplicar: OLT → IPs → ONU →
              verificación.
            </p>

            <label className="block">
              <span className="mb-1 block text-[var(--text-muted)]">
                VLAN management
              </span>
              <select
                className={inputClass}
                value={mgmtVlanPick}
                disabled={!canWrite || progressRunning}
                onChange={(e) => setMgmtVlanPick(e.target.value)}
              >
                <option value="">Sin asignar…</option>
                {mgmtPools.map((p) => (
                  <option key={p.id} value={p.vlanId}>
                    VLAN {p.vlanId}
                    {p.name ? ` — ${p.name}` : ''}
                  </option>
                ))}
              </select>
              {mgmtPools.length === 0 && (
                <span className="mt-1 block text-xs text-amber-400">
                  No hay pools de management en esta OLT.
                </span>
              )}
            </label>

            <label className="block">
              <span className="mb-1 block text-[var(--text-muted)]">
                VLAN WAN / Internet
              </span>
              <select
                className={inputClass}
                value={wanVlanPick}
                disabled={!canWrite || progressRunning}
                onChange={(e) => setWanVlanPick(e.target.value)}
              >
                <option value="">Sin WAN…</option>
                {wanVlanId != null &&
                  !wanPools.some((p) => p.vlanId === wanVlanId) && (
                    <option value={wanVlanId}>
                      VLAN {wanVlanId} — actual (sin pool)
                    </option>
                  )}
                {wanPools.map((p) => (
                  <option key={p.id} value={p.vlanId}>
                    VLAN {p.vlanId}
                    {p.name ? ` — ${p.name}` : ''}
                  </option>
                ))}
              </select>
              {wanPools.length === 0 && (
                <span className="mt-1 block text-xs text-[var(--text-muted)]">
                  No hay pools WAN (Internet) en esta OLT.
                </span>
              )}
            </label>

            {error && <p className="text-xs text-[var(--danger)]">{error}</p>}
          </div>

          <div className="flex justify-end gap-2 border-t border-[var(--border)] px-5 py-3">
            <button
              type="button"
              onClick={onClose}
              disabled={progressRunning}
              className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm disabled:opacity-50"
            >
              Cerrar
            </button>
            {canWrite && (
              <button
                type="button"
                disabled={progressRunning}
                onClick={startApply}
                className="rounded-lg bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                Aplicar
              </button>
            )}
          </div>
        </div>
      </div></ModalPortal>

      <OperationProgressModal
        open={progressOpen}
        title="Aplicando VLANs de la ONU"
        steps={progressSteps}
        running={progressRunning}
        failed={progressFailed}
        allDone={progressDone}
        onRetry={() => {
          void executeProgress(progressSteps, progressRunners)
        }}
        onClose={() => {
          if (progressRunning) return
          setProgressOpen(false)
          if (progressDone) onClose()
        }}
      >
        {progressFailed && (
          <div className="border-t border-[var(--border)] px-5 py-3">
            <p className="mb-2 text-xs text-[var(--text-muted)]">
              Si la ONU no acepta la configuración automática, pásala a modo
              manual: el técnico ingresará los datos por la web de la ONU.
            </p>
            <button
              type="button"
              disabled={progressRunning || switchingManual}
              onClick={() => void switchToManual()}
              className="w-full rounded-lg border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-sm font-medium text-amber-200 hover:bg-amber-500/20 disabled:opacity-50"
            >
              {switchingManual
                ? 'Cambiando…'
                : 'Cambiar a modo manual (config por web)'}
            </button>
          </div>
        )}
      </OperationProgressModal>
    </>
  )
}
