import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
} from 'react'
import { useNotify } from './NotifyProvider'
import {
  cableTubes,
  cablesEnteringMufa,
  createMufaTrays,
  fiberBelongsToTray,
  findFiberInCable,
  findTube,
  newConnectionId,
  strandBackground,
  type MapDraftElement,
  type MiniTube,
  type MufaConnection,
  type MufaFiberRef,
  type MufaTubeRef,
  type NapSplitter,
} from '../lib/map-elements'
import { MapElementTypeIcon } from './MapElementTypeIcon'
import { ModalPortal } from './ModalPortal'


const DND_TUBE = 'application/x-mufa-tube'
const DND_FIBER = 'application/x-mufa-fiber'
const DND_SLEEVE = 'application/x-mufa-sleeve'
const DND_TEXT = 'text/plain'
/** Prefijo de cableId sintético para la entrada de un splitter en NAP. */
const SPLITTER_CABLE_PREFIX = 'nap-splitter:'

function splitterCableId(splitterId: string) {
  return `${SPLITTER_CABLE_PREFIX}${splitterId}`
}

function parseSplitterCableId(cableId: string): string | null {
  return cableId.startsWith(SPLITTER_CABLE_PREFIX)
    ? cableId.slice(SPLITTER_CABLE_PREFIX.length)
    : null
}

type TubeDrag = { kind: 'tube'; cableId: string; tubeId: string }
type FiberDrag = {
  kind: 'fiber'
  cableId: string
  tubeId: string
  fiberId: string
}

function parseDragPayload(e: DragEvent): TubeDrag | FiberDrag | null {
  try {
    const raw =
      e.dataTransfer.getData(DND_TUBE) ||
      e.dataTransfer.getData(DND_FIBER) ||
      e.dataTransfer.getData(DND_TEXT)
    if (!raw) return null
    const data = JSON.parse(raw) as TubeDrag | FiberDrag
    if (data?.kind === 'tube' || data?.kind === 'fiber') return data
    return null
  } catch {
    return null
  }
}

function hasDragType(types: DOMStringList | readonly string[], type: string) {
  return Array.from(types as ArrayLike<string>).includes(type)
}

function isTubeDropType(types: DOMStringList | readonly string[]) {
  return (
    hasDragType(types, DND_TUBE) ||
    hasDragType(types, DND_TEXT) ||
    hasDragType(types, 'text')
  )
}

function fiberKey(cableId: string, fiberId: string) {
  return `${cableId}:${fiberId}`
}

/**
 * Vista gráfica de mufa / NAP (bandejas):
 * - arrastrar minitubos a bandejas
 * - arrastrar pelos a otra bandeja
 * - arrastrar pelo → pelo para unir
 */
