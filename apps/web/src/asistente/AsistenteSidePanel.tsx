import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthContext'
import { apiFetch } from '../lib/api'
import {
  canWriteCrm,
  clientDisplayName,
  type ClientDetail,
  type ClientService,
} from '../lib/crm'
import { canWriteTopology } from '../lib/topology'
import type { ConnectedOnu, ConnectedOnusResponse } from '../lib/onu-connected'
import { OnuDetailModal } from '../components/OnuDetailModal'
import { DeviceDetailModal } from '../components/DeviceDetailModal'
import { ClientDetailPage } from '../pages/ClientDetailPage'
import type { AsistenteSideView } from './AsistenteChatContext'

type ViewMode = 'summary' | 'full'

const SIDE_ENTER_MS = 620
const SIDE_EXIT_MS = 360

/**
 * Panel-navegador del Asistente: ocupa el espacio libre junto al chat (desktop).
 * En móvil: abre la vista real a pantalla completa y minimiza el chat.
 */
export function AsistenteSideHost({
  view,
  onClose,
  onMinimize,
  chatHeightClass = 'asistente-panel-h',
}: {
  view: AsistenteSideView | null
  onClose: () => void
  /** Solo móvil: minimizar chat al mostrar vista real */
  onMinimize?: () => void
  chatHeightClass?: string
}) {
  const navigate = useNavigate()
  const { user } = useAuth()
  const canWriteTopo = canWriteTopology(user?.tenantRole)
  const canWriteClient = canWriteCrm(user?.tenantRole)
  const [anim, setAnim] = useState<'enter' | 'exit' | null>(null)
  const [visible, setVisible] = useState(false)
  /** Vista que se sigue mostrando durante el exit (view del padre ya es null). */
  const [displayed, setDisplayed] = useState<AsistenteSideView | null>(null)
  const [mode, setMode] = useState<ViewMode>('full')
  const closingRef = useRef(false)
  const exitTimerRef = useRef<number | null>(null)
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined'
      ? window.matchMedia('(max-width: 639px)').matches
      : false,
  )

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 639px)')
    const onChange = () => setIsMobile(mq.matches)
    onChange()
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  function clearExitTimer() {
    if (exitTimerRef.current != null) {
      window.clearTimeout(exitTimerRef.current)
      exitTimerRef.current = null
    }
  }

  function finishClose(notifyParent: boolean) {
    clearExitTimer()
    closingRef.current = false
    setVisible(false)
    setDisplayed(null)
    setAnim(null)
    if (notifyParent) onClose()
  }

  /** Cierra con animación de salida y luego limpia el sideView del padre. */
  function requestClose() {
    if (closingRef.current || !visible) {
      onClose()
      return
    }
    closingRef.current = true
    setAnim('exit')
    clearExitTimer()
    exitTimerRef.current = window.setTimeout(() => {
      finishClose(true)
    }, SIDE_EXIT_MS)
  }

  // Móvil: vista real en pantalla principal + minimizar agente
  useEffect(() => {
    if (!view || !isMobile) return
    if (view.kind === 'client') {
      navigate(`/app/clients/${view.clientId}`)
      onClose()
      onMinimize?.()
      return
    }
    if (view.kind === 'service') {
      if (view.clientId) navigate(`/app/clients/${view.clientId}`)
      else navigate('/app/clients')
      onClose()
      onMinimize?.()
      return
    }
    // onu / device: modal fullscreen; minimizar chat
    onMinimize?.()
  }, [view, isMobile, navigate, onClose, onMinimize])

  useEffect(() => {
    if (isMobile) return

    if (view) {
      clearExitTimer()
      closingRef.current = false
      setDisplayed(view)
      setVisible(true)
      setAnim('enter')
      setMode(view.mode === 'summary' ? 'summary' : 'full')
      const t = window.setTimeout(() => setAnim(null), SIDE_ENTER_MS)
      return () => window.clearTimeout(t)
    }

    // El padre limpió sideView (nueva sesión, etc.): animar salida si aún visible.
    if (!view && visible && displayed && !closingRef.current) {
      closingRef.current = true
      setAnim('exit')
      clearExitTimer()
      exitTimerRef.current = window.setTimeout(() => {
        finishClose(false)
      }, SIDE_EXIT_MS)
      return () => clearExitTimer()
    }
  }, [view, isMobile]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (view?.mode) setMode(view.mode === 'summary' ? 'summary' : 'full')
  }, [view?.mode, view?.kind])

  useEffect(
    () => () => {
      clearExitTimer()
    },
    [],
  )

  // —— Móvil: modales estándar a pantalla completa ——
  if (view && isMobile) {
    if (view.kind === 'onu') {
      return (
        <OnuDetailModal
          oltId={view.oltId}
          onuIf={view.onuIf}
          canWrite={canWriteTopo || canWriteClient}
          onClose={onClose}
        />
      )
    }
    if (view.kind === 'device') {
      return (
        <DeviceDetailModal
          open
          deviceId={view.deviceId}
          canWrite={canWriteTopo}
          onClose={onClose}
          onEditDevice={() => {
            navigate('/app/topology')
            onClose()
          }}
        />
      )
    }
    return null
  }

  if (!visible || !displayed) return null

  const active = displayed

  const title =
    active.title ||
    (active.kind === 'client'
      ? 'Cliente'
      : active.kind === 'onu'
        ? `ONU · ${active.onuIf}`
        : active.kind === 'service'
          ? 'Servicio'
          : 'Equipo')

  function openInApp() {
    if (active.kind === 'client') navigate(`/app/clients/${active.clientId}`)
    else if (active.kind === 'service' && active.clientId)
      navigate(`/app/clients/${active.clientId}`)
    else if (active.kind === 'service') navigate('/app/clients')
    else if (active.kind === 'onu') navigate('/app/topology')
    else if (active.kind === 'device') navigate('/app/topology')
    requestClose()
  }

  const hostClass = [
    'asistente-side-host',
    anim === 'enter' ? 'asistente-side-host--enter' : '',
    anim === 'exit' ? 'asistente-side-host--exit' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={`asistente-side-slot ${chatHeightClass}`}>
      <div className={hostClass}>
        <div className="asistente-side-host__veil" aria-hidden />
        <div className="asistente-side-panel relative z-[1]">
          <header className="modal-safe-header flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--border)] px-3 py-2 sm:px-4">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-[var(--text)]">
                {title}
              </p>
              <p className="text-[10px] text-[var(--text-muted)]">
                {mode === 'full' ? 'Vista completa' : 'Resumen'}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={() =>
                  setMode((m) => (m === 'full' ? 'summary' : 'full'))
                }
                className="rounded-lg border border-[var(--border)] px-2 py-1 text-[11px] text-[var(--text-muted)] hover:bg-[var(--bg)] hover:text-[var(--text)]"
              >
                {mode === 'full' ? 'Resumen' : 'Completa'}
              </button>
              <button
                type="button"
                onClick={openInApp}
                className="rounded-lg border border-[var(--border)] px-2 py-1 text-[11px] text-[var(--text-muted)] hover:bg-[var(--bg)] hover:text-[var(--text)]"
                title="Abrir en la app"
              >
                En app
              </button>
              <button
                type="button"
                onClick={requestClose}
                className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-[var(--text-muted)] hover:bg-[var(--bg)] hover:text-[var(--text)]"
                aria-label="Cerrar panel"
              >
                ✕
              </button>
            </div>
          </header>

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {mode === 'summary' ? (
              <SummaryBody view={active} onExpand={() => setMode('full')} />
            ) : active.kind === 'client' ||
              (active.kind === 'service' && active.clientId) ? (
              <ClientDetailPage
                clientId={
                  active.kind === 'client' ? active.clientId : active.clientId!
                }
                embedded
              />
            ) : active.kind === 'onu' ? (
              <OnuDetailModal
                oltId={active.oltId}
                onuIf={active.onuIf}
                canWrite={canWriteTopo || canWriteClient}
                onClose={requestClose}
                embedded
              />
            ) : active.kind === 'device' ? (
              <DeviceDetailModal
                open
                deviceId={active.deviceId}
                canWrite={canWriteTopo}
                onClose={requestClose}
                onEditDevice={() => {
                  navigate('/app/topology')
                  requestClose()
                }}
                embedded
              />
            ) : active.kind === 'service' ? (
              <SummaryBody view={active} onExpand={() => setMode('full')} />
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}

function SummaryBody({
  view,
  onExpand,
}: {
  view: AsistenteSideView
  onExpand: () => void
}) {
  if (view.kind === 'client') {
    return <ClientSummary clientId={view.clientId} onExpand={onExpand} />
  }
  if (view.kind === 'service') {
    return (
      <ServiceSummary
        serviceId={view.serviceId}
        clientId={view.clientId}
        onExpand={onExpand}
      />
    )
  }
  if (view.kind === 'onu') {
    return (
      <OnuSummary
        oltId={view.oltId}
        onuIf={view.onuIf}
        onuId={view.onuId}
        onExpand={onExpand}
      />
    )
  }
  return <DeviceSummary deviceId={view.deviceId} onExpand={onExpand} />
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2 text-sm">
      <dt className="w-28 shrink-0 text-[var(--text-muted)]">{label}</dt>
      <dd className="min-w-0 break-all font-medium">{value || '—'}</dd>
    </div>
  )
}

function ClientSummary({
  clientId,
  onExpand,
}: {
  clientId: string
  onExpand: () => void
}) {
  const q = useQuery({
    queryKey: ['app', 'clients', clientId],
    queryFn: () => apiFetch<ClientDetail>(`/app/clients/${clientId}`),
  })
  const c = q.data
  return (
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
      {q.isLoading && <p className="text-sm text-[var(--text-muted)]">Cargando…</p>}
      {q.error && (
        <p className="text-sm text-[var(--danger)]">{(q.error as Error).message}</p>
      )}
      {c && (
        <>
          <dl className="space-y-2">
            <Field label="Nombre" value={clientDisplayName(c)} />
            <Field label="Teléfono" value={c.phone ?? ''} />
            <Field label="Ciudad" value={c.city ?? ''} />
            <Field label="Estado" value={c.isActive ? 'Activo' : 'Inactivo'} />
          </dl>
          <div>
            <p className="mb-2 text-xs font-semibold uppercase text-[var(--text-muted)]">
              Servicios ({c.services?.length ?? 0})
            </p>
            <ul className="space-y-1.5">
              {(c.services ?? []).slice(0, 5).map((s: ClientService) => (
                <li
                  key={s.id}
                  className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-xs"
                >
                  {s.name || s.id} · {s.status}
                  {s.onuId ? ' · ONU ligada' : ''}
                </li>
              ))}
            </ul>
          </div>
          <button
            type="button"
            onClick={onExpand}
            className="w-full rounded-xl bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)]"
          >
            Ver ficha completa
          </button>
        </>
      )}
    </div>
  )
}

function ServiceSummary({
  serviceId,
  clientId,
  onExpand,
}: {
  serviceId: string
  clientId?: string
  onExpand: () => void
}) {
  const q = useQuery({
    queryKey: ['app', 'clients', clientId],
    queryFn: () => apiFetch<ClientDetail>(`/app/clients/${clientId}`),
    enabled: !!clientId,
  })
  const service = q.data?.services?.find((s) => s.id === serviceId)
  return (
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
      {!clientId && (
        <p className="text-sm text-[var(--text-muted)]">
          Servicio {serviceId}
        </p>
      )}
      {q.isLoading && <p className="text-sm text-[var(--text-muted)]">Cargando…</p>}
      {service && (
        <dl className="space-y-2">
          <Field label="Nombre" value={service.name ?? ''} />
          <Field label="Estado" value={service.status} />
          <Field label="ONU" value={service.onuId ?? 'Sin ONU'} />
        </dl>
      )}
      {clientId && (
        <button
          type="button"
          onClick={onExpand}
          className="w-full rounded-xl bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)]"
        >
          Ver ficha del cliente
        </button>
      )}
    </div>
  )
}

function OnuSummary({
  oltId,
  onuIf,
  onuId,
  onExpand,
}: {
  oltId: string
  onuIf: string
  onuId?: string
  onExpand: () => void
}) {
  const q = useQuery({
    queryKey: ['app', 'onus'],
    queryFn: () => apiFetch<ConnectedOnusResponse>('/app/onus'),
    staleTime: 30_000,
  })
  const onu: ConnectedOnu | undefined = (q.data?.onus ?? []).find(
    (o) =>
      (onuId && o.id === onuId) || (o.oltId === oltId && o.onuIf === onuIf),
  )
  return (
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
      {q.isLoading && <p className="text-sm text-[var(--text-muted)]">Cargando…</p>}
      <dl className="space-y-2">
        <Field label="OLT" value={onu?.oltName ?? oltId} />
        <Field label="Interfaz" value={onuIf} />
        <Field label="SN" value={onu?.sn ?? ''} />
        <Field label="Estado" value={onu?.online ? 'Online' : 'Offline'} />
        <Field label="Tipo" value={onu?.onuType ?? ''} />
      </dl>
      <button
        type="button"
        onClick={onExpand}
        className="w-full rounded-xl bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)]"
      >
        Ver detalle ONU
      </button>
    </div>
  )
}

function DeviceSummary({
  deviceId,
  onExpand,
}: {
  deviceId: string
  onExpand: () => void
}) {
  const q = useQuery({
    queryKey: ['app', 'topology', 'device', deviceId],
    queryFn: () =>
      apiFetch<{
        id: string
        name: string
        type: string
        mgmtHost?: string | null
        isActive?: boolean
      }>(`/app/topology/devices/${deviceId}`),
  })
  const d = q.data
  return (
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
      {q.isLoading && <p className="text-sm text-[var(--text-muted)]">Cargando…</p>}
      {q.error && (
        <p className="text-sm text-[var(--danger)]">{(q.error as Error).message}</p>
      )}
      {d && (
        <dl className="space-y-2">
          <Field label="Nombre" value={d.name} />
          <Field label="Tipo" value={d.type} />
          <Field label="Host" value={d.mgmtHost ?? ''} />
          <Field label="Estado" value={d.isActive === false ? 'Inactivo' : 'Activo'} />
        </dl>
      )}
      <button
        type="button"
        onClick={onExpand}
        className="w-full rounded-xl bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)]"
      >
        Ver detalle
      </button>
    </div>
  )
}
