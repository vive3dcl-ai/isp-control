/**
 * Contrato del driver ONU (ACS / TR-069) — un paquete por modelo.
 *
 * Capas:
 * - `drivers/olt/*`     → authorize, OMCI mgmt, SNMP (por TIPO de OLT)
 * - `drivers/onu/models/*` → política OMCI + provision ACS + verify suite
 * - `drivers/onu/infra/*`  → primitivas (creds, SN→vendor, datamodel TR-098/181)
 * - `topology/onus/*`   → elige driver, ejecuta primitivas OLT pedidas, probes util
 *
 * @see docs/onu-model-provision.md
 */
import type { GenieAcsNbiClient } from '../../topology/shared/genieacs-nbi.client';
import type { WanConnectionRef } from './infra/wan-datamodel';

export type OnuBrand = 'huawei' | 'zte' | 'fiberhome' | 'unknown';

export type OnuModelProvisionWanPlan = {
  wanIp: string;
  wanVlan: number;
  wanGateway: string;
  wanMask: string;
  wanDns1: string;
  wanDns2: string | null;
};

export type OnuModelProvisionMatchCtx = {
  sn: string;
  onuType?: string | null;
  acsModel?: string | null;
};

export type OnuModelRebootResult = {
  ok: boolean;
  note: string;
  skipped?: boolean;
};

export type OnuOmciTr069Result = {
  ok: boolean;
  notes: string[];
};

export type OnuModelProvisionCtx = OnuModelProvisionMatchCtx & {
  client: GenieAcsNbiClient;
  deviceId: string;
  device: Record<string, unknown>;
  wan: OnuModelProvisionWanPlan;
  mgmtIp?: string | null;
  serviceVlan: number;
  explicit: boolean;
  preloadConnReq: () => Promise<string>;
  reboot: (opts?: { force?: boolean }) => Promise<OnuModelRebootResult>;
  isReachable: () => Promise<boolean>;
  /**
   * Reaplica OMCI ip-host + tr069-mgmt (ACS URL/VLAN).
   * Necesario cuando el agente TR-069 dejó de Informar tras reboot.
   */
  ensureOmciTr069?: () => Promise<OnuOmciTr069Result>;
  enqueueOnly?: boolean;
  /** Persiste avance del script para el modal (poll UI). */
  onProgress?: (
    partial: Partial<OnuProgressState> & { currentStepId?: string | null },
  ) => Promise<void>;
};

/** Estado persistido en verifyDetail.progress (sobrevive ticks del poller). */
export type OnuProgressState = {
  currentStepId: string | null;
  completed: string[];
  notes: string[];
  updatedAt: string;
};

export type OnuModelProvisionResult = {
  ok: boolean;
  notes: string[];
  /** Actualización de avance para el modal (topology la persiste en verifyDetail). */
  progress?: Partial<OnuProgressState> & { currentStepId?: string | null };
};

export type OnuHealGaps = {
  connreqOurs?: boolean;
  informOk?: boolean;
  /** false = `_lastInform` viejo / ausente (cola ACS no drena). */
  informAlive?: boolean;
  reachable?: boolean;
  mgmtReady?: boolean;
  hasServiceWan?: boolean;
  serviceWanOk?: boolean;
};

export type OnuVerifyHealCtx = OnuModelProvisionCtx & {
  gaps: OnuHealGaps;
};

/** @deprecated Use OnuVerifyHealCtx */
export type OnuHealOneCtx = OnuVerifyHealCtx;

export type ResolveServiceWanOpts = {
  mgmtIp?: string | null;
  expectedIp?: string | null;
  expectedVlanId?: number | null;
};

export type ApplyServiceSpvParams = {
  client: GenieAcsNbiClient;
  deviceId: string;
  device: Record<string, unknown>;
  sn: string;
  wan: OnuModelProvisionWanPlan;
  found: WanConnectionRef;
  priorNotes?: string[];
  onEnqueued?: () => Promise<string | null>;
};

/** Política OMCI de servicio (CLI lo ejecuta el driver OLT). */
export type OnuOmciPlan = {
  /** wan-ip OMCI de servicio: skip (ACS posee WAN) | apply (OLT primero). */
  serviceWanOmci: 'skip' | 'apply';
};

/**
 * Checks de verify post-provision.
 * - required: debe OK para veredicto ok/fail
 * - optional: se mide; no tumba essentials (p. ej. traffic)
 * - skip: no se corre ni se exige
 */
export type OnuVerifyCheckMode = 'required' | 'optional' | 'skip';

export type OnuVerifyCheckId =
  | 'arp'
  | 'connreq'
  | 'wan'
  | 'dns'
  | 'route'
  | 'uplinkVlan'
  | 'traffic';

export type OnuVerifyChecksPlan = Partial<
  Record<OnuVerifyCheckId, OnuVerifyCheckMode>
>;

/** Suite por defecto (= comportamiento histórico del poller). */
export const DEFAULT_VERIFY_CHECKS: Record<OnuVerifyCheckId, OnuVerifyCheckMode> =
  {
    arp: 'required',
    connreq: 'required',
    wan: 'required',
    dns: 'required',
    route: 'required',
    uplinkVlan: 'required',
    traffic: 'optional',
  };

/** TR-098 Huawei/FiberHome: route TR-181 no aplica.
 *  connreq es optional: en Huawei el user fábrica `acs` hace flaquear el CR
 *  (401↔ok) y tumbaría el veredicto aunque ARP+WAN ya demuestren servicio. */
export const TR098_VERIFY_CHECKS: OnuVerifyChecksPlan = {
  ...DEFAULT_VERIFY_CHECKS,
  route: 'skip',
  connreq: 'optional',
};

