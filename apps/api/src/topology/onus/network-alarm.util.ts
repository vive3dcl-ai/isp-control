/** Umbral alineado al rojo de Conectadas (`signalBand` poor: < −28 dBm). */
export const RX_POOR_DBM = -28;

/** 3 × Inform 120 s. */
export const INFORM_STALE_MS = 3 * 120_000;

export type AccessAlarmKind = 'onu_los' | 'onu_rx_low' | 'onu_inform_stale';

export type AccessAlarmInput = {
  online: boolean;
  phaseState?: string | null;
  status?: string | null;
  signalDbm?: number | null;
  lastInformAt?: Date | string | null;
  /** Ya existió en ACS (evita Inform stale en ONUs nunca vistas). */
  hadAcsRecord?: boolean;
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

/** Alarmas de acceso que deben estar abiertas para esta ONU. */
export function classifyAccessAlarms(
  input: AccessAlarmInput,
): AccessAlarmKind[] {
  if (isDyingGasp(input.phaseState, input.status)) return [];

  const out: AccessAlarmKind[] = [];
  if (isLosPhase(input.phaseState, input.status)) {
    out.push('onu_los');
  }

  if (input.online) {
    const dbm = input.signalDbm;
    if (dbm != null && Number.isFinite(dbm) && dbm < RX_POOR_DBM) {
      out.push('onu_rx_low');
    }
    const now = input.now ?? Date.now();
    const age = informAgeMs(input.lastInformAt, now);
    if (age != null && age > INFORM_STALE_MS) {
      out.push('onu_inform_stale');
    } else if (age == null && input.hadAcsRecord) {
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
    return `RX peor que ${RX_POOR_DBM} dBm con la ONU en línea.`;
  }
  return 'La OLT ve la ONU online, pero no Informa al ACS.';
}
