/**
 * Elementos editables del Mapa de red. Por ahora son borradores locales
 * (sin API); cada tipo tendrá su propio formulario en una etapa posterior.
 */
export const MAP_ELEMENT_TYPES = [
  'nap',
  'splitter',
  'pole',
  'mufa',
  'cable',
  'drop',
  'zone',
] as const

export type MapElementType = (typeof MAP_ELEMENT_TYPES)[number]

export const mapElementLabel: Record<MapElementType, string> = {
  nap: 'NAP',
  splitter: 'Splitter',
  pole: 'Poste',
  mufa: 'Mufa',
  cable: 'Cable',
  drop: 'Drop',
  zone: 'Zona',
}

export const mapElementColor: Record<MapElementType, string> = {
  nap: '#7c3aed',
  splitter: '#0891b2',
  pole: '#65a30d',
  mufa: '#1e293b',
  cable: '#0f172a',
  drop: '#94a3b8',
  zone: '#3b82f6',
}

/** Color por defecto y presets al crear una zona. */
export const DEFAULT_ZONE_COLOR = '#3b82f6'

export const ZONE_COLOR_PRESETS = [
  '#3b82f6',
  '#22c55e',
  '#eab308',
  '#f97316',
  '#ef4444',
  '#a855f7',
  '#14b8a6',
  '#64748b',
] as const

/** Ratios de salida de splitters dentro de una NAP. */
export const SPLITTER_RATIOS = [2, 4, 8, 16, 36] as const
export type SplitterRatio = (typeof SPLITTER_RATIOS)[number]

export function isSplitterRatio(n: number): n is SplitterRatio {
  return (SPLITTER_RATIOS as readonly number[]).includes(n)
}

/**
 * Paleta base de colores usados por las normas de identificación de fibra.
 * Las normas definen el orden; los hex son una representación visual común.
 */
export const FIBER_COLOR_PALETTE = {
  blue: { color: '#2563eb', name: 'Azul' },
  orange: { color: '#f97316', name: 'Naranja' },
  green: { color: '#16a34a', name: 'Verde' },
  brown: { color: '#92400e', name: 'Marrón' },
  slate: { color: '#94a3b8', name: 'Gris' },
  white: { color: '#f8fafc', name: 'Blanco' },
  red: { color: '#dc2626', name: 'Rojo' },
  black: { color: '#0f172a', name: 'Negro' },
  yellow: { color: '#eab308', name: 'Amarillo' },
  violet: { color: '#9333ea', name: 'Violeta' },
  rose: { color: '#ec4899', name: 'Rosa' },
  aqua: { color: '#22d3ee', name: 'Aqua' },
  turquoise: { color: '#14b8a6', name: 'Turquesa' },
  pink: { color: '#f472b6', name: 'Rosa' },
} as const

export type FiberColorKey = keyof typeof FIBER_COLOR_PALETTE

export type FiberColorNormId =
  | 'tia598'
  | 'iec60304'
  | 'iec60794'
  | 's12'
  | 'fin2012'
  | 'typeE'

export type FiberColorNorm = {
  id: FiberColorNormId
  label: string
  shortLabel: string
  region: string
  /** Secuencia de 12 colores (pelos y minitubos). */
  sequence: readonly FiberColorKey[]
}

/**
 * Normas de identificación de pelos / minitubos.
 * Fuente: FOA Color Codes Cross Reference + Hexatronic.
 * La norma es del cable completo; cada minitubo repite la misma secuencia.
 */
export const FIBER_COLOR_NORMS: readonly FiberColorNorm[] = [
  {
    id: 'tia598',
    label: 'TIA-598 / ISO 11801',
    shortLabel: 'TIA-598',
    region: 'América · global',
    sequence: [
      'blue',
      'orange',
      'green',
      'brown',
      'slate',
      'white',
      'red',
      'black',
      'yellow',
      'violet',
      'rose',
      'aqua',
    ],
  },
  {
    id: 'iec60304',
    label: 'IEC 60304 / DIN-0888',
    shortLabel: 'IEC / DIN',
    region: 'Europa · Alemania',
    sequence: [
      'red',
      'green',
      'blue',
      'yellow',
      'white',
      'slate',
      'brown',
      'violet',
      'turquoise',
      'black',
      'orange',
      'pink',
    ],
  },
  {
    id: 'iec60794',
    label: 'IEC 60794-2',
    shortLabel: 'IEC 60794',
    region: 'Europa (cables)',
    sequence: [
      'blue',
      'yellow',
      'red',
      'white',
      'green',
      'violet',
      'orange',
      'slate',
      'aqua',
      'black',
      'brown',
      'pink',
    ],
  },
  {
    id: 's12',
    label: 'S12 (Suecia)',
    shortLabel: 'S12',
    region: 'Suecia · Nordics',
    sequence: [
      'red',
      'blue',
      'white',
      'green',
      'yellow',
      'slate',
      'brown',
      'black',
      'violet',
      'orange',
      'turquoise',
      'pink',
    ],
  },
  {
    id: 'fin2012',
    label: 'FIN 2012',
    shortLabel: 'FIN 2012',
    region: 'Finlandia',
    sequence: [
      'blue',
      'white',
      'yellow',
      'green',
      'slate',
      'orange',
      'brown',
      'turquoise',
      'black',
      'violet',
      'pink',
      'red',
    ],
  },
  {
    id: 'typeE',
    label: 'Standard Type E (Telia/Ericsson)',
    shortLabel: 'Type E',
    region: 'Suecia (legacy)',
    sequence: [
      'red',
      'blue',
      'white',
      'green',
      'yellow',
      'slate',
      'brown',
      'black',
      'orange',
      'violet',
      'pink',
      'turquoise',
    ],
  },
] as const

export const DEFAULT_FIBER_COLOR_NORM: FiberColorNormId = 'tia598'

/** @deprecated Preferir FIBER_COLOR_NORMS / colorCodeAt(norm). */
export const FIBER_COLOR_CODE = FIBER_COLOR_NORMS[0].sequence.map(
  (k) => FIBER_COLOR_PALETTE[k],
)

/**
 * Al pasar de 12 elementos la secuencia se repite con una traza (anillo o
 * franja): 13–24 negra, 25–36 naranja, 37–48 verde.
 */
export const TRACER_COLORS = [
  { color: '#0f172a', name: 'traza negra' },
  { color: '#f97316', name: 'traza naranja' },
  { color: '#16a34a', name: 'traza verde' },
] as const

