import { isOltAdminDisabled } from './onu-service-state.util';

/** Umbral alineado al rojo de Conectadas (`signalBand` poor: < −28 dBm). */
export const RX_POOR_DBM = -28;
/** No alertar RX mala estable: hace falta un movimiento > 1 dB. */
export const RX_CHANGE_DB = 1;
/** Ventana de muestras para decidir si el RX “cambió de verdad”. */
export const RX_CHANGE_WINDOW_MS = 60 * 60_000;

/**
 * Inform periódico típico: 120–300 s. El ACS a menudo tarda varios ciclos.
 * Alerta solo si lleva más de 1 h sin Inform (flota TR-069 usa el mismo piso).
 */
export const INFORM_STALE_MS = 60 * 60_000;

export type AccessAlarmKind = 'onu_los' | 'onu_rx_low' | 'onu_inform_stale';

export type AccessAlarmInput = {
  online: boolean;
  phaseState?: string | null;
  status?: string | null;
  signalDbm?: number | null;
  /** Muestras RX recientes (dBm) para exigir variación > 1 dB. */
  recentSignalDbms?: number[];
  lastInformAt?: Date | string | null;
  adminState?: string | null;
  /** Ya existió en ACS (evita Inform stale en ONUs nunca vistas). */
  hadAcsRecord?: boolean;
  /**
   * Tiene Mgmt IP / perfil TR-069. Sin eso no se espera Inform periódico
   * y no se notifica “ACS sin Inform”.
   */
  acsExpected?: boolean;
  now?: number;
};

const DYING_GASP_RE =
  /dying\s*gasp|dyinggasp|power\s*(off|fail|loss)|pwr\s*los/i;
const LOS_RE = /\blos\b|loss\s*of\s*signal|phase.?los/i;

export function isDyingGasp(
  phaseState?: string | null,
  status?: string | null,
): boolean {
  return DYING_GASP_RE.test(`${phaseState ?? ''} ${status ?? ''}`);
}

export function isLosPhase(
  phaseState?: string | null,
  status?: string | null,
): boolean {
  return LOS_RE.test(`${phaseState ?? ''} ${status ?? ''}`);
}

function informAgeMs(
  lastInformAt: Date | string | null | undefined,
  now: number,
): number | null {
  if (lastInformAt == null) return null;
  const t =
    lastInformAt instanceof Date
      ? lastInformAt.getTime()
      : Date.parse(String(lastInformAt));
  if (!Number.isFinite(t)) return null;
  return now - t;
}

/** RX pobre y con variación reciente > 1 dB (no alerta mala estable). */
export function rxLowShouldAlert(opts: {
  currentDbm: number | null | undefined;
  recentDbms?: number[];
}): boolean {
  const cur = opts.currentDbm;
  if (cur == null || !Number.isFinite(cur) || cur >= RX_POOR_DBM) return false;
  const series = [
    ...(opts.recentDbms ?? []).filter((n) => Number.isFinite(n)),
    cur,
  ];
  if (series.length < 2) return false;
  return Math.max(...series) - Math.min(...series) > RX_CHANGE_DB;
}

/** Alarmas de acceso que deben estar abiertas para esta ONU. */
export function classifyAccessAlarms(
  input: AccessAlarmInput,
): AccessAlarmKind[] {
  if (isDyingGasp(input.phaseState, input.status)) return [];
  if (isOltAdminDisabled(input.adminState)) return [];

  const out: AccessAlarmKind[] = [];
  if (isLosPhase(input.phaseState, input.status)) {
    out.push('onu_los');
  }

  if (input.online) {
    if (
      rxLowShouldAlert({
        currentDbm: input.signalDbm,
        recentDbms: input.recentSignalDbms,
      })
    ) {
      out.push('onu_rx_low');
    }
    const now = input.now ?? Date.now();
    const age = informAgeMs(input.lastInformAt, now);
    const watchInform = input.acsExpected !== false;
    if (watchInform && age != null && age > INFORM_STALE_MS) {
      out.push('onu_inform_stale');
    } else if (watchInform && age == null && input.hadAcsRecord) {
      out.push('onu_inform_stale');
    }
  }

  return out;
}

export function alarmTitle(kind: AccessAlarmKind, sn: string): string {
  if (kind === 'onu_los') return `LOS: ${sn}`;
  if (kind === 'onu_rx_low') return `Señal baja: ${sn}`;
  return `ACS sin Inform: ${sn}`;
}

export function alarmBody(kind: AccessAlarmKind): string {
  if (kind === 'onu_los') {
    return 'Pérdida de señal óptica (sin dying gasp). Posible corte de fibra.';
  }
  if (kind === 'onu_rx_low') {
    return `RX peor que ${RX_POOR_DBM} dBm y varió más de ${RX_CHANGE_DB} dB (no se alerta mala estable).`;
  }
  return 'La OLT ve la ONU online, pero no Informa al ACS desde hace más de 1 h.';
}
