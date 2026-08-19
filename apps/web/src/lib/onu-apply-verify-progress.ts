/**
 * Tramo compartido post OLT/IPs: apply ACS + poll del plan del driver +
 * verify VLAN + espera verifyStatus. Misma UX que OnuVlansModal.executeUnified.
 */
import { apiFetch } from './api'
import type { ProgressStep } from '../components/OperationProgressModal'
import {
  mapOnuVerifyProgressSteps,
  type OnuVerifyProgressResponse,
} from '../components/OnuProvisionProgressModal'

export type NetworkVlansBody = {
  mgmtVlanId?: number
  wanVlanId?: number | null
  tr069ProfileId?: string
}

function sleep(ms: number) {
  return new Promise((r) => window.setTimeout(r, ms))
}

export type ApplyVerifyExpect = {
  mgmtVlan?: number | null
  wanVlan?: number | null
  /** Si true y hay wanVlan, exige wanIp en la respuesta de verify. */
  requireWanIp?: boolean
}

export type ApplyVerifyProgressCtl = {
  onuId: string
  body: NetworkVlansBody
  /** Pasos ya completados (authorize/olt/assign/…) que se anteponen al plan. */
  headSteps: ProgressStep[]
  setProgressSteps: (
    update: ProgressStep[] | ((prev: ProgressStep[]) => ProgressStep[]),
  ) => void
  setDriverId?: (id: string | null) => void
  expect?: ApplyVerifyExpect
  waitMs?: number
}

function mergeHeadAndScript(
  head: ProgressStep[],
  script: ProgressStep[],
): ProgressStep[] {
  return [
    ...head.map((s) => ({ ...s, status: 'done' as const })),
    ...script,
  ]
}

/** Poll GET verify/progress y fusiona con head. Devuelve stop(). */
export function startOnuScriptPoll(
  ctl: Pick<
    ApplyVerifyProgressCtl,
    'onuId' | 'headSteps' | 'setProgressSteps' | 'setDriverId'
  > & { headRef: { current: ProgressStep[] } },
): { stop: () => void; tick: () => Promise<OnuVerifyProgressResponse | null> } {
  let timer: number | null = null
  const tick = async () => {
    try {
      const data = await apiFetch<OnuVerifyProgressResponse>(
        `/app/onus/${ctl.onuId}/verify/progress`,
      )
      if (data.driverId) ctl.setDriverId?.(data.driverId)
      ctl.setProgressSteps(
        mergeHeadAndScript(ctl.headRef.current, mapOnuVerifyProgressSteps(data)),
      )
      return data
    } catch {
      return null
    }
  }
  const stop = () => {
    if (timer != null) {
      window.clearInterval(timer)
      timer = null
    }
  }
  return {
    stop,
    tick: async () => {
      const first = await tick()
      if (timer == null) {
        timer = window.setInterval(() => {
          void tick()
        }, 1_500)
      }
      return first
    },
  }
}

export async function waitOnuVerifyDone(
  ctl: Pick<
    ApplyVerifyProgressCtl,
    'onuId' | 'setProgressSteps' | 'setDriverId' | 'waitMs'
  > & { headRef: { current: ProgressStep[] } },
): Promise<string> {
  const deadline = Date.now() + (ctl.waitMs ?? 90_000)
  while (Date.now() < deadline) {
    try {
      const data = await apiFetch<OnuVerifyProgressResponse>(
        `/app/onus/${ctl.onuId}/verify/progress`,
      )
      if (data.driverId) ctl.setDriverId?.(data.driverId)
      ctl.setProgressSteps(
        mergeHeadAndScript(ctl.headRef.current, mapOnuVerifyProgressSteps(data)),
      )
      if (data.verifyStatus === 'ok' || data.verifyStatus === 'fail') {
        return data.verifyStatus
      }
    } catch {
      /* reintento */
    }
    await sleep(1_500)
  }
  return 'test'
}

/**
 * Carga plan del driver, aplica network-vlans/apply (×2), kick soft
 * (verify/kick), verifica VLANs y espera verifyStatus. Actualiza pasos en vivo.
 */