/** Sobre elemento negro la traza negra no se ve: blanco en pelo, amarillo en tubo. */
const BLACK = '#0f172a'
const TRACER_ON_BLACK_FIBER = { color: '#f8fafc', name: 'traza blanca' }
const TRACER_ON_BLACK_TUBE = { color: '#eab308', name: 'traza amarilla' }

export type ColorCode = {
  color: string
  name: string
  tracer: string | null
}

export function isFiberColorNormId(v: string): v is FiberColorNormId {
  return FIBER_COLOR_NORMS.some((n) => n.id === v)
}

export function getFiberColorNorm(
  id: FiberColorNormId | string | null | undefined,
): FiberColorNorm {
  const found = FIBER_COLOR_NORMS.find((n) => n.id === id)
  return found ?? FIBER_COLOR_NORMS.find((n) => n.id === DEFAULT_FIBER_COLOR_NORM)!
}

/** Color según la norma del cable en la posición dada (0-based), con traza si supera 12. */
export function colorCodeAt(
  index: number,
  forTube = false,
  normId: FiberColorNormId | string | null | undefined = DEFAULT_FIBER_COLOR_NORM,
): ColorCode {
  const norm = getFiberColorNorm(normId)
  const seq = norm.sequence
  const i = Math.max(0, Math.floor(index))
  const key = seq[i % seq.length]
  const base = FIBER_COLOR_PALETTE[key]
  const group = Math.floor(i / seq.length)
  if (group === 0) {
    return { color: base.color, name: base.name, tracer: null }
  }
  let tracer = TRACER_COLORS[(group - 1) % TRACER_COLORS.length]
  if (base.color === BLACK && tracer.color === BLACK) {
    tracer = forTube ? TRACER_ON_BLACK_TUBE : TRACER_ON_BLACK_FIBER
  }
  return {
    color: base.color,
    name: `${base.name} · ${tracer.name}`,
    tracer: tracer.color,
  }
}

/** Fondo CSS de un pelo/tubo: color liso o con franja de traza. */
export function strandBackground(color: string, tracer?: string | null) {
  if (!tracer) return color
  return `repeating-linear-gradient(135deg, ${color} 0 5px, ${tracer} 5px 8px)`
}

export type FiberStrand = {
  id: string
  name: string
  description: string
  color: string
  /** Color de la traza (anillo) cuando el pelo pasa del 12 en su tubo. */
  tracer?: string | null
}

/** Buffer tube / minitubo: agrupa pelos dentro del cable. */
export type MiniTube = {
  id: string
  name: string
  color: string
  /** Color de la franja cuando el tubo pasa del 12 en el cable. */
  tracer?: string | null
  fibers: FiberStrand[]
}

/** Capacidades habituales de cable (pelos totales). */
export const STANDARD_FIBER_COUNTS = [
  2, 4, 6, 8, 12, 24, 48, 72, 96, 144, 192, 288, 384, 512,
] as const

/** Pelos por minitubo admitidos habitualmente. */
export const FIBERS_PER_TUBE_OPTIONS = [2, 4, 6, 8, 12, 24] as const

export const MAX_CABLE_FIBERS = 512
export const MAX_FIBERS_PER_TUBE = 24
export const MAX_TUBES = 256

export function clampFiberCount(n: number) {
  return Math.max(1, Math.min(MAX_CABLE_FIBERS, Math.floor(n) || 1))
}

export function clampFibersPerTube(n: number) {
  return Math.max(1, Math.min(MAX_FIBERS_PER_TUBE, Math.floor(n) || 1))
}

/** Referencia a un minitubo de un cable entrante. */
export type MufaTubeRef = {
  cableId: string
  tubeId: string
}

/** Pelo individual asignado a una bandeja (puede venir de un tubo de otra). */
export type MufaFiberRef = {
  cableId: string
  tubeId: string
  fiberId: string
}

export type MufaTray = {
  id: string
  name: string
  /** Minitubos asignados a esta bandeja. */
  tubes?: MufaTubeRef[]
  /**
   * Pelos movidos explícitamente a esta bandeja.
   * Sirve para sacar un pelo de su minitubo hacia otra bandeja.
   */
  fibers?: MufaFiberRef[]
}

/** Unión de un pelo de un cable con un pelo de otro, dentro de una bandeja. */
export type MufaConnection = {
  id: string
  trayId: string
  fromCableId: string
  fromFiberId: string
  toCableId: string
  toFiberId: string
  /** Posición (espacio) del manguito en el peine de la bandeja. */
  slot?: number
}

/** Puerto de salida de un splitter (cliente o drop). */
export type NapSplitterPort = {
  index: number
  /** Cliente CRM conectado a este puerto. */
  clientId?: string | null
  /** Drop (cable 1–2F) conectado a este puerto. */
  dropId?: string | null
  /** Pelo del drop usado en el puerto (si aplica). */
  fiberId?: string | null
}

/** Splitter instalado dentro de una NAP. */
export type NapSplitter = {
  id: string
  name: string
  ratio: SplitterRatio
  /**
   * Entrada del splitter: pelo (de tendido/drop) alimentado desde la bandeja.
   * Si falta, el splitter aún no está “conectado” al backbone.
   */
  inputCableId?: string | null
  inputFiberId?: string | null
  ports: NapSplitterPort[]
}

