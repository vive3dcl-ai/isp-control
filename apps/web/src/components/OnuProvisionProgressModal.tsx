import { useCallback, useEffect, useRef, useState } from 'react'
import { apiFetch } from '../lib/api'
import {
  OperationProgressModal,
  type ProgressStep,
  type ProgressStepStatus,
} from './OperationProgressModal'

export type OnuVerifyProgressResponse = {
  onuId: string
  sn: string | null
  driverId: string | null
  verifyStatus: 'idle' | 'test' | 'ok' | 'fail' | string
  verifyAttempt: number
  plan: Array<{ id: string; label: string; phase: 'acs' | 'olt' | 'net' }>
  progress: {
    currentStepId: string | null
    completed: string[]
    notes: string[]
    history?: Array<{
      id: string
      status: 'done' | 'error' | 'skipped'
      note?: string
      at: string
    }>
    updatedAt: string
  } | null
  checks: Record<
    string,
    { ok?: boolean; message?: string } | null | undefined
  >
  healed: string[]
  failureSummary?: string
}

function latestHistoryById(
  history: NonNullable<OnuVerifyProgressResponse['progress']>['history'],
): Map<string, { status: 'done' | 'error' | 'skipped'; note?: string }> {
  const map = new Map<
    string,
    { status: 'done' | 'error' | 'skipped'; note?: string }
  >()
  for (const h of history ?? []) {
    map.set(h.id, { status: h.status, note: h.note })
  }
  return map
}

/** Mapea GET verify/progress → pasos del OperationProgressModal. */
export function mapOnuVerifyProgressSteps(
  data: OnuVerifyProgressResponse,
): ProgressStep[] {
  const completed = new Set(data.progress?.completed ?? [])
  const historyMap = latestHistoryById(data.progress?.history)
  const current = data.progress?.currentStepId
  const status = data.verifyStatus
  const active = status === 'test' || status === 'idle'
  const lastNotes = data.progress?.notes?.slice(-1)[0] ?? null

  let runningId: string | null = null
  if (active) {
    if (current && historyMap.get(current)?.status !== 'done') {
      runningId = current
    } else {
      for (const p of data.plan) {
        if (p.phase === 'net') {
          const checkId = p.id.replace(/^net_/, '')
          const check = data.checks[checkId]
          if (check?.ok || completed.has(p.id)) continue
          runningId = p.id
          break
        }
        if (historyMap.get(p.id)?.status === 'done' || completed.has(p.id)) {
          continue
        }
        runningId = p.id
        break
      }
    }
  }

  return data.plan.map((p) => {
    let stepStatus: ProgressStepStatus = 'pending'
    let detail: string | null = null
    const hist = historyMap.get(p.id)

    if (status === 'ok') {
      const checkId = p.phase === 'net' ? p.id.replace(/^net_/, '') : null
      const check = checkId ? data.checks[checkId] : null
      return {
        id: p.id,
        label: p.label,
        status: 'done' as const,
        detail: check?.message ?? hist?.note ?? 'OK',
      }
    }

    if (p.phase === 'net') {
      const checkId = p.id.replace(/^net_/, '')
      const check = data.checks[checkId]
      if (check?.ok === true) {
        stepStatus = 'done'
        detail = check.message ?? 'OK'
      } else if (check && check.ok === false && status === 'fail') {
        stepStatus = 'error'
        detail = check.message ?? 'Falló'
      } else if (check && check.ok === false) {
        stepStatus = p.id === runningId ? 'running' : 'pending'
        detail = check.message ?? (p.id === runningId ? 'En curso…' : 'Pendiente')
      } else if (completed.has(p.id) && !check) {
        stepStatus = 'done'
        detail = 'OK'
      } else if (p.id === runningId) {
        stepStatus = 'running'
        detail = check?.message ?? lastNotes ?? 'En curso…'
      } else {
        detail = 'Pendiente'
      }
      return { id: p.id, label: p.label, status: stepStatus, detail }
    }

    // ACS / OLT: historial real. Nunca marcar en masa como "Omitido".
    if (hist?.status === 'done' || completed.has(p.id)) {
      stepStatus = 'done'
      detail = hist?.note ?? 'OK'
    } else if (
      hist?.status === 'error' ||
      (status === 'fail' && p.id === current)
    ) {
      stepStatus = 'error'
      detail = hist?.note ?? lastNotes ?? 'Falló aquí'
    } else if (hist?.status === 'skipped') {
      stepStatus = 'skipped'
      detail = hist.note ?? 'No requerido'
    } else if (p.id === runningId) {
      stepStatus = 'running'
      detail = lastNotes ?? 'En curso…'
    } else if (status === 'fail') {
      stepStatus = 'pending'
      detail = 'No ejecutado'
    } else {
      detail = 'Pendiente'
    }

    return { id: p.id, label: p.label, status: stepStatus, detail }
  })
}

