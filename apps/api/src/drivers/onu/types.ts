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
  /**
   * Reaplica service-port / flow L2 de la VLAN de servicio en la OLT.
   * Necesario cuando el ACS muestra ERROR_NO_CARRIER (WAN ACS ok, sin tráfico).
   */
  ensureServiceL2?: () => Promise<OnuOmciTr069Result>;
  enqueueOnly?: boolean;
  /** Persiste avance del script para el modal (poll UI). */
  onProgress?: (
    partial: Partial<OnuProgressState> & { currentStepId?: string | null },
  ) => Promise<void>;
};

/** Estado persistido en verifyDetail.progress (sobrevive ticks del poller). */
export type OnuProgressStepHistoryEntry = {
  id: string;
  status: 'done' | 'error' | 'skipped';
  note?: string;
  at: string;
};

export type OnuProgressState = {
  currentStepId: string | null;
  completed: string[];
  notes: string[];
  /** Historial ordenado de pasos ACS/OLT realmente ejecutados (para el modal). */
  history?: OnuProgressStepHistoryEntry[];
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
  /**
   * false = WAN INTERNET existe pero sin carrier L2
   * (LastConnectionError=ERROR_NO_CARRIER / Connecting).
   */
  serviceCarrierOk?: boolean;
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

/** Quién escribe cada parámetro (Etapa 2). No se persiste: vive en el driver. */
export type OnuParamOwner = 'acs' | 'omci' | 'olt_dba' | 'none';

export type OnuParamOwners = {
  serviceWan: 'acs' | 'omci';
  serviceVlan: 'acs' | 'omci';
  mgmtIp: 'omci';
  acsUrl: 'omci';
  tcont: 'olt_dba';
  nat: 'acs' | 'none';
  lanBind: 'acs' | 'none';
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
  /** Si `serviceVlan === 'omci'`, el SPV no escribe hoja VLAN. */
  owners?: OnuParamOwners;
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
  | 'lanBind'
  | 'traffic';

export type OnuVerifyChecksPlan = Partial<
  Record<OnuVerifyCheckId, OnuVerifyCheckMode>
>;

/** Suite por defecto (= comportamiento histórico del poller). */
export const DEFAULT_VERIFY_CHECKS: Record<OnuVerifyCheckId, OnuVerifyCheckMode> =
  {
    arp: 'skip',
    connreq: 'required',
    wan: 'required',
    dns: 'required',
    route: 'required',
    uplinkVlan: 'required',
    lanBind: 'required',
    traffic: 'optional',
  };

/** TR-098 Huawei/FiberHome: route TR-181 no aplica.
 *  connreq es optional: en Huawei el user fábrica `acs` hace flaquear el CR
 *  (401↔ok) y tumbaría el veredicto aunque WAN+DNS ya demuestren servicio. */
export const TR098_VERIFY_CHECKS: OnuVerifyChecksPlan = {
  ...DEFAULT_VERIFY_CHECKS,
  route: 'skip',
  connreq: 'optional',
};

export function resolveOmciPlan(driver: OnuDriver | null | undefined): OnuOmciPlan {
  if (driver?.paramOwners?.serviceWan === 'acs') {
    return { serviceWanOmci: 'skip' };
  }
  if (driver?.paramOwners?.serviceWan === 'omci') {
    return { serviceWanOmci: 'apply' };
  }
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
  const plan: Record<OnuVerifyCheckId, OnuVerifyCheckMode> = {
    ...DEFAULT_VERIFY_CHECKS,
    ...(driver?.verifyChecks ?? {}),
  };
  const lanBindOwner =
    driver?.paramOwners?.lanBind ??
    (resolveOmciPlan(driver).serviceWanOmci === 'skip' ? 'acs' : 'none');
  if (lanBindOwner === 'none') {
    plan.lanBind = 'skip';
  }
  return plan;
}

export function verifyCheckMode(
  checks: Record<OnuVerifyCheckId, OnuVerifyCheckMode>,
  id: OnuVerifyCheckId,
): OnuVerifyCheckMode {
  return checks[id] ?? 'required';
}

/** Paso visible en el modal de avance (ACS o probe de red). */
export type OnuProgressStepPhase = 'acs' | 'olt' | 'net';

export type OnuProgressStepDef = {
  id: string;
  label: string;
  phase: OnuProgressStepPhase;
};

const NET_CHECK_LABELS: Record<OnuVerifyCheckId, string> = {
  arp: 'ARP',
  connreq: 'Credenciales de administración',
  wan: 'WAN internet',
  dns: 'DNS',
  route: 'Ruta por defecto / WAN legacy (TR-181)',
  uplinkVlan: 'VLAN WAN en uplink de la OLT',
  lanBind: 'Bind NAT',
  traffic: 'Internet',
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
    'wan',
    'dns',
    'route',
    'uplinkVlan',
    'lanBind',
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
    history: partial?.history ?? [],
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
  const notes = [...(prev?.notes ?? []), ...(next.notes ?? [])].slice(-40);
  const history = [
    ...(prev?.history ?? []),
    ...(next.history ?? []),
  ].slice(-40);
  return {
    currentStepId: next.currentStepId ?? prev?.currentStepId ?? null,
    completed,
    notes,
    history,
    updatedAt: new Date().toISOString(),
  };
}

export interface OnuDriver {
  id: string;
  brand: OnuBrand;
  matches(ctx: OnuModelProvisionMatchCtx): boolean;
  /** Política OMCI de servicio (preferido). */
  omciPlan?: OnuOmciPlan;
  /** Dueños por parámetro (Etapa 2). Si falta, se deriva de omciPlan. */
  paramOwners?: Partial<OnuParamOwners>;
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