export function newFiberId() {
  return `fiber-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

export function newTubeId() {
  return `tube-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

export function newTrayId() {
  return `tray-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

export function newConnectionId() {
  return `conn-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

export function newSplitterId() {
  return `spl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

export function createSplitterPorts(ratio: SplitterRatio): NapSplitterPort[] {
  return Array.from({ length: ratio }, (_, i) => ({
    index: i + 1,
    clientId: null,
    dropId: null,
    fiberId: null,
  }))
}

export function createNapSplitter(
  ratio: SplitterRatio,
  name?: string,
): NapSplitter {
  return {
    id: newSplitterId(),
    name: name || `Splitter 1:${ratio}`,
    ratio,
    inputCableId: null,
    inputFiberId: null,
    ports: createSplitterPorts(ratio),
  }
}

/** Drop: 1 o 2 pelos planos (sin minitubos). */
export function createDropFibers(count: 1 | 2): FiberStrand[] {
  const n = count === 2 ? 2 : 1
  return createFiberStrands(n, DEFAULT_FIBER_COLOR_NORM).map((f, i) => ({
    ...f,
    name: n === 1 ? 'Pelo' : `Pelo ${i + 1} · ${f.name.split(' · ')[1] ?? ''}`.trim(),
  }))
}

/** Tendido o drop (ambos tienen ruta y pelos). */
export function isFiberPathElement(
  d: MapDraftElement | null | undefined,
): boolean {
  return d?.type === 'cable' || d?.type === 'drop'
}

export function isZoneElement(
  d: MapDraftElement | null | undefined,
): boolean {
  return d?.type === 'zone'
}

/** Centroide simple del perímetro (para anclar lat/lng de la zona). */
export function zoneCentroid(
  path: MapPathVertex[] | undefined | null,
): { lat: number; lng: number } | null {
  if (!path?.length) return null
  let lat = 0
  let lng = 0
  for (const v of path) {
    lat += v.lat
    lng += v.lng
  }
  return { lat: lat / path.length, lng: lng / path.length }
}

const EARTH_RADIUS_M = 6_371_000

/** Distancia en metros entre dos coordenadas (haversine). */
export function haversineMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Longitud total del recorrido (suma de segmentos) en metros. */
export function pathLengthMeters(
  path: Array<{ lat: number; lng: number }> | undefined | null,
): number {
  if (!path || path.length < 2) return 0
  let total = 0
  for (let i = 1; i < path.length; i++) {
    total += haversineMeters(path[i - 1], path[i])
  }
  return total
}

/** Formato legible: "85 m", "1,25 km". */
export function formatPathLength(meters: number): string {
  if (!Number.isFinite(meters) || meters <= 0) return '0 m'
  if (meters < 1000) {
    return `${Math.round(meters)} m`
  }
  const km = meters / 1000
  const rounded = km >= 10 ? km.toFixed(1) : km.toFixed(2)
  return `${rounded.replace('.', ',')} km`
}

/**
 * Crea N pelos según la norma del cable.
 * Cada minitubo reinicia la secuencia (pelo 1 = primer color de la norma).
 */
export function createFiberStrands(
  count: number,
  normId: FiberColorNormId | string | null | undefined = DEFAULT_FIBER_COLOR_NORM,
): FiberStrand[] {
  const n = Math.max(0, Math.min(MAX_FIBERS_PER_TUBE, Math.floor(count)))
  return Array.from({ length: n }, (_, i) => {
    const code = colorCodeAt(i, false, normId)
    return {
      id: newFiberId(),
      name: `Pelo ${i + 1} · ${code.name}`,
      description: '',
      color: code.color,
      tracer: code.tracer,
    }
  })
}

/** Redimensiona la lista de pelos conservando los existentes. */
export function resizeFiberStrands(
  current: FiberStrand[] | undefined,
  count: number,
  normId: FiberColorNormId | string | null | undefined = DEFAULT_FIBER_COLOR_NORM,
): FiberStrand[] {
  const n = Math.max(0, Math.min(MAX_FIBERS_PER_TUBE, Math.floor(count)))
  const prev = current ?? []
  if (prev.length === n) return prev
  if (prev.length > n) return prev.slice(0, n)
  const added = Array.from({ length: n - prev.length }, (_, i) => {
    const idx = prev.length + i
    const code = colorCodeAt(idx, false, normId)
    return {
      id: newFiberId(),
      name: `Pelo ${idx + 1} · ${code.name}`,
      description: '',
      color: code.color,
      tracer: code.tracer,
    }
  })
  return [...prev, ...added]
}

/** Crea minitubos con N pelos cada uno según la norma del cable. */
export function createMiniTubes(
  tubeCount: number,
  fibersPerTube = 12,
  normId: FiberColorNormId | string | null | undefined = DEFAULT_FIBER_COLOR_NORM,
): MiniTube[] {
  const tubes = Math.max(1, Math.min(MAX_TUBES, Math.floor(tubeCount) || 1))
  const perTube = clampFibersPerTube(fibersPerTube)
  return Array.from({ length: tubes }, (_, i) => {
    const code = colorCodeAt(i, true, normId)
    return {
      id: newTubeId(),
      name: `Minitubo ${i + 1} · ${code.name}`,
      color: code.color,
      tracer: code.tracer,
      fibers: createFiberStrands(perTube, normId),
    }
  })
}

/** Cambia cantidad de minitubos conservando los existentes. */
export function resizeMiniTubes(
  current: MiniTube[] | undefined,
  tubeCount: number,
  fibersPerTube = 12,
  normId: FiberColorNormId | string | null | undefined = DEFAULT_FIBER_COLOR_NORM,
): MiniTube[] {
  const n = Math.max(1, Math.min(MAX_TUBES, Math.floor(tubeCount) || 1))
  const prev = current ?? []
  if (prev.length === n) return prev
  if (prev.length > n) return prev.slice(0, n)
  const perTube = clampFibersPerTube(
    prev[0]?.fibers.length || fibersPerTube || 12,
  )
  const added = Array.from({ length: n - prev.length }, (_, i) => {
    const idx = prev.length + i
    const code = colorCodeAt(idx, true, normId)
    return {
      id: newTubeId(),
      name: `Minitubo ${idx + 1} · ${code.name}`,
      color: code.color,
      tracer: code.tracer,
      fibers: createFiberStrands(perTube, normId),
    }
  })
  return [...prev, ...added]
}

/**
 * Arma un cable de `totalFibers` pelos repartidos en tubos de `fibersPerTube`.
 * Combinaciones típicas: 12=1×12, 24=2×12, 48=4×12… También 2F, 4F, hasta 512F.
 * El último tubo puede tener menos pelos si el total no divide exacto.
 */
export function buildCableTubes(
  totalFibers: number,
  fibersPerTube = 12,
  normId: FiberColorNormId | string | null | undefined = DEFAULT_FIBER_COLOR_NORM,
): MiniTube[] {
  const total = clampFiberCount(totalFibers)
  const perTube = Math.min(clampFibersPerTube(fibersPerTube), total)
  const tubeCount = Math.ceil(total / perTube)
  return Array.from({ length: tubeCount }, (_, i) => {
    const start = i * perTube
    const count = Math.min(perTube, total - start)
    const code = colorCodeAt(i, true, normId)
    return {
      id: newTubeId(),
      name: `Minitubo ${i + 1} · ${code.name}`,
      color: code.color,
      tracer: code.tracer,
      fibers: createFiberStrands(count, normId),
    }
  })
}

/** Reaplica colores de pelos y tubo según la norma del cable. */
export function applyNormColorsToTube(
  tube: MiniTube,
  tubeIndex: number,
  normId: FiberColorNormId | string | null | undefined = DEFAULT_FIBER_COLOR_NORM,
): MiniTube {
  const tubeCode = colorCodeAt(tubeIndex, true, normId)
  return {
    ...tube,
    color: tubeCode.color,
    tracer: tubeCode.tracer,
    name: tube.name.startsWith('Minitubo ')
      ? `Minitubo ${tubeIndex + 1} · ${tubeCode.name}`
      : tube.name,
    fibers: tube.fibers.map((f, i) => {
      const code = colorCodeAt(i, false, normId)
      return {
        ...f,
        color: code.color,
        tracer: code.tracer,
        name: `Pelo ${i + 1} · ${code.name}`,
      }
    }),
  }
}

export function applyNormColorsToTubes(
  tubes: MiniTube[],
  normId: FiberColorNormId | string | null | undefined = DEFAULT_FIBER_COLOR_NORM,
): MiniTube[] {
  return tubes.map((t, i) => applyNormColorsToTube(t, i, normId))
}

/** Añade un minitubo al final, con color según la norma del cable. */
export function appendMiniTube(
  tubes: MiniTube[],
  fibersInNewTube = 1,
  normId: FiberColorNormId | string | null | undefined = DEFAULT_FIBER_COLOR_NORM,
): MiniTube[] {
  if (tubes.length >= MAX_TUBES) return tubes
  const idx = tubes.length
  const code = colorCodeAt(idx, true, normId)
  const fiberCount = clampFibersPerTube(fibersInNewTube)
  return [
    ...tubes,
    {
      id: newTubeId(),
      name: `Minitubo ${idx + 1} · ${code.name}`,
      color: code.color,
      tracer: code.tracer,
      fibers: createFiberStrands(fiberCount, normId),
    },
  ]
}

/** Añade un pelo al minitubo con el siguiente color de la norma del cable. */
export function appendFiberToTube(
  tube: MiniTube,
  normId: FiberColorNormId | string | null | undefined = DEFAULT_FIBER_COLOR_NORM,
): MiniTube {
  if (tube.fibers.length >= MAX_FIBERS_PER_TUBE) return tube
  const idx = tube.fibers.length
  const code = colorCodeAt(idx, false, normId)
  return {
    ...tube,
    fibers: [
      ...tube.fibers,
      {
        id: newFiberId(),
        name: `Pelo ${idx + 1} · ${code.name}`,
        description: '',
        color: code.color,
        tracer: code.tracer,
      },
    ],
  }
}

/** Ajusta pelos de un minitubo. */
export function resizeTubeFibers(tube: MiniTube, count: number): MiniTube {
  return {
    ...tube,
    fibers: resizeFiberStrands(tube.fibers, count),
  }
}

/** Pelos planos de un cable (desde tubes o fibers legacy). */
export function cableFibers(
  cable: MapDraftElement | null | undefined,
): FiberStrand[] {
  if (!cable) return []
  if (cable.tubes?.length) {
    return cable.tubes.flatMap((t) => t.fibers)
  }
  return cable.fibers ?? []
}

/** Minitubos de un cable; migra fibers planos a tubos si hace falta. */
export function cableTubes(
  cable: MapDraftElement | null | undefined,
): MiniTube[] {
  if (!cable) return []
  if (cable.tubes?.length) return cable.tubes
  const flat = cable.fibers ?? []
  if (flat.length === 0) return []
  // Drop: un solo “tubo” virtual estable (sin minitubos reales).
  if (cable.type === 'drop') {
    return [
      {
        id: `${cable.id}-drop`,
        name: 'Drop',
        color: mapElementColor.drop,
        tracer: null,
        fibers: flat,
      },
    ]
  }
  const groups: FiberStrand[][] = []
  for (let i = 0; i < flat.length; i += 12) {
    groups.push(flat.slice(i, i + 12))
  }
  return groups.map((fibers, i) => {
    const code = colorCodeAt(i, true, cable.colorNorm)
    return {
      id: newTubeId(),
      name: `Minitubo ${i + 1} · ${code.name}`,
      color: code.color,
      tracer: code.tracer,
      fibers,
    }
  })
}

export function findTube(
  cable: MapDraftElement | null | undefined,
  tubeId: string,
): MiniTube | undefined {
  return cableTubes(cable).find((t) => t.id === tubeId)
}

export function findFiberInCable(
  cable: MapDraftElement | null | undefined,
  fiberId: string,
): { tube: MiniTube; fiber: FiberStrand } | undefined {
  for (const tube of cableTubes(cable)) {
    const fiber = tube.fibers.find((f) => f.id === fiberId)
    if (fiber) return { tube, fiber }
  }
  return undefined
}

export function createMufaTrays(count: number): MufaTray[] {
  const n = Math.max(1, Math.min(48, Math.floor(count) || 1))
  return Array.from({ length: n }, (_, i) => ({
    id: newTrayId(),
    name: `Bandeja ${i + 1}`,
    tubes: [],
    fibers: [],
  }))
}

export function resizeMufaTrays(
  current: MufaTray[] | undefined,
  count: number,
): MufaTray[] {
  const n = Math.max(1, Math.min(48, Math.floor(count) || 1))
  const prev = (current ?? []).map((t) => ({
    ...t,
    tubes: t.tubes ?? [],
    fibers: t.fibers ?? [],
  }))
  if (prev.length === n) return prev
  if (prev.length > n) return prev.slice(0, n)
  const added = Array.from({ length: n - prev.length }, (_, i) => ({
    id: newTrayId(),
    name: `Bandeja ${prev.length + i + 1}`,
    tubes: [] as MufaTubeRef[],
    fibers: [] as MufaFiberRef[],
  }))
  return [...prev, ...added]
}

export function fiberPlacementKey(cableId: string, fiberId: string) {
  return `${cableId}:${fiberId}`
}

/** Bandeja explícita de cada pelo movido (si no está, vive con su minitubo). */
export function fiberTrayOverrides(
  trays: MufaTray[],
): Map<string, string> {
  const map = new Map<string, string>()
  for (const tray of trays) {
    for (const f of tray.fibers ?? []) {
      map.set(fiberPlacementKey(f.cableId, f.fiberId), tray.id)
    }
  }
  return map
}

/**
 * ¿Este pelo se muestra en la bandeja?
 * - Si tiene override → solo en esa bandeja.
 * - Si no → en la bandeja donde está su minitubo.
 */
export function fiberBelongsToTray(
  trays: MufaTray[],
  trayId: string,
  cableId: string,
  tubeId: string,
  fiberId: string,
): boolean {
  const overrides = fiberTrayOverrides(trays)
  const key = fiberPlacementKey(cableId, fiberId)
  const override = overrides.get(key)
  if (override) return override === trayId
  const tray = trays.find((t) => t.id === trayId)
  return (tray?.tubes ?? []).some(
    (r) => r.cableId === cableId && r.tubeId === tubeId,
  )
}

/** SVG interior (24×24) por tipo. */
export function mapElementSvgInner(
  type: MapElementType,
  stroke = '#fff',
): string {
  switch (type) {
    case 'nap':
      // Caja NAP tipo outdoor: cuerpo oscuro, rejilla frontal, pestillos y puertos abajo.
      return `<g stroke-linecap="round" stroke-linejoin="round">
      <!-- cuerpo -->
      <rect x="5.2" y="2.8" width="13.6" height="15.2" rx="1.4" fill="#1e293b" stroke="#0f172a" stroke-width="0.9"/>
      <rect x="5.2" y="2.8" width="13.6" height="15.2" rx="1.4" fill="${stroke}" opacity="0.2"/>
      <!-- bisagras superiores -->
      <rect x="7.2" y="2.2" width="2.2" height="1.4" rx="0.3" fill="#334155"/>
      <rect x="10.9" y="2.2" width="2.2" height="1.4" rx="0.3" fill="#334155"/>
      <rect x="14.6" y="2.2" width="2.2" height="1.4" rx="0.3" fill="#334155"/>
      <!-- pestillos laterales -->
      <path d="M5.2 6.2h-1.1v1.6H5.2M5.2 9.2h-1.1v1.6H5.2M5.2 12.2h-1.1v1.6H5.2" fill="#334155" stroke="#0f172a" stroke-width="0.35"/>
      <path d="M18.8 6.2h1.1v1.6H18.8M18.8 9.2h1.1v1.6H18.8M18.8 12.2h1.1v1.6H18.8" fill="#334155" stroke="#0f172a" stroke-width="0.35"/>
      <!-- rejilla frontal 4×4 -->
      <path d="M7.2 5.2h9.6M7.2 8h9.6M7.2 10.8h9.6M7.2 13.6h9.6M9.6 5.2v11.2M12 5.2v11.2M14.4 5.2v11.2" stroke="#94a3b8" stroke-width="0.55" opacity="0.85"/>
      <rect x="7.2" y="5.2" width="9.6" height="11.2" rx="0.4" fill="none" stroke="#64748b" stroke-width="0.55"/>
      <!-- base / collar de puertos -->
      <path d="M6 18h12" stroke="#0f172a" stroke-width="1.6"/>
      <path d="M6 18h12" stroke="${stroke}" stroke-width="0.9" opacity="0.5"/>
      <!-- 4 puertos de cable -->
      <rect x="6.6" y="18" width="2.2" height="3.6" rx="0.7" fill="#334155" stroke="#0f172a" stroke-width="0.5"/>
      <rect x="9.5" y="18" width="2.2" height="3.6" rx="0.7" fill="#334155" stroke="#0f172a" stroke-width="0.5"/>
      <rect x="12.3" y="18" width="2.2" height="3.6" rx="0.7" fill="#334155" stroke="#0f172a" stroke-width="0.5"/>
      <rect x="15.2" y="18" width="2.2" height="3.6" rx="0.7" fill="#334155" stroke="#0f172a" stroke-width="0.5"/>
      <ellipse cx="7.7" cy="21.4" rx="0.55" ry="0.35" fill="#0f172a"/>
      <ellipse cx="10.6" cy="21.4" rx="0.55" ry="0.35" fill="#0f172a"/>
      <ellipse cx="13.4" cy="21.4" rx="0.55" ry="0.35" fill="#0f172a"/>
      <ellipse cx="16.3" cy="21.4" rx="0.55" ry="0.35" fill="#0f172a"/>
    </g>`
    case 'splitter':
      return `<circle cx="6" cy="12" r="2" fill="${stroke}"/>
    <path d="M8 12h4M12 12l5-6M12 12l5 0M12 12l5 6" stroke="${stroke}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
    <circle cx="18" cy="6" r="1.5" fill="${stroke}"/>
    <circle cx="18" cy="12" r="1.5" fill="${stroke}"/>
    <circle cx="18" cy="18" r="1.5" fill="${stroke}"/>`
    case 'pole':
      return `<g stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 2.5v19" stroke="#0f172a" stroke-width="3.4"/>
      <path d="M5.5 6.5h13M6.5 11h11" stroke="#0f172a" stroke-width="3"/>
      <path d="M7.5 6.5v3.5M16.5 6.5v3.5" stroke="#0f172a" stroke-width="2.6"/>
      <circle cx="12" cy="21" r="1.8" fill="#0f172a"/>
      <path d="M12 2.5v19" stroke="${stroke}" stroke-width="2"/>
      <path d="M5.5 6.5h13M6.5 11h11" stroke="${stroke}" stroke-width="1.7"/>
      <path d="M7.5 6.5v3.5M16.5 6.5v3.5" stroke="${stroke}" stroke-width="1.4"/>
      <circle cx="12" cy="21" r="1.2" fill="${stroke}"/>
    </g>`
    case 'mufa':
      return `<g stroke-linecap="round" stroke-linejoin="round">
      <path d="M7 8.5c0-3.2 2.2-5.5 5-5.5s5 2.3 5 5.5v8.2H7V8.5z" fill="${stroke}" stroke="${stroke}" stroke-width="0.6" opacity="0.92"/>
      <path d="M8.2 10h7.6M8.2 12.2h7.6M8.2 14.4h7.6" stroke="#94a3b8" stroke-width="1.1" fill="none"/>
      <path d="M6 17.2h12" stroke="${stroke}" stroke-width="2.2" fill="none"/>
      <path d="M8 17.2v3.2M10.5 17.2v3.6M13.5 17.2v3.6M16 17.2v3.2" stroke="${stroke}" stroke-width="1.6" fill="none"/>
    </g>`
    case 'cable':
      return ''
    case 'drop':
      return `<path d="M4 12h16" stroke="${stroke}" stroke-width="2.2" stroke-linecap="round"/>
    <circle cx="4" cy="12" r="2" fill="${stroke}"/>
    <circle cx="20" cy="12" r="2" fill="${stroke}"/>`
    case 'zone':
      return `<path d="M4 8.5l5-4.5 6 2.5 5-1.5v11.5l-5.5 3.5-5.5-3-5 1.5z" fill="${stroke}" fill-opacity="0.35" stroke="${stroke}" stroke-width="1.6" stroke-linejoin="round"/>`
  }
}

export function mapElementBareIcon(type: MapElementType): boolean {
  return type === 'pole' || type === 'mufa' || type === 'nap'
}

/** Tendidos, drops y zonas se ven como geometría (sin pin). */
export function mapElementHasIcon(type: MapElementType): boolean {
  return type !== 'cable' && type !== 'drop' && type !== 'zone'
}

export type MapPathVertex = {
  lat: number
  lng: number
  poleId?: string | null
  /** Enganchado a una mufa (el cable “entra” ahí). */
  mufaId?: string | null
  /** Enganchado a una NAP. */
  napId?: string | null
  /** Enganchado a un nodo físico (cabeceras de fibra). */
  nodeId?: string | null
  /** Enganchado a un cliente CRM (extremo del drop). */
  clientId?: string | null
}

export type MapDraftElement = {
  id: string
  type: MapElementType
  name: string
  notes: string
  lat: number
  lng: number
  path?: MapPathVertex[]
  /** @deprecated Preferir tubes. Se migra al cargar. Drop usa fibers planos. */
  fibers?: FiberStrand[]
  /** Minitubos del tendido (cada uno con pelos). */
  tubes?: MiniTube[]
  /** Norma de colores del cable (TIA-598, IEC, S12…). */
  colorNorm?: FiberColorNormId
  /** Mufa / NAP: bandejas internas. */
  trays?: MufaTray[]
  /** Mufa / NAP: cables entrantes (además de los detectados por ruta). */
  cableIds?: string[]
  /** Mufa / NAP: uniones pelo↔pelo asignadas a bandejas. */
  connections?: MufaConnection[]
  /** NAP: splitters internos con puertos a clientes/drops. */
  splitters?: NapSplitter[]
  /** Drop: cliente CRM al que llega este drop. */
  clientId?: string | null
  /** Zona: color del perímetro / relleno. */
  color?: string | null
  /** Zona: catálogo CRM al que pertenece este perímetro. */
  zoneId?: string | null
}

export function isMapElementType(v: string): v is MapElementType {
  return (MAP_ELEMENT_TYPES as readonly string[]).includes(v)
}

function migrateType(raw: string): MapElementType | null {
  if (raw === 'splice') return 'mufa'
  if (isMapElementType(raw)) return raw
  return null
}

function isPathVertex(v: unknown): v is MapPathVertex {
  if (!v || typeof v !== 'object') return false
  const p = v as MapPathVertex
  return Number.isFinite(p.lat) && Number.isFinite(p.lng)
}

function isFiberStrand(v: unknown): v is FiberStrand {
  if (!v || typeof v !== 'object') return false
  const f = v as FiberStrand
  return (
    typeof f.id === 'string' &&
    typeof f.color === 'string' &&
    typeof f.name === 'string'
  )
}

function isMiniTube(v: unknown): v is MiniTube {
  if (!v || typeof v !== 'object') return false
  const t = v as MiniTube
  return (
    typeof t.id === 'string' &&
    typeof t.name === 'string' &&
    typeof t.color === 'string' &&
    Array.isArray(t.fibers)
  )
}

function isMufaTubeRef(v: unknown): v is MufaTubeRef {
  if (!v || typeof v !== 'object') return false
  const r = v as MufaTubeRef
  return typeof r.cableId === 'string' && typeof r.tubeId === 'string'
}

function isMufaFiberRef(v: unknown): v is MufaFiberRef {
  if (!v || typeof v !== 'object') return false
  const r = v as MufaFiberRef
  return (
    typeof r.cableId === 'string' &&
    typeof r.tubeId === 'string' &&
    typeof r.fiberId === 'string'
  )
}

function isMufaTray(v: unknown): v is MufaTray {
  if (!v || typeof v !== 'object') return false
  const t = v as MufaTray
  return typeof t.id === 'string' && typeof t.name === 'string'
}

function isMufaConnection(v: unknown): v is MufaConnection {
  if (!v || typeof v !== 'object') return false
  const c = v as MufaConnection
  return (
    typeof c.id === 'string' &&
    typeof c.trayId === 'string' &&
    typeof c.fromCableId === 'string' &&
    typeof c.fromFiberId === 'string' &&
    typeof c.toCableId === 'string' &&
    typeof c.toFiberId === 'string'
  )
}

function normalizeTubes(
  rawTubes: unknown,
  rawFibers: unknown,
): MiniTube[] | undefined {
  if (Array.isArray(rawTubes) && rawTubes.length > 0) {
    return rawTubes.filter(isMiniTube).map((t) => ({
      id: t.id,
      name: t.name,
      color: t.color,
      tracer: typeof t.tracer === 'string' ? t.tracer : null,
      fibers: (t.fibers ?? []).filter(isFiberStrand).map((f) => ({
        id: f.id,
        name: f.name,
        description: typeof f.description === 'string' ? f.description : '',
        color: f.color,
        tracer: typeof f.tracer === 'string' ? f.tracer : null,
      })),
    }))
  }
  if (Array.isArray(rawFibers) && rawFibers.length > 0) {
    const fibers = rawFibers.filter(isFiberStrand).map((f) => ({
      id: f.id,
      name: f.name,
      description: typeof f.description === 'string' ? f.description : '',
      color: f.color,
      tracer: typeof f.tracer === 'string' ? f.tracer : null,
    }))
    const groups: FiberStrand[][] = []
    for (let i = 0; i < fibers.length; i += 12) {
      groups.push(fibers.slice(i, i + 12))
    }
    return groups.map((group, i) => {
      const code = colorCodeAt(i, true)
      return {
        id: newTubeId(),
        name: `Minitubo ${i + 1} · ${code.name}`,
        color: code.color,
        tracer: code.tracer,
        fibers: group,
      }
    })
  }
  return undefined
}

function isNapSplitter(v: unknown): v is NapSplitter {
  if (!v || typeof v !== 'object') return false
  const s = v as NapSplitter
  return (
    typeof s.id === 'string' &&
    typeof s.name === 'string' &&
    isSplitterRatio(Number(s.ratio)) &&
    Array.isArray(s.ports)
  )
}

function normalizeSplitter(s: NapSplitter): NapSplitter {
  const ratio = isSplitterRatio(Number(s.ratio)) ? s.ratio : 8
  const portsRaw = Array.isArray(s.ports) ? s.ports : []
  const ports = createSplitterPorts(ratio).map((p) => {
    const existing = portsRaw.find((x) => x.index === p.index)
    return {
      index: p.index,
      clientId:
        typeof existing?.clientId === 'string' ? existing.clientId : null,
      dropId: typeof existing?.dropId === 'string' ? existing.dropId : null,
      fiberId: typeof existing?.fiberId === 'string' ? existing.fiberId : null,
    }
  })
  return {
    id: s.id,
    name: s.name || `Splitter 1:${ratio}`,
    ratio,
    inputCableId:
      typeof s.inputCableId === 'string' ? s.inputCableId : null,
    inputFiberId:
      typeof s.inputFiberId === 'string' ? s.inputFiberId : null,
    ports,
  }
}

export function normalizeDraft(raw: unknown): MapDraftElement | null {
  if (!raw || typeof raw !== 'object') return null
  const d = raw as MapDraftElement & { type: string }
  const type = migrateType(String(d.type))
  if (
    typeof d.id !== 'string' ||
    !type ||
    !Number.isFinite(d.lat) ||
    !Number.isFinite(d.lng)
  ) {
    return null
  }
  const path = Array.isArray(d.path)
    ? d.path.filter(isPathVertex).map((v) => ({
        lat: v.lat,
        lng: v.lng,
        poleId: typeof v.poleId === 'string' ? v.poleId : null,
        mufaId: typeof v.mufaId === 'string' ? v.mufaId : null,
        napId: typeof (v as MapPathVertex).napId === 'string'
          ? (v as MapPathVertex).napId
          : null,
        nodeId: typeof (v as MapPathVertex).nodeId === 'string'
          ? (v as MapPathVertex).nodeId
          : null,
        clientId: typeof (v as MapPathVertex).clientId === 'string'
          ? (v as MapPathVertex).clientId
          : null,
      }))
    : undefined

  const flatFibers =
    Array.isArray(d.fibers) && d.fibers.length > 0
      ? d.fibers.filter(isFiberStrand).map((f) => ({
          id: f.id,
          name: f.name,
          description: typeof f.description === 'string' ? f.description : '',
          color: f.color,
          tracer: typeof f.tracer === 'string' ? f.tracer : null,
        }))
      : undefined

  const tubes =
    type === 'drop' || type === 'zone'
      ? undefined
      : normalizeTubes(d.tubes, d.fibers)
  const colorNorm =
    type === 'cable'
      ? isFiberColorNormId(String(d.colorNorm ?? ''))
        ? d.colorNorm
        : DEFAULT_FIBER_COLOR_NORM
      : undefined
  const trays = Array.isArray(d.trays)
    ? d.trays.filter(isMufaTray).map((t) => ({
        id: t.id,
        name: t.name,
        tubes: Array.isArray(t.tubes) ? t.tubes.filter(isMufaTubeRef) : [],
        fibers: Array.isArray(t.fibers) ? t.fibers.filter(isMufaFiberRef) : [],
      }))
    : type === 'mufa' || type === 'nap'
      ? createMufaTrays(type === 'nap' ? 2 : 4)
      : undefined
  const cableIds = Array.isArray(d.cableIds)
    ? d.cableIds.filter((id): id is string => typeof id === 'string')
    : undefined
  const connections = Array.isArray(d.connections)
    ? d.connections.filter(isMufaConnection)
    : undefined
  const splitters = Array.isArray(d.splitters)
    ? d.splitters.filter(isNapSplitter).map(normalizeSplitter)
    : undefined

  const dropFibers =
    type === 'drop'
      ? flatFibers?.length
        ? flatFibers.slice(0, 2)
        : createDropFibers(1)
      : undefined

  return {
    id: d.id,
    type,
    name: typeof d.name === 'string' ? d.name : '',
    notes: typeof d.notes === 'string' ? d.notes : '',
    lat: d.lat,
    lng: d.lng,
    ...(path && path.length > 0 ? { path } : {}),
    ...(tubes && tubes.length > 0 ? { tubes } : {}),
    ...(dropFibers
      ? {
          fibers: dropFibers,
          clientId:
            typeof d.clientId === 'string' ? d.clientId : null,
        }
      : {}),
    ...(type === 'cable' && colorNorm ? { colorNorm } : {}),
    ...(type === 'mufa'
      ? {
          trays: trays?.length ? trays : createMufaTrays(4),
          cableIds: cableIds ?? [],
          connections: connections ?? [],
        }
      : {}),
    ...(type === 'nap'
      ? {
          trays: trays?.length ? trays : createMufaTrays(2),
          cableIds: cableIds ?? [],
          connections: connections ?? [],
          splitters: splitters ?? [createNapSplitter(8)],
        }
      : {}),
    ...(type === 'zone'
      ? {
          zoneId: typeof d.zoneId === 'string' ? d.zoneId : null,
          color:
            typeof d.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(d.color)
              ? d.color
              : DEFAULT_ZONE_COLOR,
          path: path?.length ? path : [],
        }
      : {}),
  }
}

/** Cables/drops cuyo path entra a la mufa o NAP (más los asignados). */
export function cablesEnteringMufa(
  enclosure: MapDraftElement,
  drafts: MapDraftElement[],
): MapDraftElement[] {
  if (enclosure.type !== 'mufa' && enclosure.type !== 'nap') return []
  const assigned = new Set(enclosure.cableIds ?? [])
  // Drops ya colgados en puertos de splitter de esta NAP
  if (enclosure.type === 'nap') {
    for (const s of enclosure.splitters ?? []) {
      for (const p of s.ports) {
        if (p.dropId) assigned.add(p.dropId)
      }
    }
  }
  return drafts.filter((d) => {
    if (!isFiberPathElement(d)) return false
    if (assigned.has(d.id)) return true
    return (d.path ?? []).some((v) =>
      enclosure.type === 'mufa'
        ? v.mufaId === enclosure.id
        : v.napId === enclosure.id,
    )
  })
}

export function cablesEnteringNap(
  nap: MapDraftElement,
  drafts: MapDraftElement[],
): MapDraftElement[] {
  return cablesEnteringMufa(nap, drafts)
}

/** Tendidos / drops cuyo recorrido engancha un nodo físico (vertex.nodeId). */
export function cablesEnteringNode(
  nodeId: string,
  drafts: MapDraftElement[],
): MapDraftElement[] {
  return drafts.filter(
    (d) =>
      isFiberPathElement(d) &&
      (d.path ?? []).some((v) => v.nodeId === nodeId),
  )
}

/**
 * NAP a la que llega un cliente CRM en el mapa. Se resuelve por:
 * 1. puerto de splitter con `clientId` del cliente,
 * 2. drop del cliente colgado en un puerto de splitter,
 * 3. drop del cliente cuyo recorrido pasa por la NAP (`napId`).
 */
export function findNapForClient(
  clientId: string | null | undefined,
  drafts: MapDraftElement[],
): MapDraftElement | null {
  if (!clientId) return null
  const naps = drafts.filter((d) => d.type === 'nap')
  if (naps.length === 0) return null

  const byPortClient = naps.find((n) =>
    (n.splitters ?? []).some((s) =>
      s.ports.some((p) => p.clientId === clientId),
    ),
  )
  if (byPortClient) return byPortClient

  const clientDrops = drafts.filter(
    (d) => d.type === 'drop' && d.clientId === clientId,
  )
  for (const drop of clientDrops) {
    const byPortDrop = naps.find((n) =>
      (n.splitters ?? []).some((s) =>
        s.ports.some((p) => p.dropId === drop.id),
      ),
    )
    if (byPortDrop) return byPortDrop

    const napId = (drop.path ?? [])
      .map((v) => v.napId)
      .find((id): id is string => !!id)
    if (napId) {
      const n = naps.find((x) => x.id === napId)
      if (n) return n
    }
  }
  return null
}

function syncPathElement(
  drafts: MapDraftElement[],
  match: (v: MapPathVertex) => boolean,
  lat: number,
  lng: number,
): MapDraftElement[] {
  return drafts.map((d) => {
    if (!isFiberPathElement(d) || !d.path?.length) return d
    let changed = false
    const path = d.path.map((v) => {
      if (!match(v)) return v
      changed = true
      return { ...v, lat, lng }
    })
    if (!changed) return d
    const first = path[0]
    return {
      ...d,
      path,
      lat: first?.lat ?? d.lat,
      lng: first?.lng ?? d.lng,
    }
  })
}

export function syncCablePathsToPole(
  drafts: MapDraftElement[],
  poleId: string,
  lat: number,
  lng: number,
): MapDraftElement[] {
  return syncPathElement(drafts, (v) => v.poleId === poleId, lat, lng)
}

export function syncCablePathsToMufa(
  drafts: MapDraftElement[],
  mufaId: string,
  lat: number,
  lng: number,
): MapDraftElement[] {
  return syncPathElement(drafts, (v) => v.mufaId === mufaId, lat, lng)
}

export function syncCablePathsToNap(
  drafts: MapDraftElement[],
  napId: string,
  lat: number,
  lng: number,
): MapDraftElement[] {
  return syncPathElement(drafts, (v) => v.napId === napId, lat, lng)
}

export function syncCablePathsToNode(
  drafts: MapDraftElement[],
  nodeId: string,
  lat: number,
  lng: number,
): MapDraftElement[] {
  return syncPathElement(drafts, (v) => v.nodeId === nodeId, lat, lng)
}

export function syncCablePathsToClient(
  drafts: MapDraftElement[],
  clientId: string,
  lat: number,
  lng: number,
): MapDraftElement[] {
  return syncPathElement(drafts, (v) => v.clientId === clientId, lat, lng)
}

/** NAP a la que llega un drop (por vértice napId o cableIds de la NAP). */
export function findNapForDrop(
  drop: MapDraftElement,
  drafts: MapDraftElement[],
): MapDraftElement | null {
  if (drop.type !== 'drop') return null
  const fromPath = (drop.path ?? [])
    .map((v) => v.napId)
    .find((id): id is string => !!id)
  if (fromPath) {
    return drafts.find((d) => d.type === 'nap' && d.id === fromPath) ?? null
  }
  return (
    drafts.find(
      (d) => d.type === 'nap' && (d.cableIds ?? []).includes(drop.id),
    ) ?? null
  )
}

/** Cliente CRM enlazado a un drop (campo o vértice del path). */
export function dropClientId(drop: MapDraftElement | null | undefined): string | null {
  if (!drop || drop.type !== 'drop') return null
  if (drop.clientId) return drop.clientId
  const fromPath = (drop.path ?? [])
    .map((v) => v.clientId)
    .find((id): id is string => !!id)
  return fromPath ?? null
}

const STORAGE_PREFIX = 'isp-map-drafts:'

function storageKey(tenant: string | undefined) {
  return `${STORAGE_PREFIX}${tenant ?? 'unknown'}`
}

function parseDraftsRaw(raw: string | null): MapDraftElement[] {
  if (!raw) return []
  const parsed = JSON.parse(raw) as unknown
  if (!Array.isArray(parsed)) return []
  return parsed
    .map(normalizeDraft)
    .filter((d): d is MapDraftElement => d != null)
}

export function loadMapDrafts(tenant: string | undefined): MapDraftElement[] {
  try {
    const key = storageKey(tenant)
    // Persistente entre sesiones (antes era solo sessionStorage).
    const fromLocal = parseDraftsRaw(localStorage.getItem(key))
    if (fromLocal.length > 0) return fromLocal
    const fromSession = parseDraftsRaw(sessionStorage.getItem(key))
    if (fromSession.length > 0) {
      try {
        localStorage.setItem(key, JSON.stringify(fromSession))
      } catch {
        /* ignore */
      }
      return fromSession
    }
    return []
  } catch {
    return []
  }
}

export function saveMapDrafts(
  tenant: string | undefined,
  drafts: MapDraftElement[],
) {
  try {
    const key = storageKey(tenant)
    const raw = JSON.stringify(drafts)
    localStorage.setItem(key, raw)
    try {
      sessionStorage.setItem(key, raw)
    } catch {
      /* ignore */
    }
  } catch {
    /* ignore */
  }
}