export function resolveOmciPlan(driver: OnuDriver | null | undefined): OnuOmciPlan {
  if (driver?.omciPlan) return driver.omciPlan;
  if (driver?.skipOmciServiceWan) return { serviceWanOmci: 'skip' };
  return { serviceWanOmci: 'apply' };
}

export function driverSkipsOmciServiceWan(
  driver: OnuDriver | null | undefined,
): boolean {
  return resolveOmciPlan(driver).serviceWanOmci === 'skip';
}

export function resolveVerifyChecks(
  driver: OnuDriver | null | undefined,
): Record<OnuVerifyCheckId, OnuVerifyCheckMode> {
  const plan = driver?.verifyChecks ?? {};
  return { ...DEFAULT_VERIFY_CHECKS, ...plan };
}

export function verifyCheckMode(
  checks: Record<OnuVerifyCheckId, OnuVerifyCheckMode>,
  id: OnuVerifyCheckId,
): OnuVerifyCheckMode {
  return checks[id] ?? 'required';
}

/** Paso visible en el modal de avance (ACS o probe de red). */
export type OnuProgressStepPhase = 'acs' | 'net';

export type OnuProgressStepDef = {
  id: string;
  label: string;
  phase: OnuProgressStepPhase;
};

const NET_CHECK_LABELS: Record<OnuVerifyCheckId, string> = {
  arp: 'ARP en el router del gateway',
  connreq: 'Credenciales de petición de conexión',
  wan: 'WAN TR-069 (IP, máscara, gateway, VLAN)',
  dns: 'DNS de la WAN',
  route: 'Ruta por defecto / WAN legacy (TR-181)',
  uplinkVlan: 'VLAN WAN en uplink de la OLT',
  traffic: 'Internet (WAN + ARP / bytes)',
};

/** Pasos net a partir de verifyChecks (omite skip). */
export function netStepsFromVerifyChecks(
  checks: OnuVerifyChecksPlan | Record<OnuVerifyCheckId, OnuVerifyCheckMode>,
): OnuProgressStepDef[] {
  const resolved: Record<OnuVerifyCheckId, OnuVerifyCheckMode> = {
    ...DEFAULT_VERIFY_CHECKS,
    ...checks,
  };
  const order: OnuVerifyCheckId[] = [
    'connreq',
    'arp',
    'wan',
    'dns',
    'route',
    'uplinkVlan',
    'traffic',
  ];
  return order
    .filter((id) => resolved[id] !== 'skip')
    .map((id) => ({
      id: `net_${id}`,
      label: NET_CHECK_LABELS[id],
      phase: 'net' as const,
    }));
}

export function resolveProgressPlan(
  driver: OnuDriver | null | undefined,
): OnuProgressStepDef[] {
  if (driver?.progressPlan?.length) return driver.progressPlan;
  return netStepsFromVerifyChecks(resolveVerifyChecks(driver));
}

export function emptyProgressState(
  partial?: Partial<OnuProgressState>,
): OnuProgressState {
  return {
    currentStepId: partial?.currentStepId ?? null,
    completed: partial?.completed ?? [],
    notes: partial?.notes ?? [],
    updatedAt: partial?.updatedAt ?? new Date().toISOString(),
  };
}

export function mergeProgressState(
  prev: OnuProgressState | null | undefined,
  next: Partial<OnuProgressState> & { currentStepId?: string | null },
): OnuProgressState {
  const completed = [
    ...new Set([...(prev?.completed ?? []), ...(next.completed ?? [])]),
  ];
  const notes = [...(prev?.notes ?? []), ...(next.notes ?? [])].slice(-20);
  return {
    currentStepId: next.currentStepId ?? prev?.currentStepId ?? null,
    completed,
    notes,
    updatedAt: new Date().toISOString(),
  };
}

export interface OnuDriver {
  id: string;
  brand: OnuBrand;
  matches(ctx: OnuModelProvisionMatchCtx): boolean;
  /** Política OMCI de servicio (preferido). */
  omciPlan?: OnuOmciPlan;
  /**
   * @deprecated Prefer `omciPlan.serviceWanOmci === 'skip'`.
   * Se sigue leyendo si no hay omciPlan.
   */
  skipOmciServiceWan?: boolean;
  /** Qué probes cuentan para el OK de este modelo. */
  verifyChecks?: OnuVerifyChecksPlan;
  /** Pasos del modal de avance (ACS + net). */
  progressPlan?: OnuProgressStepDef[];
  ownsWanSelection?(ctx: OnuModelProvisionMatchCtx): boolean;
  /** Plan ACS completo (alias preferido: provisionPipeline). */
  provision?(ctx: OnuModelProvisionCtx): Promise<OnuModelProvisionResult>;
  provisionPipeline?(
    ctx: OnuModelProvisionCtx,
  ): Promise<OnuModelProvisionResult>;
  ensureServiceWan(ctx: OnuModelProvisionCtx): Promise<OnuModelProvisionResult>;
  diagnoseGaps?(
    device: Record<string, unknown>,
    wan: OnuModelProvisionWanPlan,
    opts?: { mgmtIp?: string | null; reachable?: boolean },
  ): OnuHealGaps;
  verifyHeal?(ctx: OnuVerifyHealCtx): Promise<OnuModelProvisionResult>;
  /** @deprecated Use verifyHeal */
  healOne?(ctx: OnuVerifyHealCtx): Promise<OnuModelProvisionResult>;
  resolveServiceWan(
    device: Record<string, unknown>,
    opts: ResolveServiceWanOpts,
  ): WanConnectionRef | null;
  applyServiceSpv?(params: ApplyServiceSpvParams): Promise<string>;
  supportsTr181RouteHeal?: boolean;
}

/** @deprecated Use OnuDriver */
export type OnuModelProvisionHandler = OnuDriver;
