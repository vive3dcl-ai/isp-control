/**
 * Orquestador de aprovisionamiento HG8145X6: pasos en serie, uno a uno.
 *
 * CR fábrica (`acs`+401) NO bloquea la WAN: se encola password y se sigue
 * con WCD→WANIP→SPV vía Inform. Si el agente no Informa, OMCI+reboot.
 */
import type {
  OnuModelProvisionCtx,
  OnuModelProvisionResult,
} from '../../types';
import { isServiceWanApplied } from './wan';
import {
  ensureConnReq,
  ensureInform,
  ensureMgmtReady,
  ensureOmciTr069,
  ensureReachable,
  ensureServiceL2,
  ensureServiceSpv,
  ensureServiceWanIp,
  ensureServiceWcd,
  hg8145InformAlive,
  type Hg8145StepResult,
} from './steps';
import { huaweiInternetCarrierOk } from '../../infra/huawei-carrier';

const PREP_STEPS: Array<{
  id: string;
  run: (ctx: OnuModelProvisionCtx) => Promise<Hg8145StepResult>;
}> = [
  { id: 'ensure_connreq', run: ensureConnReq },
  { id: 'ensure_inform', run: ensureInform },
  { id: 'ensure_reachable', run: ensureReachable },
  { id: 'ensure_mgmt_ready', run: ensureMgmtReady },
];

const WAN_ONLY_STEPS: Array<{
  id: string;
  run: (ctx: OnuModelProvisionCtx) => Promise<Hg8145StepResult>;
}> = [
  { id: 'ensure_service_wcd', run: ensureServiceWcd },
  { id: 'ensure_service_wanip', run: ensureServiceWanIp },
  { id: 'ensure_service_spv', run: ensureServiceSpv },
  { id: 'ensure_service_l2', run: ensureServiceL2 },
];

const ALL_ACS_STEP_IDS = [
  ...PREP_STEPS.map((s) => s.id),
  'ensure_omci_tr069',
  ...WAN_ONLY_STEPS.map((s) => s.id),
];

async function runSteps(
  ctx: OnuModelProvisionCtx,
  steps: Array<{
    id: string;
    run: (ctx: OnuModelProvisionCtx) => Promise<Hg8145StepResult>;
  }>,
  headNote: string,
  priorCompleted: string[] = [],
): Promise<OnuModelProvisionResult> {
  const notes: string[] = [headNote];
  const completed: string[] = [...priorCompleted];
  for (const step of steps) {
    await ctx.onProgress?.({
      currentStepId: step.id,
      completed: [...completed],
      notes: [`→ ${step.id}`],
    });
    try {
      const fresh = await ctx.client.findBySerial(ctx.sn);
      if (fresh) ctx.device = fresh;
    } catch {
      /* keep */
    }
    const result = await step.run(ctx);
    notes.push(...result.notes);
    const stepNote = result.notes.filter(Boolean).join(' · ').slice(0, 240);
    if (!result.ok || result.halt) {
      await ctx.onProgress?.({
        currentStepId: step.id,
        completed: [...completed],
        notes: result.notes.slice(-3),
        history: [
          {
            id: step.id,
            status: result.ok ? 'done' : 'error',
            note: stepNote || undefined,
            at: new Date().toISOString(),
          },
        ],
      });
      return {
        ok: result.ok,
        notes,
        progress: {
          currentStepId: step.id,
          completed: [...completed],
          notes: result.notes,
          history: [
            {
              id: step.id,
              status: result.ok ? 'done' : 'error',
              note: stepNote || undefined,
              at: new Date().toISOString(),
            },
          ],
        },
      };
    }
    completed.push(step.id);
    await ctx.onProgress?.({
      currentStepId: step.id,
      completed: [...completed],
      notes: result.notes.slice(-2),
      history: [
        {
          id: step.id,
          status: 'done',
          note: stepNote || undefined,
          at: new Date().toISOString(),
        },
      ],
    });
  }
  await ctx.onProgress?.({
    currentStepId: null,
    completed: [...completed],
    notes: ['ACS listo'],
  });
  return {
    ok: true,
    notes,
    progress: {
      currentStepId: null,
      completed: [...completed],
      notes: ['ACS listo'],
    },
  };
}