export function MufaViewModal({
  open,
  mufa,
  drafts,
  onClose,
  onChange,
  onEdit,
  embedded = false,
  mobile = false,
}: {
  open: boolean
  mufa: MapDraftElement | null
  drafts: MapDraftElement[]
  onClose: () => void
  onChange: (next: MapDraftElement) => void
  onEdit?: (mufa: MapDraftElement) => void
  /** Sin overlay: se embebe dentro de otra modal (p. ej. NAP → Conexiones). */
  embedded?: boolean
  /** Pantalla completa / layout táctil (vista móvil). */
  mobile?: boolean
}) {
  const { confirm } = useNotify()
  const isNap = mufa?.type === 'nap'
  const trays = mufa?.trays?.length
    ? mufa.trays
    : createMufaTrays(isNap ? 2 : 4)
  const [trayId, setTrayId] = useState(trays[0]?.id ?? '')
  const [dragOverTray, setDragOverTray] = useState(false)
  const [dragOverFiber, setDragOverFiber] = useState<string | null>(null)
  const [dragOverSlot, setDragOverSlot] = useState<number | null>(null)
  const [hoverConn, setHoverConn] = useState<string | null>(null)
  const [hint, setHint] = useState<string | null>(null)
  /** Click-to-fuse: primer pelo seleccionado. */
  const [fusePick, setFusePick] = useState<{
    cableId: string
    tubeId: string
    fiberId: string
  } | null>(null)
  const trayBoardRef = useRef<HTMLDivElement>(null)
  /** Payload activo durante el drag (getData falla en dragover en varios browsers). */
  const fiberDragRef = useRef<Omit<FiberDrag, 'kind'> | null>(null)
  const sleeveDragRef = useRef<string | null>(null)

  const cables = useMemo(
    () => (mufa ? cablesEnteringMufa(mufa, drafts) : []),
    [mufa, drafts],
  )

  const cableById = useMemo(() => {
    const map = new Map<string, MapDraftElement>()
    for (const c of cables) map.set(c.id, c)
    return map
  }, [cables])

  useEffect(() => {
    if (!open || !mufa) return
    const nextTrays = mufa.trays?.length ? mufa.trays : createMufaTrays(4)
    setTrayId((prev) =>
      nextTrays.some((t) => t.id === prev) ? prev : (nextTrays[0]?.id ?? ''),
    )
    setHint(null)
    setDragOverTray(false)
    setDragOverFiber(null)
    setDragOverSlot(null)
    setHoverConn(null)
    setFusePick(null)
    fiberDragRef.current = null
    sleeveDragRef.current = null
  }, [open, mufa?.id])

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open || !mufa || (mufa.type !== 'mufa' && mufa.type !== 'nap'))
    return null

  const connections = mufa.connections ?? []
  const activeTray = trays.find((t) => t.id === trayId) ?? trays[0]
  const trayTubes = activeTray?.tubes ?? []
  const trayConnections = connections.filter((c) => c.trayId === trayId)

  /** Tubos ya asignados a cualquier bandeja (para no duplicar). */
  const assignedKeys = new Set(
    trays.flatMap((t) =>
      (t.tubes ?? []).map((r) => `${r.cableId}:${r.tubeId}`),
    ),
  )

  /** Pelos de un tubo que se muestran en la bandeja activa. */
  function fibersOfTubeInTray(ref: MufaTubeRef, tube: MiniTube) {
    return tube.fibers.filter((f) =>
      fiberBelongsToTray(trays, trayId, ref.cableId, ref.tubeId, f.id),
    )
  }

  /** Pelos recibidos desde tubos de otras bandejas. */
  const receivedFibers: MufaFiberRef[] = (activeTray?.fibers ?? []).filter(
    (f) => {
      const home = trays.find((t) =>
        (t.tubes ?? []).some(
          (r) => r.cableId === f.cableId && r.tubeId === f.tubeId,
        ),
      )
      return !home || home.id !== trayId
    },
  )

  const trayHasContent =
    trayTubes.length > 0 ||
    receivedFibers.length > 0 ||
    (isNap && (mufa.splitters?.length ?? 0) > 0)

  const napSplitters: NapSplitter[] = isNap
    ? mufa.splitters?.length
      ? mufa.splitters
      : []
    : []

  type TrayFiberEnd = {
    cableId: string
    tubeId: string
    fiberId: string
    cableName: string
    tubeName: string
    tubeColor: string
    tubeTracer?: string | null
    fiber: { id: string; name: string; color: string; tracer?: string | null }
    side: 'left' | 'right'
    received?: boolean
    /** Fusión de la que forma parte este pelo (si está unido). */
    connection?: MufaConnection
    /** Este extremo es la entrada de un splitter (NAP). */
    asSplitter?: NapSplitter
    /** Este pelo alimenta la entrada de un splitter. */
    splitterFeed?: NapSplitter
  }

  function connectionOfFiber(cableId: string, fiberId: string) {
    return trayConnections.find(
      (c) =>
        (c.fromCableId === cableId && c.fromFiberId === fiberId) ||
        (c.toCableId === cableId && c.toFiberId === fiberId),
    )
  }

  function splitterFedBy(cableId: string, fiberId: string) {
    return napSplitters.find(
      (s) => s.inputCableId === cableId && s.inputFiberId === fiberId,
    )
  }

  /** Todos los pelos de la bandeja (libres y fusionados). */
  const trayEnds: TrayFiberEnd[] = []
  trayTubes.forEach((ref, tubeIndex) => {
    const resolved = resolveTube(ref)
    if (!resolved) return
    const side = tubeIndex % 2 === 0 ? 'left' : 'right'
    for (const f of fibersOfTubeInTray(ref, resolved.tube)) {
      trayEnds.push({
        cableId: ref.cableId,
        tubeId: ref.tubeId,
        fiberId: f.id,
        cableName: resolved.cable.name || 'Cable',
        tubeName: resolved.tube.name,
        tubeColor: resolved.tube.color,
        tubeTracer: resolved.tube.tracer,
        fiber: f,
        side,
        connection: connectionOfFiber(ref.cableId, f.id),
        splitterFeed: splitterFedBy(ref.cableId, f.id),
      })
    }
  })
  receivedFibers.forEach((ref, i) => {
    const resolved = resolveTube(ref)
    const fiber = resolved?.tube.fibers.find((f) => f.id === ref.fiberId)
    if (!resolved || !fiber) return
    trayEnds.push({
      cableId: ref.cableId,
      tubeId: ref.tubeId,
      fiberId: ref.fiberId,
      cableName: resolved.cable.name || 'Cable',
      tubeName: resolved.tube.name,
      tubeColor: resolved.tube.color,
      tubeTracer: resolved.tube.tracer,
      fiber,
      side: i % 2 === 0 ? 'left' : 'right',
      received: true,
      connection: connectionOfFiber(ref.cableId, ref.fiberId),
      splitterFeed: splitterFedBy(ref.cableId, ref.fiberId),
    })
  })

  // Splitters como “cables” conectables en el lado derecho de la bandeja
  const splitterEnds: TrayFiberEnd[] = napSplitters.map((s) => {
    const input =
      s.inputCableId && s.inputFiberId
        ? findFiberInCable(
            cableById.get(s.inputCableId),
            s.inputFiberId,
          )
        : null
    return {
      cableId: splitterCableId(s.id),
      tubeId: 'input',
      fiberId: 'in',
      cableName: s.name,
      tubeName: `1:${s.ratio}`,
      tubeColor: '#0891b2',
      tubeTracer: null,
      fiber: {
        id: 'in',
        name: 'Entrada',
        color: input?.fiber.color ?? '#22d3ee',
        tracer: input?.fiber.tracer ?? null,
      },
      side: 'right' as const,
      asSplitter: s,
    }
  })

  const leftEnds = trayEnds.filter((e) => e.side === 'left')
  const rightEnds = [
    ...trayEnds.filter((e) => e.side === 'right'),
    ...splitterEnds,
  ]

  /** Espacios del peine: cada fusión ocupa uno; se puede mover a cualquiera. */
  const MIN_SLOTS = 12
  const slotOf = new Map<string, number>()
  {
    const taken = new Set<number>()
    for (const c of trayConnections) {
      if (typeof c.slot === 'number' && c.slot >= 0 && !taken.has(c.slot)) {
        slotOf.set(c.id, c.slot)
        taken.add(c.slot)
      }
    }
    let next = 0
    for (const c of trayConnections) {
      if (slotOf.has(c.id)) continue
      while (taken.has(next)) next++
      slotOf.set(c.id, next)
      taken.add(next)
    }
  }
  const slotCount = Math.max(
    MIN_SLOTS,
    ...(trayConnections.length
      ? trayConnections.map((c) => (slotOf.get(c.id) ?? 0) + 1)
      : [0]),
  )
  const connBySlot = new Map<number, MufaConnection>()
  for (const c of trayConnections) {
    connBySlot.set(slotOf.get(c.id) ?? 0, c)
  }

  /** Mueve un manguito a un espacio; si está ocupado, intercambia. */
  function moveConnectionToSlot(connId: string, targetSlot: number) {
    const current = slotOf.get(connId)
    if (current === targetSlot) return
    const occupant = connBySlot.get(targetSlot)
    const next = connections.map((c) => {
      if (c.id === connId) return { ...c, slot: targetSlot }
      if (occupant && c.id === occupant.id) {
        return { ...c, slot: current ?? 0 }
      }
      return c
    })
    onChange({ ...mufa!, connections: next })
  }

  function resolveTube(ref: MufaTubeRef): {
    cable: MapDraftElement
    tube: MiniTube
  } | null {
    const cable = cableById.get(ref.cableId)
    if (!cable) return null
    const tube = findTube(cable, ref.tubeId)
    if (!tube) return null
    return { cable, tube }
  }

  function updateTrays(
    nextTrays: typeof trays,
    nextConnections = connections,
  ) {
    onChange({
      ...mufa!,
      trays: nextTrays,
      connections: nextConnections,
      ...(isNap ? { splitters: mufa!.splitters ?? napSplitters } : {}),
    })
  }

  function connectFiberToSplitter(
    fiber: Omit<FiberDrag, 'kind'>,
    splitterId: string,
  ) {
    if (parseSplitterCableId(fiber.cableId)) {
      setHint('Une un pelo de cable a la entrada del splitter.')
      return
    }
    if (
      !fiberBelongsToTray(
        trays,
        trayId,
        fiber.cableId,
        fiber.tubeId,
        fiber.fiberId,
      )
    ) {
      setHint('El pelo debe estar en esta bandeja.')
      return
    }
    if (connectionOfFiber(fiber.cableId, fiber.fiberId)) {
      setHint('Ese pelo ya tiene una fusión. Quítala primero.')
      return
    }
    const target = napSplitters.find((s) => s.id === splitterId)
    if (!target) return
    if (
      target.inputCableId &&
      target.inputFiberId &&
      (target.inputCableId !== fiber.cableId ||
        target.inputFiberId !== fiber.fiberId)
    ) {
      setHint('Ese splitter ya tiene entrada. Libérala primero.')
      return
    }
    const nextSplitters = napSplitters.map((s) => {
      if (s.id === splitterId) {
        return {
          ...s,
          inputCableId: fiber.cableId,
          inputFiberId: fiber.fiberId,
        }
      }
      if (
        s.inputCableId === fiber.cableId &&
        s.inputFiberId === fiber.fiberId
      ) {
        return { ...s, inputCableId: null, inputFiberId: null }
      }
      return s
    })
    onChange({
      ...mufa!,
      trays,
      connections,
      splitters: nextSplitters,
    })
    setFusePick(null)
    setHint(`Pelo conectado a ${target.name}.`)
  }

  function clearSplitterInput(splitterId: string) {
    onChange({
      ...mufa!,
      trays,
      connections,
      splitters: napSplitters.map((s) =>
        s.id === splitterId
          ? { ...s, inputCableId: null, inputFiberId: null }
          : s,
      ),
    })
    setHint('Entrada del splitter liberada.')
  }

  function assignTubeToTray(ref: Omit<TubeDrag, 'kind'>, targetTrayId: string) {
    const cable = cableById.get(ref.cableId)
    if (!cable || !findTube(cable, ref.tubeId)) {
      setHint('Minitubo no válido.')
      return
    }
    const key = `${ref.cableId}:${ref.tubeId}`
    const tubeFiberIds = new Set(
      (findTube(cable, ref.tubeId)?.fibers ?? []).map((f) => f.id),
    )
    // Mover tubo; limpia overrides de pelos que apuntaban a la bandeja destino
    // (vuelven a vivir con el tubo).
    const nextTrays = trays.map((t) => {
      const tubesWithout = (t.tubes ?? []).filter(
        (r) => !(r.cableId === ref.cableId && r.tubeId === ref.tubeId),
      )
      const fibersClean = (t.fibers ?? []).filter((f) => {
        if (f.cableId !== ref.cableId || f.tubeId !== ref.tubeId) return true
        // Si el override era a la bandeja destino, ya no hace falta.
        if (t.id === targetTrayId) return false
        return true
      })
      if (t.id !== targetTrayId) {
        return { ...t, tubes: tubesWithout, fibers: fibersClean }
      }
      return {
        ...t,
        tubes: [...tubesWithout, ref],
        fibers: fibersClean,
      }
    })
    const nextConns = connections.filter((c) => {
      if (c.trayId === targetTrayId) return true
      if (c.fromCableId === ref.cableId && tubeFiberIds.has(c.fromFiberId)) {
        return false
      }
      if (c.toCableId === ref.cableId && tubeFiberIds.has(c.toFiberId)) {
        return false
      }
      return true
    })
    updateTrays(nextTrays, nextConns)
    setTrayId(targetTrayId)
    setHint(
      assignedKeys.has(key)
        ? 'Minitubo movido a esta bandeja.'
        : 'Minitubo asignado a la bandeja.',
    )
  }

  function assignFiberToTray(
    ref: Omit<FiberDrag, 'kind'>,
    targetTrayId: string,
  ) {
    const found = findFiberInCable(cableById.get(ref.cableId), ref.fiberId)
    if (!found || found.tube.id !== ref.tubeId) {
      setHint('Pelo no válido.')
      return
    }
    const homeTray = trays.find((t) =>
      (t.tubes ?? []).some(
        (r) => r.cableId === ref.cableId && r.tubeId === ref.tubeId,
      ),
    )
    if (!homeTray) {
      setHint('Asigna primero el minitubo a una bandeja.')
      return
    }
    const goingHome = homeTray.id === targetTrayId
    const nextTrays = trays.map((t) => {
      const without = (t.fibers ?? []).filter(
        (f) => !(f.cableId === ref.cableId && f.fiberId === ref.fiberId),
      )
      if (goingHome || t.id !== targetTrayId) {
        return { ...t, fibers: without }
      }
      return {
        ...t,
        fibers: [
          ...without,
          {
            cableId: ref.cableId,
            tubeId: ref.tubeId,
            fiberId: ref.fiberId,
          },
        ],
      }
    })
    const nextConns = connections.filter((c) => {
      const involves =
        (c.fromCableId === ref.cableId && c.fromFiberId === ref.fiberId) ||
        (c.toCableId === ref.cableId && c.toFiberId === ref.fiberId)
      if (!involves) return true
      return c.trayId === targetTrayId
    })
    updateTrays(nextTrays, nextConns)
    setTrayId(targetTrayId)
    setHint(
      goingHome
        ? 'Pelo devuelto a la bandeja de su minitubo.'
        : 'Pelo movido a esta bandeja.',
    )
  }

  /** Devuelve un pelo recibido a la bandeja donde vive su minitubo. */
  function returnFiberHome(ref: Omit<FiberDrag, 'kind'>) {
    if (connectionOfFiber(ref.cableId, ref.fiberId)) {
      setHint('Ese pelo tiene una fusión aquí. Quita el manguito primero.')
      return
    }
    const nextTrays = trays.map((t) => ({
      ...t,
      fibers: (t.fibers ?? []).filter(
        (f) => !(f.cableId === ref.cableId && f.fiberId === ref.fiberId),
      ),
    }))
    updateTrays(nextTrays)
    setHint('Pelo devuelto a la bandeja de su minitubo.')
  }

  function removeTubeFromTray(ref: MufaTubeRef) {
    const cable = cableById.get(ref.cableId)
    const fiberIds = new Set(
      (findTube(cable, ref.tubeId)?.fibers ?? []).map((f) => f.id),
    )
    const nextTrays = trays.map((t) =>
      t.id !== trayId
        ? t
        : {
            ...t,
            tubes: (t.tubes ?? []).filter(
              (r) =>
                !(r.cableId === ref.cableId && r.tubeId === ref.tubeId),
            ),
            // Si quitas el tubo de aquí, los pelos “recibidos” de ese tubo
            // en otras bandejas se mantienen; aquí solo limpiamos locales.
            fibers: (t.fibers ?? []).filter(
              (f) =>
                !(f.cableId === ref.cableId && f.tubeId === ref.tubeId),
            ),
          },
    )
    const nextConns = connections.filter((c) => {
      if (c.trayId !== trayId) return true
      if (c.fromCableId === ref.cableId && fiberIds.has(c.fromFiberId)) {
        return false
      }
      if (c.toCableId === ref.cableId && fiberIds.has(c.toFiberId)) {
        return false
      }
      return true
    })
    updateTrays(nextTrays, nextConns)
  }

  function connectFibers(
    from: Omit<FiberDrag, 'kind'>,
    to: Omit<FiberDrag, 'kind'>,
  ) {
    const fromSpl = parseSplitterCableId(from.cableId)
    const toSpl = parseSplitterCableId(to.cableId)
    if (fromSpl && toSpl) {
      setHint('Conecta un pelo de fibra a la entrada del splitter.')
      return
    }
    if (toSpl) {
      connectFiberToSplitter(from, toSpl)
      return
    }
    if (fromSpl) {
      connectFiberToSplitter(to, fromSpl)
      return
    }
    if (
      from.cableId === to.cableId &&
      from.fiberId === to.fiberId
    ) {
      setHint('No puedes unir un pelo consigo mismo.')
      return
    }
    if (
      !fiberBelongsToTray(
        trays,
        trayId,
        from.cableId,
        from.tubeId,
        from.fiberId,
      ) ||
      !fiberBelongsToTray(trays, trayId, to.cableId, to.tubeId, to.fiberId)
    ) {
      setHint('Solo puedes unir pelos que estén en esta bandeja.')
      return
    }
    if (
      splitterFedBy(from.cableId, from.fiberId) ||
      splitterFedBy(to.cableId, to.fiberId)
    ) {
      setHint('Uno de esos pelos alimenta un splitter. Libéralo primero.')
      return
    }
    const dup = connections.some(
      (c) =>
        (c.fromCableId === from.cableId &&
          c.fromFiberId === from.fiberId &&
          c.toCableId === to.cableId &&
          c.toFiberId === to.fiberId) ||
        (c.fromCableId === to.cableId &&
          c.fromFiberId === to.fiberId &&
          c.toCableId === from.cableId &&
          c.toFiberId === from.fiberId),
    )
    if (dup) {
      setHint('Esa unión ya existe.')
      return
    }
    const endpointUsed = connections.some(
      (c) =>
        (c.fromCableId === from.cableId &&
          c.fromFiberId === from.fiberId) ||
        (c.toCableId === from.cableId && c.toFiberId === from.fiberId) ||
        (c.fromCableId === to.cableId && c.fromFiberId === to.fiberId) ||
        (c.toCableId === to.cableId && c.toFiberId === to.fiberId),
    )
    if (endpointUsed) {
      setHint('Uno de esos pelos ya tiene una fusión. Quítala primero.')
      return
    }
    let freeSlot = 0
    while (connBySlot.has(freeSlot)) freeSlot++
    const conn: MufaConnection = {
      id: newConnectionId(),
      trayId,
      fromCableId: from.cableId,
      fromFiberId: from.fiberId,
      toCableId: to.cableId,
      toFiberId: to.fiberId,
      slot: freeSlot,
    }
    onChange({
      ...mufa!,
      trays,
      connections: [...connections, conn],
      ...(isNap ? { splitters: napSplitters } : {}),
    })
    setFusePick(null)
    setHint('Unión creada.')
  }

  async function removeConnection(id: string) {
    const ok = await confirm('¿Eliminar esta unión de pelos?', {
      title: 'Eliminar unión',
      danger: true,
      confirmLabel: 'Eliminar',
    })
    if (!ok) return
    onChange({
      ...mufa!,
      connections: connections.filter((c) => c.id !== id),
    })
  }

  function renderStrandEnd(end: TrayFiberEnd) {
    const key = fiberKey(end.cableId, end.fiberId)
    const side = end.side
    const dragRef = {
      cableId: end.cableId,
      tubeId: end.tubeId,
      fiberId: end.fiberId,
    }
    const conn = end.connection
    const feed = end.splitterFeed
    const asSpl = end.asSplitter

    // Splitter como “cable”: entrada libre o ya alimentada
    if (asSpl) {
      const linked =
        asSpl.inputCableId && asSpl.inputFiberId
          ? findFiberInCable(
              cableById.get(asSpl.inputCableId),
              asSpl.inputFiberId,
            )
          : null
      const cableName =
        (asSpl.inputCableId &&
          cableById.get(asSpl.inputCableId)?.name) ||
        'Cable'
      return (
        <div
          key={key}
          onDragOver={(e) => {
            if (!fiberDragRef.current) return
            if (parseSplitterCableId(fiberDragRef.current.cableId)) return
            e.preventDefault()
            e.stopPropagation()
            e.dataTransfer.dropEffect = 'copy'
            setDragOverFiber(key)
          }}
          onDragLeave={() =>
            setDragOverFiber((prev) => (prev === key ? null : prev))
          }
          onDrop={(e) => {
            e.preventDefault()
            e.stopPropagation()
            setDragOverFiber(null)
            const from =
              fiberDragRef.current ??
              (() => {
                const p = parseDragPayload(e)
                return p?.kind === 'fiber'
                  ? {
                      cableId: p.cableId,
                      tubeId: p.tubeId,
                      fiberId: p.fiberId,
                    }
                  : null
              })()
            fiberDragRef.current = null
            if (!from || parseSplitterCableId(from.cableId)) return
            connectFiberToSplitter(from, asSpl.id)
          }}
          onClick={(e) => {
            e.stopPropagation()
            if (linked) return
            if (!fusePick) {
              setFusePick(dragRef)
              setHint('Selecciona el pelo que alimentará este splitter')
              return
            }
            if (parseSplitterCableId(fusePick.cableId)) {
              setFusePick(null)
              return
            }
            connectFiberToSplitter(fusePick, asSpl.id)
          }}
          title={
            linked
              ? `${asSpl.name} · entrada: ${cableName} · ${linked.fiber.name}`
              : `${asSpl.name} · suelta un pelo aquí para alimentar el splitter`
          }
          className={[
            'flex h-9 w-full items-center gap-1.5 rounded-md border border-cyan-500/40 bg-cyan-500/5 px-1 transition',
            side === 'right' ? 'flex-row-reverse' : '',
            dragOverFiber === key ||
            (fusePick?.cableId === end.cableId &&
              fusePick?.fiberId === end.fiberId)
              ? 'ring-2 ring-cyan-400'
              : 'hover:bg-cyan-500/10',
          ].join(' ')}
        >
          <span className="flex h-5 w-2.5 shrink-0 items-center justify-center rounded-sm bg-cyan-600 text-[8px] font-bold text-white">
            S
          </span>
          <div
            className={[
              'min-w-0 shrink-0',
              side === 'right' ? 'text-right' : '',
            ].join(' ')}
          >
            <div className="max-w-[9rem] truncate text-xs font-medium text-cyan-200">
              {asSpl.name}
            </div>
            <div className="max-w-[9rem] truncate text-[11px] text-[var(--text-muted)]">
              {linked
                ? `${cableName} · ${linked.fiber.name.replace(/^Pelo\s*/i, 'P')}`
                : `1:${asSpl.ratio} · entrada libre`}
            </div>
          </div>
          <span
            className="h-[3px] min-w-6 flex-1 rounded-full"
            style={{
              background: linked
                ? strandBackground(linked.fiber.color, linked.fiber.tracer)
                : '#22d3ee',
            }}
            aria-hidden
          />
          {linked ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                clearSplitterInput(asSpl.id)
              }}
              className="shrink-0 rounded-sm border border-cyan-400/50 bg-cyan-600/30 px-1.5 text-[10px] font-bold text-cyan-100 hover:bg-red-500/30"
              title="Liberar entrada"
            >
              ✕
            </button>
          ) : (
            <span className="relative z-20 h-4 w-4 shrink-0 rounded-full border-2 border-cyan-200 bg-cyan-500 shadow" />
          )}
        </div>
      )
    }

    // Pelo que alimenta un splitter
    if (feed) {
      return (
        <div
          key={key}
          className={[
            'flex h-9 w-full items-center gap-1.5 rounded-md px-1 transition',
            side === 'right' ? 'flex-row-reverse' : '',
            'bg-cyan-500/10 ring-1 ring-cyan-500/40',
          ].join(' ')}
          title={`${end.fiber.name} → ${feed.name}`}
        >
          <span
            className="h-5 w-2.5 shrink-0 rounded-full border border-black/20"
            style={{
              background: strandBackground(end.tubeColor, end.tubeTracer),
            }}
          />
          <div
            className={[
              'min-w-0 shrink-0',
              side === 'right' ? 'text-right' : '',
            ].join(' ')}
          >
            <div className="max-w-[9rem] truncate text-xs font-medium">
              {end.fiber.name.replace(/^Pelo\s*/i, 'P')}
            </div>
            <div className="max-w-[9rem] truncate text-[11px] text-[var(--text-muted)]">
              {end.cableName}
            </div>
          </div>
          <span
            className="h-[3px] min-w-6 flex-1 rounded-full"
            style={{
              background: strandBackground(end.fiber.color, end.fiber.tracer),
            }}
          />
          <span className="shrink-0 rounded-sm border border-cyan-400/60 bg-cyan-600/40 px-1.5 text-[10px] font-bold text-cyan-100">
            {feed.name.replace(/^Splitter\s*/i, 'S')}
          </span>
        </div>
      )
    }

    if (conn) {
      // Pelo ya fusionado: se muestra "conectado" hacia el peine central.
      const slot = slotOf.get(conn.id) ?? 0
      const highlighted = hoverConn === conn.id
      return (
        <div
          key={key}
          onMouseEnter={() => setHoverConn(conn.id)}
          onMouseLeave={() =>
            setHoverConn((prev) => (prev === conn.id ? null : prev))
          }
          title={`${end.fiber.name} · fusionado en el espacio ${slot + 1}`}
          className={[
            'flex h-9 w-full items-center gap-1.5 rounded-md px-1 transition',
            side === 'right' ? 'flex-row-reverse' : '',
            highlighted ? 'bg-[#eab308]/15 ring-1 ring-[#d4a72c]' : '',
          ].join(' ')}
        >
          <span
            className="h-5 w-2.5 shrink-0 rounded-full border border-black/20"
            style={{
              background: strandBackground(end.tubeColor, end.tubeTracer),
            }}
            title={end.tubeName}
          />
          <div
            className={[
              'min-w-0 shrink-0',
              side === 'right' ? 'text-right' : '',
            ].join(' ')}
          >
            <div className="max-w-[9rem] truncate text-xs font-medium">
              {end.fiber.name.replace(/^Pelo\s*/i, 'P')}
            </div>
            <div className="max-w-[9rem] truncate text-[11px] text-[var(--text-muted)]">
              {end.cableName}
              {end.received ? ' · recibido' : ''}
            </div>
          </div>
          <span
            className="h-[3px] min-w-6 flex-1 rounded-full opacity-90"
            style={{
              background: strandBackground(end.fiber.color, end.fiber.tracer),
            }}
            aria-hidden
          />
          <span
            className={[
              'shrink-0 rounded-sm border border-[#fde68a] bg-gradient-to-b from-[#f5d76e] to-[#d4a72c] px-1.5 text-[10px] font-bold text-[#5b3b0a]',
              highlighted ? 'ring-2 ring-[var(--accent)]' : '',
            ].join(' ')}
            title={`Fusión en espacio ${slot + 1}`}
          >
            {slot + 1}
          </span>
        </div>
      )
    }
    return (
      <div
        key={key}
        draggable
        onDragStart={(e) => {
          e.stopPropagation()
          onFiberDragStart(e, dragRef)
        }}
        onDragEnd={() => {
          fiberDragRef.current = null
          setDragOverFiber(null)
        }}
        onDragOver={(e) => {
          // Aceptar solo si hay un pelo en drag (ref, no MIME — más fiable)
          if (!fiberDragRef.current) return
          e.preventDefault()
          e.stopPropagation()
          e.dataTransfer.dropEffect = 'copy'
          setDragOverFiber(key)
        }}
        onDragLeave={() =>
          setDragOverFiber((prev) => (prev === key ? null : prev))
        }
        onDrop={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setDragOverFiber(null)
          const from =
            fiberDragRef.current ??
            (() => {
              const p = parseDragPayload(e)
              return p?.kind === 'fiber'
                ? {
                    cableId: p.cableId,
                    tubeId: p.tubeId,
                    fiberId: p.fiberId,
                  }
                : null
            })()
          fiberDragRef.current = null
          if (!from) return
          connectFibers(from, dragRef)
        }}
        onClick={(e) => {
          // Click-to-fuse: primer click selecciona, segundo une
          e.stopPropagation()
          if (!fusePick) {
            setFusePick(dragRef)
            setHint('Selecciona el otro pelo para fusionar')
            return
          }
          if (
            fusePick.cableId === dragRef.cableId &&
            fusePick.fiberId === dragRef.fiberId
          ) {
            setFusePick(null)
            setHint(null)
            return
          }
          connectFibers(fusePick, dragRef)
        }}
        title={`${end.fiber.name} · arrastra o haz click sobre otro pelo para fusionar`}
        className={[
          'flex h-9 w-full cursor-grab items-center gap-1.5 rounded-md px-1 transition active:cursor-grabbing',
          side === 'right' ? 'flex-row-reverse' : '',
          dragOverFiber === key ||
          (fusePick?.cableId === end.cableId &&
            fusePick?.fiberId === end.fiberId)
            ? 'bg-[var(--accent)]/15 ring-2 ring-[var(--accent)]'
            : 'hover:bg-white/5',
        ].join(' ')}
      >
        <span
          className="h-5 w-2.5 shrink-0 rounded-full border border-black/20"
          style={{
            background: strandBackground(end.tubeColor, end.tubeTracer),
          }}
          title={end.tubeName}
        />
        <div
          className={[
            'min-w-0 shrink-0',
            side === 'right' ? 'text-right' : '',
          ].join(' ')}
        >
          <div className="max-w-[9rem] truncate text-xs font-medium">
            {end.fiber.name.replace(/^Pelo\s*/i, 'P')}
          </div>
          <div className="max-w-[9rem] truncate text-[11px] text-[var(--text-muted)]">
            {end.cableName}
            {end.received ? ' · recibido' : ''}
          </div>
        </div>
        {end.received && (
          <button
            type="button"
            onClick={() => returnFiberHome(dragRef)}
            title="Devolver a la bandeja de su minitubo"
            className="shrink-0 rounded px-0.5 text-[11px] text-[var(--text-muted)] hover:bg-white/10 hover:text-red-300"
          >
            ↩
          </button>
        )}
        <span
          className="h-[3px] min-w-6 flex-1 rounded-full"
          style={{
            background: strandBackground(end.fiber.color, end.fiber.tracer),
          }}
          aria-hidden
        />
        <span
          className="relative z-20 h-4 w-4 shrink-0 rounded-full border-2 border-white/90 shadow"
          style={{
            background: strandBackground(end.fiber.color, end.fiber.tracer),
          }}
          aria-hidden
        />
      </div>
    )
  }

  function onSleeveDragStart(e: DragEvent, id: string) {
    sleeveDragRef.current = id
    fiberDragRef.current = null
    e.dataTransfer.setData(DND_SLEEVE, id)
    e.dataTransfer.setData(DND_TEXT, id)
    e.dataTransfer.effectAllowed = 'move'
  }

  /** Espacio del peine: vacío (acepta manguitos) o con un manguito. */
  function renderSlot(slotIdx: number) {
    const c = connBySlot.get(slotIdx)
    const isDragTarget = dragOverSlot === slotIdx

    if (!c) {
      return (
        <div
          key={`slot-${slotIdx}`}
          onDragOver={(e) => {
            if (!sleeveDragRef.current) return
            e.preventDefault()
            e.stopPropagation()
            e.dataTransfer.dropEffect = 'move'
            setDragOverSlot(slotIdx)
          }}
          onDragLeave={() =>
            setDragOverSlot((prev) => (prev === slotIdx ? null : prev))
          }
          onDrop={(e) => {
            e.preventDefault()
            e.stopPropagation()
            setDragOverSlot(null)
            const fromId =
              sleeveDragRef.current || e.dataTransfer.getData(DND_SLEEVE)
            sleeveDragRef.current = null
            if (fromId) moveConnectionToSlot(fromId, slotIdx)
          }}
          className={[
            'flex h-9 items-center gap-1 rounded px-1 transition',
            isDragTarget ? 'bg-[var(--accent)]/20 ring-2 ring-[var(--accent)]' : '',
          ].join(' ')}
          title={`Espacio ${slotIdx + 1} libre`}
        >
          <span className="w-4 shrink-0 text-right text-[9px] text-[#92400e]/60">
            {slotIdx + 1}
          </span>
          <span className="h-5 flex-1 rounded-sm border border-dashed border-[#d4a72c]/40" />
        </div>
      )
    }

    const a = findFiberInCable(cableById.get(c.fromCableId), c.fromFiberId)
    const b = findFiberInCable(cableById.get(c.toCableId), c.toFiberId)
    const aColor = a ? strandBackground(a.fiber.color, a.fiber.tracer) : '#94a3b8'
    const bColor = b ? strandBackground(b.fiber.color, b.fiber.tracer) : '#94a3b8'
    const highlighted = hoverConn === c.id
    return (
      <div
        key={`slot-${slotIdx}`}
        draggable
        onDragStart={(e) => onSleeveDragStart(e, c.id)}
        onDragEnd={() => {
          sleeveDragRef.current = null
          setDragOverSlot(null)
        }}
        onDragOver={(e) => {
          if (!sleeveDragRef.current || sleeveDragRef.current === c.id) return
          e.preventDefault()
          e.stopPropagation()
          e.dataTransfer.dropEffect = 'move'
          setDragOverSlot(slotIdx)
        }}
        onDragLeave={() =>
          setDragOverSlot((prev) => (prev === slotIdx ? null : prev))
        }
        onDrop={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setDragOverSlot(null)
          const fromId =
            sleeveDragRef.current || e.dataTransfer.getData(DND_SLEEVE)
          sleeveDragRef.current = null
          if (fromId) moveConnectionToSlot(fromId, slotIdx)
        }}
        onMouseEnter={() => setHoverConn(c.id)}
        onMouseLeave={() =>
          setHoverConn((prev) => (prev === c.id ? null : prev))
        }
        className={[
          'flex h-9 cursor-grab items-center gap-1 rounded px-1 transition active:cursor-grabbing',
          isDragTarget || highlighted
            ? 'bg-[var(--accent)]/15 ring-2 ring-[var(--accent)]'
            : '',
        ].join(' ')}
        title={`Espacio ${slotIdx + 1} · ${cableById.get(c.fromCableId)?.name || 'Cable'} · ${a?.fiber.name ?? 'pelo'}  ↔  ${cableById.get(c.toCableId)?.name || 'Cable'} · ${b?.fiber.name ?? 'pelo'}`}
      >
        <span className="w-4 shrink-0 text-right text-[9px] font-semibold text-[#92400e]">
          {slotIdx + 1}
        </span>
        <span
          className="h-[3px] w-4 shrink-0 rounded-full sm:w-8"
          style={{ background: aColor }}
        />
        <div className="relative z-10 flex h-7 flex-1 items-center justify-center rounded-sm border border-[#fde68a] bg-gradient-to-b from-[#f5d76e] to-[#d4a72c] shadow-sm">
          <span className="pointer-events-none absolute inset-x-2 top-1/2 h-[2px] -translate-y-1/2 bg-white/35" />
          <button
            type="button"
            onClick={() => void removeConnection(c.id)}
            className="relative z-10 rounded px-1 text-[10px] font-semibold text-[#5b3b0a]/80 hover:bg-black/10"
            title="Quitar fusión"
          >
            ✕
          </button>
        </div>
        <span
          className="h-[3px] w-4 shrink-0 rounded-full sm:w-8"
          style={{ background: bColor }}
        />
      </div>
    )
  }

  function onTubeDragStart(e: DragEvent, drag: Omit<TubeDrag, 'kind'>) {
    fiberDragRef.current = null
    sleeveDragRef.current = null
    const payload = JSON.stringify({ kind: 'tube', ...drag })
    e.dataTransfer.setData(DND_TUBE, payload)
    e.dataTransfer.setData(DND_TEXT, payload)
    e.dataTransfer.effectAllowed = 'move'
  }

  function onFiberDragStart(e: DragEvent, drag: Omit<FiberDrag, 'kind'>) {
    fiberDragRef.current = drag
    sleeveDragRef.current = null
    const payload = JSON.stringify({ kind: 'fiber', ...drag })
    e.dataTransfer.setData(DND_FIBER, payload)
    e.dataTransfer.setData(DND_TEXT, payload)
    e.dataTransfer.effectAllowed = 'all'
  }

  /** Solo tubos en el board; pelos se mueven entre bandejas por las pestañas. */
  function handleBoardDrop(targetTrayId: string, e: DragEvent) {
    const drag = parseDragPayload(e)
    if (drag?.kind === 'tube') assignTubeToTray(drag, targetTrayId)
  }

  function handleTrayTabDrop(targetTrayId: string, e: DragEvent) {
    const drag = parseDragPayload(e)
    if (drag?.kind === 'tube') assignTubeToTray(drag, targetTrayId)
    else if (drag?.kind === 'fiber') assignFiberToTray(drag, targetTrayId)
  }

  const body = (
    <>
        {!embedded && (
        <div
          className={[
            'flex shrink-0 items-center justify-between border-b border-[var(--border)] px-4 py-3 sm:px-5',
            mobile ? 'modal-safe-header' : '',
          ].join(' ')}
        >
          <div className="flex items-center gap-3">
            <MapElementTypeIcon type={isNap ? 'nap' : 'mufa'} size={40} />
            <div>
              <h2 className="text-lg font-semibold">
                {mufa.name || (isNap ? 'NAP' : 'Mufa')}
              </h2>
              <p className="text-xs text-[var(--text-muted)]">
                Arrastra minitubos o pelos a bandejas · pelo → pelo para unir
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {onEdit && (
              <button
                type="button"
                onClick={() => onEdit(mufa)}
                className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm hover:bg-[var(--bg)]"
              >
                Editar
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="rounded-md px-2 py-1 text-[var(--text-muted)] hover:bg-[var(--bg)]"
            >
              ✕
            </button>
          </div>
        </div>
        )}

        <div
          className={[
            'grid min-h-0 flex-1 gap-3 overflow-hidden p-3 sm:p-4',
            mobile
              ? 'grid-rows-[minmax(9rem,32%)_minmax(0,1fr)]'
              : 'sm:grid-cols-[240px_1fr]',
          ].join(' ')}
        >
          {/* Cables entrantes */}
          <aside className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg)]">
            <div className="border-b border-[var(--border)] px-3 py-2 text-xs font-semibold tracking-wide text-[var(--text-muted)] uppercase">
              Cables entrantes
              {mobile ? (
                <span className="ml-1 font-normal normal-case text-[var(--text-muted)]">
                  · arrastrá a bandeja
                </span>
              ) : null}
            </div>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
              {cables.length === 0 ? (
                <p className="text-xs text-[var(--text-muted)]">
                  Engancha cables a esta mufa o asígnalos al editar.
                </p>
              ) : (
                cables.map((c) => {
                  const tubes = cableTubes(c)
                  return (
                    <div key={c.id} className="space-y-1.5">
                      <div className="text-sm font-medium">
                        {c.name || 'Cable'}
                        <span className="ml-1.5 text-[11px] font-normal text-[var(--text-muted)]">
                          {tubes.length} tubos
                        </span>
                      </div>
                      <ul className="space-y-1">
                        {tubes.map((tube) => {
                          const key = `${c.id}:${tube.id}`
                          const assigned = assignedKeys.has(key)
                          return (
                            <li key={tube.id}>
                              <button
                                type="button"
                                draggable
                                onDragStart={(e) =>
                                  onTubeDragStart(e, {
                                    cableId: c.id,
                                    tubeId: tube.id,
                                  })
                                }
                                className={[
                                  'flex w-full cursor-grab items-center gap-2 rounded-lg border px-2 py-1.5 text-left active:cursor-grabbing',
                                  assigned
                                    ? 'border-[var(--accent)]/40 bg-[var(--accent)]/10 opacity-70'
                                    : 'border-[var(--border)] bg-[var(--bg-elevated)] hover:border-[var(--accent)]/50',
                                ].join(' ')}
                                title={
                                  assigned
                                    ? 'Ya asignado · arrastra a otra bandeja'
                                    : 'Arrastra a una bandeja'
                                }
                              >
                                <span
                                  className="h-8 w-4 shrink-0 rounded-full border border-black/25 shadow-inner"
                                  style={{
                                    background: strandBackground(
                                      tube.color,
                                      tube.tracer,
                                    ),
                                  }}
                                />
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate text-xs font-medium">
                                    {tube.name}
                                  </span>
                                  <span className="mt-0.5 flex gap-0.5">
                                    {tube.fibers.slice(0, 12).map((f) => (
                                      <span
                                        key={f.id}
                                        className="inline-block h-2 w-2 rounded-full border border-black/15"
                                        style={{
                                          background: strandBackground(
                                            f.color,
                                            f.tracer,
                                          ),
                                        }}
                                      />
                                    ))}
                                  </span>
                                </span>
                              </button>
                            </li>
                          )
                        })}
                      </ul>
                    </div>
                  )
                })
              )}

              {isNap && napSplitters.length > 0 && (
                <div className="space-y-1.5 border-t border-[var(--border)] pt-3">
                  <div className="text-xs font-semibold tracking-wide text-cyan-300 uppercase">
                    Splitters
                  </div>
                  <p className="text-[11px] text-[var(--text-muted)]">
                    Aparecen a la derecha de la bandeja · arrastra un pelo a su
                    entrada
                  </p>
                  {napSplitters.map((s) => (
                    <div
                      key={s.id}
                      className="rounded-lg border border-cyan-500/40 bg-cyan-500/5 px-2 py-1.5 text-xs"
                    >
                      <div className="font-medium text-cyan-200">{s.name}</div>
                      <div className="text-[11px] text-[var(--text-muted)]">
                        1:{s.ratio}
                        {s.inputFiberId ? ' · con entrada' : ' · sin entrada'}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </aside>

          {/* Bandejas */}
          <section className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg)]">
            <div className="flex shrink-0 gap-1.5 overflow-x-auto border-b border-[var(--border)] p-2">
              {trays.map((t, i) => {
                const active = t.id === trayId
                const nTubes = t.tubes?.length ?? 0
                const nMoved = t.fibers?.length ?? 0
                const nConns = connections.filter(
                  (c) => c.trayId === t.id,
                ).length
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => {
                      setTrayId(t.id)
                      setFusePick(null)
                    }}
                    onDragOver={(e) => {
                      e.preventDefault()
                      e.dataTransfer.dropEffect = 'move'
                    }}
                    onDrop={(e) => {
                      e.preventDefault()
                      handleTrayTabDrop(t.id, e)
                    }}
                    className={[
                      'relative flex h-14 min-w-[4.5rem] flex-col items-center justify-center rounded-md border-2 px-2 transition',
                      active
                        ? 'border-[var(--accent)] bg-[var(--accent)]/15'
                        : 'border-[var(--border)] bg-[var(--bg-elevated)] hover:border-[var(--accent)]/40',
                    ].join(' ')}
                    style={{
                      boxShadow: `inset 0 -5px 0 ${['#2563eb', '#f97316', '#16a34a', '#dc2626', '#9333ea', '#eab308'][i % 6]}66`,
                    }}
                  >
                    <span className="text-[11px] font-semibold">
                      {t.name.replace(/^Bandeja\s*/i, 'B') || `B${i + 1}`}
                    </span>
                    <span className="text-[10px] text-[var(--text-muted)]">
                      {nTubes}t
                      {nMoved > 0 ? ` · ${nMoved}p` : ''} · {nConns}u
                    </span>
                  </button>
                )
              })}
            </div>

            <div
              ref={trayBoardRef}
              className={[
                'relative min-h-0 flex-1 overflow-auto p-3 transition',
                mobile ? 'overflow-x-auto' : '',
                dragOverTray
                  ? 'bg-[var(--accent)]/10 ring-2 ring-inset ring-[var(--accent)]'
                  : '',
              ].join(' ')}
              onDragOver={(e) => {
                // Solo resaltar el board para tubos; pelos van a fusionar
                if (fiberDragRef.current) return
                if (isTubeDropType(e.dataTransfer.types)) {
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'move'
                  setDragOverTray(true)
                }
              }}
              onDragLeave={() => setDragOverTray(false)}
              onDrop={(e) => {
                e.preventDefault()
                setDragOverTray(false)
                if (fiberDragRef.current) {
                  fiberDragRef.current = null
                  return
                }
                if (trayId) handleBoardDrop(trayId, e)
              }}
            >
              {!trayHasContent ? (
                <div className="flex h-full min-h-[200px] flex-col items-center justify-center rounded-lg border-2 border-dashed border-[var(--border)] text-center">
                  <p className="text-sm text-[var(--text-muted)]">
                    Suelta minitubos aquí
                  </p>
                </div>
              ) : (
                <div className="flex min-h-[260px] flex-col gap-3">
                  <div className="grid min-h-0 flex-1 gap-2 sm:grid-cols-[1fr_minmax(11rem,15rem)_1fr]">
                    {/* Pelos izquierda */}
                    <div
                      className="space-y-1 rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-2"
                      onDragOver={(e) => {
                        if (!fiberDragRef.current) return
                        e.preventDefault()
                        e.stopPropagation()
                      }}
                    >
                      <div className="mb-1 text-[10px] font-semibold tracking-wide text-[var(--text-muted)] uppercase">
                        Pelos
                      </div>
                      {leftEnds.length === 0 ? (
                        <p className="px-1 py-6 text-center text-[11px] text-[var(--text-muted)]">
                          Sin pelos
                        </p>
                      ) : (
                        leftEnds.map((end) => renderStrandEnd(end))
                      )}
                    </div>

                    {/* Peine / manguitos de fusión */}
                    <div className="flex flex-col overflow-hidden rounded-xl border-2 border-[#d4a72c]/50 bg-[#f8fafc] shadow-inner">
                      <div className="bg-[#eab308] px-2 py-1 text-center text-[10px] font-bold tracking-wide text-[#422006]">
                        Fusiones
                      </div>
                      <div className="relative min-h-[8rem] flex-1 space-y-0.5 overflow-y-auto px-1 py-2">
                        {Array.from({ length: slotCount }, (_, i) =>
                          renderSlot(i),
                        )}
                      </div>
                      <div className="border-t border-[#d4a72c]/40 bg-[#eab308]/30 px-2 py-1 text-center text-[10px] text-[#78350f]">
                        {trayConnections.length} fusión
                        {trayConnections.length === 1 ? '' : 'es'} ·{' '}
                        {slotCount} espacios
                      </div>
                    </div>

                    {/* Pelos derecha */}
                    <div
                      className="space-y-1 rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-2"
                      onDragOver={(e) => {
                        if (!fiberDragRef.current) return
                        e.preventDefault()
                        e.stopPropagation()
                      }}
                    >
                      <div className="mb-1 text-right text-[10px] font-semibold tracking-wide text-[var(--text-muted)] uppercase">
                        Pelos
                      </div>
                      {rightEnds.length === 0 ? (
                        <p className="px-1 py-6 text-center text-[11px] text-[var(--text-muted)]">
                          Sin pelos
                        </p>
                      ) : (
                        rightEnds.map((end) => renderStrandEnd(end))
                      )}
                    </div>
                  </div>

                  {/* Tubos asignados (para mover/quitar) */}
                  <div className="flex flex-wrap gap-2 border-t border-[var(--border)] pt-2">
                    {trayTubes.map((ref) => {
                      const resolved = resolveTube(ref)
                      if (!resolved) return null
                      return (
                        <div
                          key={`${ref.cableId}:${ref.tubeId}`}
                          className="flex items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] px-2 py-1 text-[11px]"
                        >
                          <span
                            className="h-4 w-2 rounded-full border border-black/20"
                            style={{
                              background: strandBackground(
                                resolved.tube.color,
                                resolved.tube.tracer,
                              ),
                            }}
                          />
                          <span className="truncate">
                            {resolved.cable.name || 'Cable'} ·{' '}
                            {resolved.tube.name}
                          </span>
                          <button
                            type="button"
                            onClick={() => removeTubeFromTray(ref)}
                            className="text-red-300 hover:underline"
                          >
                            Quitar
                          </button>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          </section>
        </div>

        <div
          className={[
            'flex shrink-0 items-center justify-between gap-3 border-t border-[var(--border)] px-4 py-2.5 text-xs text-[var(--text-muted)]',
            mobile ? 'modal-safe-footer' : '',
          ].join(' ')}
        >
          <span>
            {hint ?? 'Arrastra pelo → pelo o haz click en dos pelos'}
          </span>
          {!embedded && (
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--text)]"
            >
              Cerrar
            </button>
          )}
        </div>
    </>
  )

  if (embedded) {
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {body}
      </div>
    )
  }

  return (
    <ModalPortal><div
      className={[
        'modal-backdrop fixed inset-0 z-[600] flex overflow-hidden bg-black/60',
        mobile
          ? 'items-stretch p-0'
          : 'items-start justify-center p-3 sm:items-center sm:p-4',
      ].join(' ')}
    >
      <div
        role="dialog"
        aria-modal="true"
        className={[
          'flex w-full flex-col overflow-hidden border border-[var(--border)] bg-[var(--bg-elevated)] shadow-xl',
          mobile
            ? 'h-dvh max-h-dvh rounded-none'
            : 'max-h-[min(92vh,100dvh)] max-w-[min(100rem,95vw)] rounded-xl',
        ].join(' ')}
      >
        {body}
      </div>
    </div></ModalPortal>
  )
}