/**
 * Modal de avance alineado al progressPlan del driver ONU.
 * Se puede cerrar mientras corre (el poller sigue en background).
 */
export function OnuProvisionProgressModal({
  open,
  onuId,
  title = 'Aprovisionamiento ONU',
  /** Si true, al abrir dispara POST verify/run una vez (Check ONU). */
  runCheckOnOpen = false,
  onClose,
  onFinished,
}: {
  open: boolean
  onuId: string
  title?: string
  runCheckOnOpen?: boolean
  onClose: () => void
  onFinished?: (status: string) => void
}) {
  const [steps, setSteps] = useState<ProgressStep[]>([])
  const [verifyStatus, setVerifyStatus] = useState('test')
  const [driverId, setDriverId] = useState<string | null>(null)
  const [healed, setHealed] = useState<string[]>([])
  const [failureSummary, setFailureSummary] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [runningCheck, setRunningCheck] = useState(false)
  const checkStarted = useRef(false)
  const finishedNotified = useRef(false)

  const refresh = useCallback(async () => {
    if (!onuId) return
    try {
      const data = await apiFetch<OnuVerifyProgressResponse>(
        `/app/onus/${onuId}/verify/progress`,
      )
      setDriverId(data.driverId)
      setVerifyStatus(data.verifyStatus)
      setHealed(data.healed ?? [])
      setFailureSummary(data.failureSummary?.trim() || null)
      setSteps(mapOnuVerifyProgressSteps(data))
      setError(null)
      if (
        (data.verifyStatus === 'ok' || data.verifyStatus === 'fail') &&
        !finishedNotified.current
      ) {
        finishedNotified.current = true
        onFinished?.(data.verifyStatus)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [onuId, onFinished])

  useEffect(() => {
    if (!open) {
      checkStarted.current = false
      finishedNotified.current = false
      return
    }
    void refresh()
    const t = window.setInterval(() => {
      void refresh()
    }, 800)
    return () => window.clearInterval(t)
  }, [open, refresh])

  useEffect(() => {
    if (!open || !runCheckOnOpen || checkStarted.current) return
    checkStarted.current = true
    setRunningCheck(true)
    void (async () => {
      try {
        await apiFetch(`/app/onus/${onuId}/verify/run`, { method: 'POST' })
        finishedNotified.current = false
        await refresh()
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setRunningCheck(false)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional once-per-open
  }, [open, runCheckOnOpen, onuId])

  const allDone = verifyStatus === 'ok'
  const failed = verifyStatus === 'fail'
  const running = verifyStatus === 'test' || runningCheck

  return (
    <OperationProgressModal
      open={open}
      title={title}
      steps={steps}
      running={running}
      failed={failed}
      allDone={allDone}
      doneLabel={
        driverId
          ? `ONU OK · driver ${driverId}`
          : 'ONU OK — aprovisionamiento verificado'
      }
      failedLabel={
        failureSummary
          ? `Chequeo fallido — ${failureSummary}`
          : 'Chequeo fallido — puedes reintentar o seguir en segundo plano'
      }
      closeWhileRunning
      closeLabel={running ? 'Seguir en segundo plano' : 'Cerrar'}
      onRetry={
        failed
          ? () => {
              finishedNotified.current = false
              checkStarted.current = false
              setRunningCheck(true)
              void (async () => {
                try {
                  await apiFetch(`/app/onus/${onuId}/verify/run`, {
                    method: 'POST',
                  })
                  await refresh()
                } catch (e) {
                  setError(e instanceof Error ? e.message : String(e))
                } finally {
                  setRunningCheck(false)
                }
              })()
            }
          : undefined
      }
      onClose={onClose}
    >
      {driverId ? (
        <p className="mx-5 mb-1 text-xs text-[var(--text-muted)]">
          Script: {driverId}
        </p>
      ) : null}
      {healed.length > 0 ? (
        <p className="mx-5 mb-2 text-xs text-amber-200/90">
          Curado: {healed.join('; ')}
        </p>
      ) : null}
      {error ? (
        <p className="mx-5 mb-2 text-xs text-[var(--danger)]">{error}</p>
      ) : null}
      {allDone ? (
        <div className="mx-5 mb-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">
          Todo OK — la ONU pasó el plan del modelo.
        </div>
      ) : null}
    </OperationProgressModal>
  )
}