export async function provisionHg8145x6(
  ctx: OnuModelProvisionCtx,
): Promise<OnuModelProvisionResult> {
  if (isServiceWanApplied(ctx.device, ctx.wan)) {
    if (huaweiInternetCarrierOk(ctx.device) === false) {
      await ctx.onProgress?.({
        currentStepId: 'ensure_service_l2',
        completed: ALL_ACS_STEP_IDS.filter((id) => id !== 'ensure_service_l2'),
        notes: ['→ ensure_service_l2 (ERROR_NO_CARRIER)'],
      });
      const l2 = await ensureServiceL2(ctx);
      return {
        ok: l2.ok,
        notes: [
          'script huawei-hg8145x6',
          `WAN INTERNET en vlan=${ctx.wan.wanVlan} ip=${ctx.wan.wanIp}`,
          ...l2.notes,
        ],
        progress: {
          currentStepId: 'ensure_service_l2',
          completed: ALL_ACS_STEP_IDS.filter((id) => id !== 'ensure_service_l2'),
          notes: l2.notes,
        },
      };
    }
    const notes = [
      'script huawei-hg8145x6',
      `WAN INTERNET ya en vlan=${ctx.wan.wanVlan} ip=${ctx.wan.wanIp}`,
    ];
    await ctx.onProgress?.({
      currentStepId: null,
      completed: ALL_ACS_STEP_IDS,
      notes,
    });
    return {
      ok: true,
      notes,
      progress: {
        currentStepId: null,
        completed: ALL_ACS_STEP_IDS,
        notes,
      },
    };
  }

  const prep = await runSteps(ctx, PREP_STEPS, 'script huawei-hg8145x6');
  // halt a mitad de prep (p. ej. bootstrap sin hoja MS → reboot)
  if (!prep.ok || prep.progress?.currentStepId) {
    return prep;
  }

  // Agente muerto: OMCI ip-host+ACS y reboot antes de encolar WAN.
  const reachable = await ctx.isReachable().catch(() => false);
  if (!reachable && !hg8145InformAlive(ctx.device) && ctx.ensureOmciTr069) {
    await ctx.onProgress?.({
      currentStepId: 'ensure_omci_tr069',
      completed: prep.progress?.completed ?? [],
      notes: ['→ ensure_omci_tr069'],
    });
    const omci = await ensureOmciTr069(ctx);
    const notes = [...prep.notes, ...omci.notes];
    return {
      ok: omci.ok,
      notes,
      progress: {
        currentStepId: 'ensure_omci_tr069',
        completed: prep.progress?.completed ?? [],
        notes: omci.notes,
      },
    };
  }

  const head =
    prep.notes.filter((n) => n !== 'ACS listo').slice(0, 1)[0] ??
    'script huawei-hg8145x6';
  return runSteps(
    ctx,
    WAN_ONLY_STEPS,
    head,
    prep.progress?.completed ?? PREP_STEPS.map((s) => s.id),
  );
}

/** Solo pasos WAN (cuando mgmt/CR ya están). */
export async function ensureHg8145x6ServiceWan(
  ctx: OnuModelProvisionCtx,
): Promise<OnuModelProvisionResult> {
  if (isServiceWanApplied(ctx.device, ctx.wan)) {
    return {
      ok: true,
      notes: [
        'script huawei-hg8145x6 (WCD→WANIP→SPV)',
        'WAN INTERNET ya aplicada',
      ],
    };
  }
  return runSteps(
    ctx,
    WAN_ONLY_STEPS,
    'script huawei-hg8145x6 (WCD→WANIP→SPV)',
  );
}