export async function runOnuApplyAndVerify(
  ctl: ApplyVerifyProgressCtl,
): Promise<{
  ok: boolean
  verifyStatus: string
  error?: string
  steps: ProgressStep[]
}> {
  const headRef = {
    current: ctl.headSteps.map((s) => ({ ...s, status: 'done' as const })),
  }
  let lastSteps: ProgressStep[] = headRef.current
  const setSteps = (
    update: ProgressStep[] | ((prev: ProgressStep[]) => ProgressStep[]),
  ) => {
    lastSteps = typeof update === 'function' ? update(lastSteps) : update
    ctl.setProgressSteps(lastSteps)
  }
  const poll = startOnuScriptPoll({
    ...ctl,
    headRef,
    setProgressSteps: setSteps,
  })

  let scriptSteps: ProgressStep[] = [
    {
      id: 'apply',
      label: 'Aplicando a la ONU (OMCI + TR069)',
      status: 'pending',
    },
  ]
  try {
    const data = await apiFetch<OnuVerifyProgressResponse>(
      `/app/onus/${ctl.onuId}/verify/progress`,
    )
    if (data.driverId) ctl.setDriverId?.(data.driverId)
    if (data.plan?.length) {
      scriptSteps = data.plan.map((p) => ({
        id: p.id,
        label: p.label,
        status: 'pending' as const,
      }))
    }
  } catch {
    /* placeholder apply */
  }
  setSteps(mergeHeadAndScript(headRef.current, scriptSteps))
  await poll.tick()

  try {
    let lastErr: unknown = null
    let applyOk = false
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        await apiFetch<{ message?: string }>(
          `/app/onus/${ctl.onuId}/network-vlans/apply`,
          { method: 'POST', body: JSON.stringify(ctl.body) },
        )
        applyOk = true
        break
      } catch (e) {
        lastErr = e
      }
    }
    if (!applyOk) {
      throw new Error(
        `${lastErr instanceof Error ? lastErr.message : String(lastErr)} — 2 intentos fallidos.`,
      )
    }

    // Kick soft (no verify/run): el Check ONU manual fuerza fail si ARP/ACS
    // aún no están listos justo tras el apply; el wizard lo veía OK y el
    // revisador quedaba en fail. kick = cura + mide, fail solo irrecuperable.
    void apiFetch(`/app/onus/${ctl.onuId}/verify/kick`, {
      method: 'POST',
    }).catch(() => undefined)

    const r = await apiFetch<{
      ok: boolean
      message?: string
      mgmtVlanId?: number | null
      wanVlanId?: number | null
      wanIp?: string | null
    }>(`/app/onus/${ctl.onuId}/network-vlans/verify`, { method: 'POST' })

    const exp = ctl.expect
    if (exp?.mgmtVlan != null && r.mgmtVlanId !== exp.mgmtVlan) {
      throw new Error(
        `Mgmt quedó en VLAN ${r.mgmtVlanId ?? '—'}, se esperaba ${exp.mgmtVlan}`,
      )
    }
    if (exp?.requireWanIp && exp.wanVlan != null && !r.wanIp) {
      throw new Error(
        `La ONU quedó en VLAN WAN ${exp.wanVlan} pero sin IP del pool asignada`,
      )
    }
    if (exp?.wanVlan !== undefined && r.wanVlanId !== exp.wanVlan) {
      throw new Error(
        `WAN quedó en VLAN ${r.wanVlanId ?? '—'}, se esperaba ${exp.wanVlan ?? 'ninguna'}`,
      )
    }

    const status = await waitOnuVerifyDone({
      ...ctl,
      headRef,
      setProgressSteps: setSteps,
      waitMs: ctl.waitMs,
    })
    // ok / test (sigue el poller) = aprovisionamiento bien. fail = rotura real.
    return {
      ok: status !== 'fail',
      verifyStatus: status,
      steps: lastSteps,
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    setSteps((prev) => {
      const running = prev.find((s) => s.status === 'running')
      if (!running) {
        const idx = [...prev]
          .reverse()
          .findIndex((s) => s.status === 'pending' || s.status === 'running')
        if (idx < 0) return prev
        const real = prev.length - 1 - idx
        return prev.map((s, i) =>
          i === real
            ? { ...s, status: 'error' as const, detail: message }
            : s,
        )
      }
      return prev.map((s) =>
        s.id === running.id
          ? { ...s, status: 'error' as const, detail: message }
          : s,
      )
    })
    return {
      ok: false,
      verifyStatus: 'fail',
      error: message,
      steps: lastSteps,
    }
  } finally {
    poll.stop()
  }
}
