import { useEffect, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'
import {
  connectionStatusLabel,
  deviceTypeLabel,
  formatBytes,
  INTERNET_DEVICE_TYPE,
  isManagedOltDevice,
  isManagedSwitch,
  isMikrotikRouterOsDevice,
  isMikrotikSwosDevice,
  oltConnectionModeLabel,
  oltPonTypeLabel,
  oltSubtypeLabel,
  OLT_PON_TYPES,
  routerSubtypeLabel,
  switchSubtypeLabel,
  type ConnectionStatus,
  type OltConnectionMode,
  type OltCardsResponse,
  type OltPonType,
  type OltSubtype,
  type PortLinkStatus,
  type RouterSubtype,
  type SwitchSubtype,
  type TopologyDevice,
} from '../lib/topology'
import { PortSelectModal } from './PortSelectModal'
import { PortIpsModal } from './PortIpsModal'
import {
  CommentEditButton,
  CommentEditModal,
} from './CommentEditModal'
import { CreateVlanModal } from './CreateVlanModal'
import { OltPonPortsPanel } from './OltPonPortsPanel'
import { OltUplinksPanel } from './OltUplinksPanel'
import { OltVlansPanel } from './OltVlansPanel'
import { OltSpeedProfilesPanel } from './OltSpeedProfilesPanel'
import { SwitchBridgeVlansPanel } from './SwitchBridgeVlansPanel'
import { OnuImportModal } from './OnuImportModal'
import { useNotify } from './NotifyProvider'
import { ModalPortal } from './ModalPortal'
import {
  oltBtnPrimary,
  oltMetaClass,
  oltToolbarClass,
} from './oltPanelUi'

const inputClass =
  'w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 outline-none ring-[var(--accent)] focus:ring-2'

function ipsButtonClass(hasIps: boolean, extra = '') {
  return [
    'rounded-md border px-2 text-xs font-medium transition',
    hasIps
      ? 'border-[var(--success)]/50 bg-[var(--success)]/10 text-[var(--success)] hover:bg-[var(--success)]/20'
      : 'border-sky-400/60 bg-sky-400/10 text-sky-500 hover:bg-sky-400/20',
    extra,
  ]
    .filter(Boolean)
    .join(' ')
}

type TabId =
  | 'red'
  | 'conexion'
  | 'bridge'
  | 'tarjetas'
  | 'pon'
  | 'uplinks'
  | 'vlans'
  | 'speed_profiles'

export function DeviceDetailModal({
  open,
  onClose,
  deviceId,
  canWrite,
  onEditDevice,
}: {
  open: boolean
  onClose: () => void
  deviceId: string | null
  canWrite: boolean
  onEditDevice: () => void
}) {
  const queryClient = useQueryClient()
  const { confirm } = useNotify()
  const [tab, setTab] = useState<TabId>('red')
  const [selectPortId, setSelectPortId] = useState<string | null>(null)
  const [ipsPortId, setIpsPortId] = useState<string | null>(null)
  const [ipsInterfaceName, setIpsInterfaceName] = useState<string | null>(
    null,
  )
  const [ipsTitle, setIpsTitle] = useState<string | undefined>(undefined)
  const [commentEdit, setCommentEdit] = useState<{
    portId: string
    interfaceName?: string | null
    title: string
    comment: string
  } | null>(null)
  const [createVlan, setCreateVlan] = useState<{
    portId: string
    portName: string
  } | null>(null)
  const [newPortName, setNewPortName] = useState('')
  const [expandedPorts, setExpandedPorts] = useState<Record<string, boolean>>(
    {},
  )
  const [mgmtHost, setMgmtHost] = useState('')
  const [mgmtPort, setMgmtPort] = useState('8729')
  const [mgmtUsername, setMgmtUsername] = useState('')
  const [mgmtPassword, setMgmtPassword] = useState('')
  const [mgmtProtocol, setMgmtProtocol] = useState('api_ssl')
  const [mgmtConnectionMode, setMgmtConnectionMode] =
    useState<OltConnectionMode>('public')
  const [snmpCommunity, setSnmpCommunity] = useState('public')
  const [snmpCommunityRw, setSnmpCommunityRw] = useState('private')
  const [snmpPort, setSnmpPort] = useState('161')
  const [ponType, setPonType] = useState<OltPonType | ''>('')
  const [onuImportOpen, setOnuImportOpen] = useState(false)
  /** Valor del select: "" | "port:ether1" | "vlan:ether1:100" */
  const [egressSelect, setEgressSelect] = useState('')

  const deviceQuery = useQuery({
    queryKey: ['app', 'topology', 'device', deviceId],
    queryFn: () =>
      apiFetch<TopologyDevice>(`/app/topology/devices/${deviceId}`),
    enabled: open && !!deviceId,
    retry: 3,
    placeholderData: (prev) => prev,
    refetchInterval: (q) => {
      const d = q.state.data
      if (!open || !d?.mgmtHost) return false
      if (isMikrotikRouterOsDevice(d.type, d.subtype)) return 10_000
      if (isMikrotikSwosDevice(d.type, d.subtype)) return 15_000
      // OLT detail refresh uses SNMP health (~30s); full CLI only on "Probar"
      if (isManagedOltDevice(d.type, d.subtype)) return 30_000
      return false
    },
  })

  useEffect(() => {
    if (!open) {
      setTab('red')
      setMgmtPassword('')
      setExpandedPorts({})
      setIpsPortId(null)
      setIpsInterfaceName(null)
      setIpsTitle(undefined)
      setCommentEdit(null)
      setCreateVlan(null)
    }
  }, [open, deviceId])

  useEffect(() => {
    if (!deviceQuery.data) return
    const d = deviceQuery.data
    setMgmtHost(d.mgmtHost ?? '')
    setMgmtUsername(d.mgmtUsername ?? '')
    if (d.type === 'olt') {
      const cli =
        d.mgmtProtocol === 'ssh' || d.mgmtProtocol === 'telnet'
          ? d.mgmtProtocol
          : 'telnet'
      setMgmtProtocol(cli)
      setMgmtPort(
        String(d.mgmtPort ?? (cli === 'ssh' ? 22 : 23)),
      )
      setMgmtConnectionMode(
        (d.mgmtConnectionMode as OltConnectionMode) || 'public',
      )
      setSnmpCommunity(d.snmpCommunity ?? 'public')
      setSnmpCommunityRw(d.snmpCommunityRw ?? 'private')
      setSnmpPort(String(d.snmpPort ?? 161))
      setPonType(
        d.ponType &&
          (OLT_PON_TYPES as readonly string[]).includes(d.ponType)
          ? (d.ponType as OltPonType)
          : '',
      )
    } else if (isMikrotikSwosDevice(d.type, d.subtype)) {
      setMgmtProtocol('http')
      setMgmtPort(String(d.mgmtPort ?? 80))
    } else {
      setMgmtProtocol(d.mgmtProtocol ?? 'api_ssl')
      setMgmtPort(
        String(
          d.mgmtPort ??
            (d.mgmtProtocol === 'rest_https' ? 443 : 8729),
        ),
      )
    }
    if (d.internetEgressPortName) {
      setEgressSelect(
        d.internetEgressVlanId != null
          ? `vlan:${d.internetEgressPortName}:${d.internetEgressVlanId}`
          : `port:${d.internetEgressPortName}`,
      )
    } else {
      setEgressSelect('')
    }
  }, [deviceQuery.data])

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (
        e.key === 'Escape' &&
        !selectPortId &&
        !ipsPortId &&
        !commentEdit &&
        !createVlan
      )
        onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose, selectPortId, ipsPortId, commentEdit, createVlan])

  function invalidateDevice() {
    void queryClient.invalidateQueries({ queryKey: ['app', 'topology'] })
    void queryClient.invalidateQueries({
      queryKey: ['app', 'topology', 'device', deviceId],
    })
  }

  const addPortMutation = useMutation({
    mutationFn: () =>
      apiFetch('/app/topology/ports', {
        method: 'POST',
        body: JSON.stringify({
          deviceId,
          name: newPortName.trim() || 'Port',
        }),
      }),
    onSuccess: () => {
      setNewPortName('')
      invalidateDevice()
    },
  })

  const deletePortMutation = useMutation({
    mutationFn: (portId: string) =>
      apiFetch(`/app/topology/ports/${portId}`, { method: 'DELETE' }),
    onSuccess: invalidateDevice,
  })

  const unlinkMutation = useMutation({
    mutationFn: (linkId: string) =>
      apiFetch(`/app/topology/links/${linkId}`, { method: 'DELETE' }),
    onSuccess: invalidateDevice,
  })

  const deleteDeviceMutation = useMutation({
    mutationFn: () =>
      apiFetch(`/app/topology/devices/${deviceId}`, { method: 'DELETE' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['app', 'topology'] })
      onClose()
    },
  })

  const saveConnMutation = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = {
        mgmtHost: mgmtHost.trim() || null,
        mgmtPort: Number(mgmtPort) || null,
        mgmtUsername: mgmtUsername.trim() || null,
        mgmtPassword: mgmtPassword || undefined,
        mgmtProtocol,
      }
      if (deviceQuery.data?.type === 'olt') {
        body.mgmtConnectionMode = mgmtConnectionMode
        body.snmpCommunity = snmpCommunity.trim() || null
        body.snmpCommunityRw = snmpCommunityRw.trim() || null
        body.snmpPort = Number(snmpPort) || null
        body.ponType = ponType || null
        // OLT never uses MikroTik API protocols
        if (body.mgmtProtocol !== 'ssh' && body.mgmtProtocol !== 'telnet') {
          body.mgmtProtocol = 'telnet'
        }
      }
      if (isMikrotikSwosDevice(deviceQuery.data?.type, deviceQuery.data?.subtype)) {
        body.mgmtProtocol = 'http'
      }
      if (
        isMikrotikRouterOsDevice(
          deviceQuery.data?.type,
          deviceQuery.data?.subtype,
        ) &&
        deviceQuery.data?.type === 'router'
      ) {
        if (!egressSelect) {
          body.internetEgressPortName = null
          body.internetEgressVlanId = null
        } else if (egressSelect.startsWith('vlan:')) {
          const [, portName, vlanStr] = egressSelect.split(':')
          body.internetEgressPortName = portName || null
          body.internetEgressVlanId = Number(vlanStr) || null
        } else if (egressSelect.startsWith('port:')) {
          body.internetEgressPortName = egressSelect.slice(5) || null
          body.internetEgressVlanId = null
        }
      }
      return apiFetch(`/app/topology/devices/${deviceId}/connection`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      })
    },
    onSuccess: () => {
      setMgmtPassword('')
      invalidateDevice()
    },
  })

  const testConnMutation = useMutation({
    mutationFn: () =>
      apiFetch<TopologyDevice>(
        `/app/topology/devices/${deviceId}/connection/test`,
        { method: 'POST' },
      ),
    onSuccess: (data) => {
      invalidateDevice()
      if (data.suggestOnuImport) {
        setOnuImportOpen(true)
      }
    },
  })

  const cardsQuery = useQuery({
    queryKey: ['app', 'topology', 'devices', deviceId, 'cards'],
    queryFn: () =>
      apiFetch<OltCardsResponse>(`/app/topology/devices/${deviceId}/cards`),
    enabled: open && !!deviceId && tab === 'tarjetas',
    retry: 1,
  })

  const rebootCardMutation = useMutation({
    mutationFn: (card: {
      slot: string
      rack: string
      shelf: string
    }) =>
      apiFetch(`/app/topology/devices/${deviceId}/cards/${card.slot}/reboot`, {
        method: 'POST',
        body: JSON.stringify({ rack: card.rack, shelf: card.shelf }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ['app', 'topology', 'devices', deviceId, 'cards'],
      })
    },
  })

  if (!open || !deviceId) return null

  const device = deviceQuery.data
  const isRouter = device?.type === 'router'
  const isOlt = device?.type === 'olt'
  const isSwitch = device?.type === 'switch'
  const hasConnectionTab =
    isRouter || isOlt || isManagedSwitch(device?.type, device?.subtype)
  const isMikrotikLive =
    isMikrotikRouterOsDevice(device?.type, device?.subtype) && !!device?.mgmtHost
  const isSwosLive =
    isMikrotikSwosDevice(device?.type, device?.subtype) && !!device?.mgmtHost
  const isManagedOlt = isManagedOltDevice(device?.type, device?.subtype)
  const isRosSwitch =
    isSwitch && device?.subtype === 'mikrotik_routeros'
  const status = (device?.connectionStatus ??
    'unknown') as ConnectionStatus
  const subtypeLabel = device?.subtype
    ? isOlt
      ? oltSubtypeLabel[device.subtype as OltSubtype] ?? device.subtype
      : isSwitch
        ? switchSubtypeLabel[device.subtype as SwitchSubtype] ?? device.subtype
        : routerSubtypeLabel[device.subtype as RouterSubtype] ?? device.subtype
    : null

  function portNameClass(linkStatus?: string) {
    const s = (linkStatus ?? 'unknown') as PortLinkStatus
    if (s === 'up') return 'font-medium text-[var(--success)]'
    if (s === 'down') return 'font-medium text-[var(--danger)]'
    if (s === 'disabled') return 'font-medium text-[var(--text-muted)]'
    return 'font-medium'
  }

  function onSaveConn(e: FormEvent) {
    e.preventDefault()
    saveConnMutation.mutate()
  }

  return (
    <>
      <ModalPortal><div className="fixed inset-0 z-[100] modal-backdrop flex items-stretch justify-center overflow-hidden bg-black/60 sm:items-center sm:p-4">
        <div
          role="dialog"
          aria-modal="true"
          className="flex h-[100dvh] max-h-[100dvh] w-full max-w-6xl flex-col overflow-hidden rounded-none border-0 sm:h-auto sm:max-h-[min(92dvh,920px)] sm:rounded-xl sm:border border-[var(--border)] bg-[var(--bg-elevated)] shadow-xl"
        >
            <div className="flex shrink-0 flex-wrap items-start justify-between gap-2 border-b border-[var(--border)] px-4 py-3 sm:px-5 sm:py-4">
            <div className="min-w-0">
              <h2 className="truncate text-lg font-semibold">
                {device?.name ?? 'Dispositivo'}
              </h2>
              {device && (
                <p className="text-sm text-[var(--text-muted)]">
                  {deviceTypeLabel[device.type]}
                  {subtypeLabel ? ` · ${subtypeLabel}` : ''}
                  {!device.isActive ? ' · inactivo' : ''}
                  {hasConnectionTab && device.mgmtHost
                    ? ` · ${connectionStatusLabel[status] ?? status}`
                    : ''}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md px-2 py-1 text-[var(--text-muted)] hover:bg-[var(--bg)]"
            >
              ✕
            </button>
          </div>

          {device && (
            <div className="flex shrink-0 gap-1 overflow-x-auto overscroll-x-contain border-b border-[var(--border)] px-3 sm:px-5">
              <button
                type="button"
                onClick={() => setTab('red')}
                className={[
                  'shrink-0 border-b-2 px-2.5 py-2.5 text-xs whitespace-nowrap transition sm:px-3 sm:text-sm',
                  tab === 'red'
                    ? 'border-[var(--accent)] text-[var(--accent)]'
                    : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text)]',
                ].join(' ')}
              >
                Red
              </button>
              {hasConnectionTab && (
                <button
                  type="button"
                  onClick={() => setTab('conexion')}
                  className={[
                    'shrink-0 border-b-2 px-2.5 py-2.5 text-xs whitespace-nowrap transition sm:px-3 sm:text-sm',
                    tab === 'conexion'
                      ? 'border-[var(--accent)] text-[var(--accent)]'
                      : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text)]',
                  ].join(' ')}
                >
                  Conexión
                </button>
              )}
              {isRosSwitch && (
                <button
                  type="button"
                  onClick={() => setTab('bridge')}
                  className={[
                    'shrink-0 border-b-2 px-2.5 py-2.5 text-xs whitespace-nowrap transition sm:px-3 sm:text-sm',
                    tab === 'bridge'
                      ? 'border-[var(--accent)] text-[var(--accent)]'
                      : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text)]',
                  ].join(' ')}
                >
                  Bridge / VLANs
                </button>
              )}
              {isManagedOlt && (
                <button
                  type="button"
                  onClick={() => setTab('tarjetas')}
                  className={[
                    'shrink-0 border-b-2 px-2.5 py-2.5 text-xs whitespace-nowrap transition sm:px-3 sm:text-sm',
                    tab === 'tarjetas'
                      ? 'border-[var(--accent)] text-[var(--accent)]'
                      : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text)]',
                  ].join(' ')}
                >
                  Tarjetas
                </button>
              )}
              {isManagedOlt && (
                <button
                  type="button"
                  onClick={() => setTab('pon')}
                  className={[
                    'shrink-0 border-b-2 px-2.5 py-2.5 text-xs whitespace-nowrap transition sm:px-3 sm:text-sm',
                    tab === 'pon'
                      ? 'border-[var(--accent)] text-[var(--accent)]'
                      : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text)]',
                  ].join(' ')}
                >
                  Puertos PON
                </button>
              )}
              {isManagedOlt && (
                <button
                  type="button"
                  onClick={() => setTab('uplinks')}
                  className={[
                    'shrink-0 border-b-2 px-2.5 py-2.5 text-xs whitespace-nowrap transition sm:px-3 sm:text-sm',
                    tab === 'uplinks'
                      ? 'border-[var(--accent)] text-[var(--accent)]'
                      : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text)]',
                  ].join(' ')}
                >
                  Uplinks
                </button>
              )}
              {isManagedOlt && (
                <button
                  type="button"
                  onClick={() => setTab('vlans')}
                  className={[
                    'shrink-0 border-b-2 px-2.5 py-2.5 text-xs whitespace-nowrap transition sm:px-3 sm:text-sm',
                    tab === 'vlans'
                      ? 'border-[var(--accent)] text-[var(--accent)]'
                      : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text)]',
                  ].join(' ')}
                >
                  VLANs
                </button>
              )}
              {isManagedOlt && (
                <button
                  type="button"
                  onClick={() => setTab('speed_profiles')}
                  className={[
                    'shrink-0 border-b-2 px-2.5 py-2.5 text-xs whitespace-nowrap transition sm:px-3 sm:text-sm',
                    tab === 'speed_profiles'
                      ? 'border-[var(--accent)] text-[var(--accent)]'
                      : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text)]',
                  ].join(' ')}
                >
                  Perfiles de velocidad
                </button>
              )}
            </div>
          )}

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
            {deviceQuery.isLoading && (
              <p className="text-sm text-[var(--text-muted)]">Cargando…</p>
            )}
            {deviceQuery.error && (
              <p className="text-sm text-[var(--danger)]">
                {deviceQuery.error.message}
              </p>
            )}

            {device && tab === 'red' && (
              <>
                {device.note && (
                  <p className="text-sm text-[var(--text-muted)]">
                    {device.note}
                  </p>
                )}

                {canWrite && (
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={onEditDevice}
                      className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm hover:border-[var(--accent)] hover:text-[var(--accent)]"
                    >
                      {device.type === INTERNET_DEVICE_TYPE
                        ? 'Editar nota'
                        : 'Editar nombre / tipo'}
                    </button>
                    {device.type !== INTERNET_DEVICE_TYPE && (
                      <button
                        type="button"
                        onClick={() => {
                          void confirm(`¿Eliminar ${device.name}?`, {
                            title: 'Eliminar equipo',
                            danger: true,
                            confirmLabel: 'Eliminar',
                          }).then((ok) => {
                            if (ok) deleteDeviceMutation.mutate()
                          })
                        }}
                        className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--danger)] hover:border-[var(--danger)]"
                      >
                        Eliminar activo
                      </button>
                    )}
                  </div>
                )}

                <div>
                  <h3 className="mb-2 text-sm font-semibold">Puertos</h3>
                  {isMikrotikLive && (
                    <p className="mb-2 text-xs text-[var(--text-muted)]">
                      Expande un puerto para ver las VLANs (bridge VLAN /
                      PVID / interfaces VLAN). Solo lectura.
                    </p>
                  )}
                  <div className="divide-y divide-[var(--border)] overflow-hidden rounded-lg border border-[var(--border)]">
                    {device.ports.length === 0 && (
                      <p className="px-3 py-4 text-sm text-[var(--text-muted)]">
                        {isMikrotikLive
                          ? 'Esperando sincronización… configura la conexión o espera unos segundos'
                          : 'Sin puertos'}
                      </p>
                    )}
                    {[...device.ports]
                      .sort((a, b) =>
                        a.name.localeCompare(b.name, undefined, {
                          numeric: true,
                          sensitivity: 'base',
                        }),
                      )
                      .map((p) => {
                      const synced = !!p.isSynced
                      const phys = (p.linkStatus ??
                        'unknown') as PortLinkStatus
                      const vlans = p.vlans ?? []
                      const openPort = !!expandedPorts[p.id]
                      return (
                        <div key={p.id} className="bg-[var(--bg-elevated)]">
                          <div className="flex flex-wrap items-center gap-2 px-3 py-2.5">
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedPorts((prev) => ({
                                  ...prev,
                                  [p.id]: !prev[p.id],
                                }))
                              }
                              className="flex min-w-0 flex-1 items-center gap-2 text-left"
                              aria-expanded={openPort}
                            >
                              <span
                                className="inline-flex h-5 w-5 shrink-0 items-center justify-center text-[var(--text-muted)]"
                                aria-hidden
                              >
                                {openPort ? '▾' : '▸'}
                              </span>
                              <span className={portNameClass(phys)}>
                                {p.name}
                              </span>
                              {(p.comment || canWrite) && (
                                <span className="inline-flex min-w-0 max-w-[16rem] items-center gap-0.5">
                                  {p.comment ? (
                                    <span
                                      className="truncate text-xs text-[var(--text-muted)]"
                                      title={p.comment}
                                    >
                                      — {p.comment}
                                    </span>
                                  ) : null}
                                  {canWrite && (
                                    <CommentEditButton
                                      onClick={() =>
                                        setCommentEdit({
                                          portId: p.id,
                                          title: p.name,
                                          comment: p.comment ?? '',
                                        })
                                      }
                                    />
                                  )}
                                </span>
                              )}
                              <span className="truncate text-xs text-[var(--text-muted)]">
                                {vlans.length > 0
                                  ? `${vlans.length} VLAN${vlans.length === 1 ? '' : 's'}`
                                  : 'sin VLANs'}
                                {' · '}
                                {p.linkId
                                  ? `${p.linkedDeviceName ?? '?'}/${p.linkedPortName ?? '?'}`
                                  : 'libre'}
                              </span>
                            </button>
                            <div className="flex flex-wrap gap-1">
                              <button
                                type="button"
                                onClick={() => {
                                  setIpsPortId(p.id)
                                  setIpsInterfaceName(null)
                                  setIpsTitle(p.name)
                                }}
                                className={ipsButtonClass(
                                  (p.ipAddresses?.length ??
                                    (p.ipAddress ? 1 : 0)) > 0,
                                  'py-1',
                                )}
                              >
                                IPs
                              </button>
                              {canWrite && (
                                <>
                                  {!p.linkId ? (
                                    <button
                                      type="button"
                                      onClick={() => setSelectPortId(p.id)}
                                      className="rounded-md border border-[var(--border)] px-2 py-1 text-xs hover:border-[var(--accent)] hover:text-[var(--accent)]"
                                    >
                                      Enlazar
                                    </button>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        unlinkMutation.mutate(p.linkId!)
                                      }
                                      className="rounded-md border border-[var(--border)] px-2 py-1 text-xs hover:border-[var(--accent)]"
                                    >
                                      Desconectar
                                    </button>
                                  )}
                                  {!synced && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        void confirm(
                                          `¿Eliminar puerto ${p.name}?`,
                                          {
                                            title: 'Eliminar puerto',
                                            danger: true,
                                            confirmLabel: 'Eliminar',
                                          },
                                        ).then((ok) => {
                                          if (ok)
                                            deletePortMutation.mutate(p.id)
                                        })
                                      }}
                                      className="rounded-md border border-[var(--border)] px-2 py-1 text-xs text-[var(--danger)]"
                                    >
                                      Borrar
                                    </button>
                                  )}
                                </>
                              )}
                            </div>
                          </div>

                          {openPort && (
                            <div className="space-y-3 border-t border-[var(--border)] bg-[var(--bg)] px-3 py-3 pl-10">
                              <div>
                                <div className="mb-1.5 flex items-center justify-between gap-2">
                                  <p className="text-xs font-medium text-[var(--text-muted)]">
                                    VLANs en este puerto
                                  </p>
                                  {canWrite && isMikrotikLive && (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setCreateVlan({
                                          portId: p.id,
                                          portName: p.name,
                                        })
                                      }
                                      className="rounded-md border border-[var(--border)] px-2 py-0.5 text-xs hover:border-[var(--accent)] hover:text-[var(--accent)]"
                                    >
                                      Nueva VLAN
                                    </button>
                                  )}
                                </div>
                                {vlans.length === 0 ? (
                                  <p className="text-sm text-[var(--text-muted)]">
                                    Ninguna VLAN asignada
                                  </p>
                                ) : (
                                  <ul className="space-y-1.5">
                                    {vlans.map((v) => {
                                      const ipCount =
                                        v.ipAddresses?.length ?? 0
                                      return (
                                        <li
                                          key={`${v.vlanId}-${v.mode ?? 'tagged'}-${v.interfaceName ?? ''}`}
                                          className="flex items-center gap-2 text-sm"
                                        >
                                          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                                            <span className="font-medium tabular-nums">
                                              VLAN {v.vlanId}
                                            </span>
                                            {(v.comment ||
                                              (canWrite &&
                                                v.interfaceName)) && (
                                              <span className="inline-flex min-w-0 max-w-[14rem] items-center gap-0.5">
                                                {v.comment ? (
                                                  <span
                                                    className="truncate text-xs text-[var(--text-muted)]"
                                                    title={v.comment}
                                                  >
                                                    — {v.comment}
                                                  </span>
                                                ) : null}
                                                {canWrite &&
                                                  v.interfaceName && (
                                                    <CommentEditButton
                                                      onClick={() =>
                                                        setCommentEdit({
                                                          portId: p.id,
                                                          interfaceName:
                                                            v.interfaceName,
                                                          title: `VLAN ${v.vlanId}`,
                                                          comment:
                                                            v.comment ?? '',
                                                        })
                                                      }
                                                    />
                                                  )}
                                              </span>
                                            )}
                                          </div>
                                          <button
                                            type="button"
                                            disabled={!v.interfaceName}
                                            title={
                                              v.interfaceName
                                                ? undefined
                                                : 'Sin interfaz L3 asociada en el MikroTik'
                                            }
                                            onClick={() => {
                                              if (!v.interfaceName) return
                                              setIpsPortId(p.id)
                                              setIpsInterfaceName(
                                                v.interfaceName,
                                              )
                                              setIpsTitle(`VLAN ${v.vlanId}`)
                                            }}
                                            className={ipsButtonClass(
                                              ipCount > 0,
                                              'shrink-0 py-0.5 disabled:cursor-not-allowed disabled:opacity-40',
                                            )}
                                          >
                                            IPs
                                          </button>
                                        </li>
                                      )
                                    })}
                                  </ul>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>

                {canWrite && !isMikrotikLive && (
                  <div className="flex gap-2">
                    <input
                      className={inputClass}
                      placeholder="Nombre del nuevo puerto"
                      value={newPortName}
                      onChange={(e) => setNewPortName(e.target.value)}
                    />
                    <button
                      type="button"
                      disabled={addPortMutation.isPending}
                      onClick={() => addPortMutation.mutate()}
                      className="shrink-0 rounded-lg bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-60"
                    >
                      Agregar puerto
                    </button>
                  </div>
                )}
              </>
            )}

            {device && tab === 'conexion' && hasConnectionTab && (
              <>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-lg border border-[var(--border)] bg-[var(--bg)] p-3">
                    <p className="text-xs text-[var(--text-muted)]">Estado</p>
                    <p
                      className={[
                        'mt-1 text-sm font-medium',
                        status === 'connected'
                          ? 'text-[var(--success)]'
                          : status === 'disconnected' || status === 'error'
                            ? 'text-[var(--danger)]'
                            : '',
                      ].join(' ')}
                    >
                      {connectionStatusLabel[status] ?? status}
                    </p>
                  </div>
                  <div className="rounded-lg border border-[var(--border)] bg-[var(--bg)] p-3 sm:col-span-2">
                    <p className="text-xs text-[var(--text-muted)]">Última prueba</p>
                    <p className="mt-1 text-sm">
                      {device.lastCheckedAt
                        ? new Date(device.lastCheckedAt).toLocaleString()
                        : '—'}
                    </p>
                    {device.lastError && (
                      <p className="mt-1 text-xs text-[var(--danger)]">
                        {device.lastError}
                      </p>
                    )}
                  </div>
                </div>

                {(isMikrotikLive || isSwosLive) &&
                  status === 'connected' && (
                    <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 text-sm">
                      {isMikrotikLive && (
                        <>
                      <div className="rounded-lg border border-[var(--border)] p-3">
                        <dt className="text-xs text-[var(--text-muted)]">CPU</dt>
                        <dd className="mt-1 font-medium">
                          {device.metricCpuLoad != null
                            ? `${device.metricCpuLoad}%`
                            : '—'}
                        </dd>
                      </div>
                      <div className="rounded-lg border border-[var(--border)] p-3">
                        <dt className="text-xs text-[var(--text-muted)]">RAM</dt>
                        <dd className="mt-1 font-medium">
                          {formatBytes(device.metricFreeMemory)} /{' '}
                          {formatBytes(device.metricTotalMemory)}
                        </dd>
                      </div>
                        </>
                      )}
                      <div className="rounded-lg border border-[var(--border)] p-3">
                        <dt className="text-xs text-[var(--text-muted)]">
                          Uptime
                        </dt>
                        <dd className="mt-1 font-medium">
                          {device.metricUptime ?? '—'}
                        </dd>
                      </div>
                      {isMikrotikLive && (
                      <div className="rounded-lg border border-[var(--border)] p-3">
                        <dt className="text-xs text-[var(--text-muted)]">
                          Temperatura
                        </dt>
                        <dd className="mt-1 font-medium">
                          {device.metricTemperature != null
                            ? `${device.metricTemperature} °C`
                            : '—'}
                        </dd>
                      </div>
                      )}
                      <div className="rounded-lg border border-[var(--border)] p-3">
                        <dt className="text-xs text-[var(--text-muted)]">
                          Modelo
                        </dt>
                        <dd className="mt-1 truncate font-medium">
                          {device.metricBoardName ?? '—'}
                          {device.metricIdentity
                            ? ` · ${device.metricIdentity}`
                            : ''}
                        </dd>
                      </div>
                      {isSwosLive && (
                      <div className="rounded-lg border border-[var(--border)] p-3">
                        <dt className="text-xs text-[var(--text-muted)]">
                          Firmware
                        </dt>
                        <dd className="mt-1 font-medium">
                          {device.metricVersion ?? '—'}
                        </dd>
                      </div>
                      )}
                    </dl>
                  )}

                {isOlt && status === 'connected' && (
                  <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 text-sm">
                    <div className="rounded-lg border border-[var(--border)] p-3">
                      <dt className="text-xs text-[var(--text-muted)]">CPU</dt>
                      <dd className="mt-1 font-medium">
                        {device.metricCpuLoad != null
                          ? `${device.metricCpuLoad}%`
                          : '—'}
                      </dd>
                    </div>
                    <div className="rounded-lg border border-[var(--border)] p-3">
                      <dt className="text-xs text-[var(--text-muted)]">RAM</dt>
                      <dd className="mt-1 font-medium">
                        {formatBytes(device.metricFreeMemory)} libre /{' '}
                        {formatBytes(device.metricTotalMemory)}
                      </dd>
                    </div>
                    <div className="rounded-lg border border-[var(--border)] p-3">
                      <dt className="text-xs text-[var(--text-muted)]">
                        Uptime
                      </dt>
                      <dd className="mt-1 font-medium">
                        {device.metricUptime ?? '—'}
                      </dd>
                    </div>
                    <div className="rounded-lg border border-[var(--border)] p-3">
                      <dt className="text-xs text-[var(--text-muted)]">
                        Temperatura
                      </dt>
                      <dd className="mt-1 font-medium">
                        {device.metricTemperature != null
                          ? `${device.metricTemperature} °C`
                          : '—'}
                      </dd>
                    </div>
                    <div className="rounded-lg border border-[var(--border)] p-3">
                      <dt className="text-xs text-[var(--text-muted)]">
                        Modelo
                      </dt>
                      <dd className="mt-1 font-medium">
                        {subtypeLabel ??
                          device.metricBoardName ??
                          'ZTE OLT'}
                      </dd>
                    </div>
                    <div className="rounded-lg border border-[var(--border)] p-3">
                      <dt className="text-xs text-[var(--text-muted)]">
                        Firmware detectado
                      </dt>
                      <dd className="mt-1 font-medium">
                        {device.metricVersion ?? '—'}
                      </dd>
                    </div>
                    <div className="rounded-lg border border-[var(--border)] p-3">
                      <dt className="text-xs text-[var(--text-muted)]">
                        PON detectado
                      </dt>
                      <dd className="mt-1 font-medium">
                        {device.ponType &&
                        (OLT_PON_TYPES as readonly string[]).includes(
                          device.ponType,
                        )
                          ? oltPonTypeLabel[device.ponType as OltPonType]
                          : '—'}
                      </dd>
                    </div>
                    <div className="rounded-lg border border-[var(--border)] p-3">
                      <dt className="text-xs text-[var(--text-muted)]">
                        Hostname
                      </dt>
                      <dd className="mt-1 truncate font-medium">
                        {device.metricIdentity ?? '—'}
                      </dd>
                    </div>
                    <div className="rounded-lg border border-[var(--border)] p-3 sm:col-span-2 xl:col-span-4">
                      <dt className="text-xs text-[var(--text-muted)]">
                        Tarjetas / resumen
                      </dt>
                      <dd className="mt-1 font-medium">
                        {device.metricSummary ?? '—'}
                      </dd>
                    </div>
                  </dl>
                )}

                {isMikrotikRouterOsDevice(device.type, device.subtype) ? (
                  <p className="text-xs text-[var(--text-muted)]">
                    Con credenciales guardadas, el sistema consulta el MikroTik
                    RouterOS cada pocos segundos: métricas, puertos Ethernet y
                    bridge VLANs. Los puertos son de solo lectura en Red; edita
                    VLANs en Bridge / VLANs.
                  </p>
                ) : isMikrotikSwosDevice(device.type, device.subtype) ? (
                  <p className="text-xs text-[var(--text-muted)]">
                    SwitchOS no tiene API oficial: el panel habla con la web del
                    switch (HTTP Digest). Lectura de identidad, puertos y VLANs;
                    la escritura se añadirá después.
                  </p>
                ) : isOlt ? (
                  <p className="text-xs text-[var(--text-muted)]">
                    Monitoreo de ONUs (online, señal, tráfico) por SNMP
                    read-only; aprovisionamiento y sync por CLI Telnet/SSH. Elige
                    cómo llega el servidor a la OLT: Pública (IP pública) o VPN
                    (IP local; el servidor VPN se configura en etapa 2).
                    {device.snmpMonitor != null && (
                      <>
                        {' '}
                        SNMP:{' '}
                        {device.snmpMonitor.ok
                          ? 'OK'
                          : `falló${
                              device.snmpMonitor.error
                                ? ` (${device.snmpMonitor.error})`
                                : ''
                            }`}
                        .
                      </>
                    )}
                  </p>
                ) : (
                  <p className="text-xs text-[var(--text-muted)]">
                    Probe en vivo disponible primero para MikroTik. Cisco / Edge
                    Router: guarda credenciales; el driver llegará en una fase
                    siguiente.
                  </p>
                )}

                <form onSubmit={onSaveConn} className="space-y-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    {isOlt ? (
                      <>
                        <label className="block text-sm sm:col-span-2">
                          <span className="mb-1 block text-[var(--text-muted)]">
                            Conexión
                          </span>
                          <select
                            className={inputClass}
                            value={mgmtConnectionMode}
                            onChange={(e) =>
                              setMgmtConnectionMode(
                                e.target.value as OltConnectionMode,
                              )
                            }
                            disabled={!canWrite}
                          >
                            <option value="public">
                              {oltConnectionModeLabel.public} — IP pública
                            </option>
                            <option value="secure">
                              {oltConnectionModeLabel.secure} — IP local
                            </option>
                          </select>
                          {mgmtConnectionMode === 'secure' && (
                            <span className="mt-1 block text-xs text-[var(--text-muted)]">
                              El túnel VPN (OpenVPN / WireGuard) se configura
                              desde el botón VPN en Topología. Aquí usas la IP
                              privada de la OLT.
                            </span>
                          )}
                        </label>
                        <label className="block text-sm sm:col-span-2">
                          <span className="mb-1 block text-[var(--text-muted)]">
                            {mgmtConnectionMode === 'secure'
                              ? 'IP local'
                              : 'IP pública'}
                          </span>
                          <input
                            className={inputClass}
                            value={mgmtHost}
                            onChange={(e) => setMgmtHost(e.target.value)}
                            placeholder={
                              mgmtConnectionMode === 'secure'
                                ? '10.0.0.2'
                                : '203.0.113.10'
                            }
                            disabled={!canWrite}
                          />
                        </label>
                        <label className="block text-sm">
                          <span className="mb-1 block text-[var(--text-muted)]">
                            Puerto CLI
                          </span>
                          <input
                            type="number"
                            className={inputClass}
                            value={mgmtPort}
                            onChange={(e) => setMgmtPort(e.target.value)}
                            disabled={!canWrite}
                          />
                        </label>
                        <label className="block text-sm">
                          <span className="mb-1 block text-[var(--text-muted)]">
                            Transporte CLI
                          </span>
                          <select
                            className={inputClass}
                            value={
                              mgmtProtocol === 'ssh' ? 'ssh' : 'telnet'
                            }
                            onChange={(e) => {
                              const next = e.target.value
                              setMgmtProtocol(next)
                              if (next === 'telnet') setMgmtPort('23')
                              else setMgmtPort('22')
                            }}
                            disabled={!canWrite}
                          >
                            <option value="telnet">Telnet</option>
                            <option value="ssh">SSH</option>
                          </select>
                        </label>
                        <label className="block text-sm">
                          <span className="mb-1 block text-[var(--text-muted)]">
                            Usuario
                          </span>
                          <input
                            className={inputClass}
                            value={mgmtUsername}
                            onChange={(e) => setMgmtUsername(e.target.value)}
                            autoComplete="username"
                            disabled={!canWrite}
                            placeholder="zte"
                          />
                        </label>
                        <label className="block text-sm">
                          <span className="mb-1 block text-[var(--text-muted)]">
                            Contraseña
                            {device.hasPassword
                              ? ' (dejar vacío para no cambiar)'
                              : ''}
                          </span>
                          <input
                            type="password"
                            className={inputClass}
                            value={mgmtPassword}
                            onChange={(e) => setMgmtPassword(e.target.value)}
                            autoComplete="new-password"
                            disabled={!canWrite}
                            placeholder={
                              device.hasPassword ? '••••••••' : ''
                            }
                          />
                        </label>
                        <label className="block text-sm">
                          <span className="mb-1 block text-[var(--text-muted)]">
                            SNMP read-only (monitoreo)
                          </span>
                          <input
                            className={inputClass}
                            value={snmpCommunity}
                            onChange={(e) =>
                              setSnmpCommunity(e.target.value)
                            }
                            disabled={!canWrite}
                            placeholder="public"
                          />
                          <span className="mt-1 block text-xs text-[var(--text-muted)]">
                            GET/WALK: online, señal y tráfico de ONUs. No usa
                            Telnet.
                          </span>
                        </label>
                        <label className="block text-sm">
                          <span className="mb-1 block text-[var(--text-muted)]">
                            SNMP read-write (no usada)
                          </span>
                          <input
                            className={inputClass}
                            value={snmpCommunityRw}
                            onChange={(e) =>
                              setSnmpCommunityRw(e.target.value)
                            }
                            disabled={!canWrite}
                            placeholder="private"
                          />
                          <span className="mt-1 block text-xs text-[var(--text-muted)]">
                            Reservada. Aprovisionamiento va por CLI, no por SNMP
                            SET.
                          </span>
                        </label>
                        <label className="block text-sm sm:col-span-2">
                          <span className="mb-1 block text-[var(--text-muted)]">
                            Supported PON types
                          </span>
                          <select
                            className={inputClass}
                            value={ponType}
                            onChange={(e) =>
                              setPonType(
                                (e.target.value as OltPonType | '') || '',
                              )
                            }
                            disabled={!canWrite}
                          >
                            <option value="">
                              Auto (detectar al probar)
                            </option>
                            {OLT_PON_TYPES.map((t) => (
                              <option key={t} value={t}>
                                {oltPonTypeLabel[t]}
                              </option>
                            ))}
                          </select>
                          <span className="mt-1 block text-xs text-[var(--text-muted)]">
                            Se infiere de las tarjetas (GT* = GPON, ET* =
                            EPON). Al probar se actualiza si hay line cards.
                          </span>
                        </label>
                        <label className="block text-sm">
                          <span className="mb-1 block text-[var(--text-muted)]">
                            SNMP puerto
                          </span>
                          <input
                            type="number"
                            className={inputClass}
                            value={snmpPort}
                            onChange={(e) => setSnmpPort(e.target.value)}
                            disabled={!canWrite}
                          />
                        </label>
                      </>
                    ) : isMikrotikSwosDevice(device.type, device.subtype) ? (
                      <>
                        <label className="block text-sm sm:col-span-2">
                          <span className="mb-1 block text-[var(--text-muted)]">
                            IP / host
                          </span>
                          <input
                            className={inputClass}
                            value={mgmtHost}
                            onChange={(e) => setMgmtHost(e.target.value)}
                            placeholder="192.168.88.1"
                            disabled={!canWrite}
                          />
                        </label>
                        <label className="block text-sm">
                          <span className="mb-1 block text-[var(--text-muted)]">
                            Puerto HTTP
                          </span>
                          <input
                            type="number"
                            className={inputClass}
                            value={mgmtPort}
                            onChange={(e) => setMgmtPort(e.target.value)}
                            disabled={!canWrite}
                          />
                        </label>
                        <label className="block text-sm">
                          <span className="mb-1 block text-[var(--text-muted)]">
                            Protocolo
                          </span>
                          <select
                            className={inputClass}
                            value="http"
                            disabled
                          >
                            <option value="http">HTTP Digest (SwOS)</option>
                          </select>
                        </label>
                        <label className="block text-sm">
                          <span className="mb-1 block text-[var(--text-muted)]">
                            Usuario
                          </span>
                          <input
                            className={inputClass}
                            value={mgmtUsername}
                            onChange={(e) => setMgmtUsername(e.target.value)}
                            autoComplete="username"
                            disabled={!canWrite}
                            placeholder="admin"
                          />
                        </label>
                        <label className="block text-sm sm:col-span-2">
                          <span className="mb-1 block text-[var(--text-muted)]">
                            Contraseña (dejar vacío para no cambiar)
                          </span>
                          <input
                            type="password"
                            className={inputClass}
                            value={mgmtPassword}
                            onChange={(e) => setMgmtPassword(e.target.value)}
                            autoComplete="new-password"
                            disabled={!canWrite}
                          />
                        </label>
                      </>
                    ) : (
                      <>
                        <label className="block text-sm sm:col-span-2">
                          <span className="mb-1 block text-[var(--text-muted)]">
                            IP / host
                          </span>
                          <input
                            className={inputClass}
                            value={mgmtHost}
                            onChange={(e) => setMgmtHost(e.target.value)}
                            placeholder="192.168.88.1"
                            disabled={!canWrite}
                          />
                        </label>
                        <label className="block text-sm">
                          <span className="mb-1 block text-[var(--text-muted)]">
                            Puerto
                          </span>
                          <input
                            type="number"
                            className={inputClass}
                            value={mgmtPort}
                            onChange={(e) => setMgmtPort(e.target.value)}
                            disabled={!canWrite}
                          />
                        </label>
                        <label className="block text-sm">
                          <span className="mb-1 block text-[var(--text-muted)]">
                            Protocolo
                          </span>
                          <select
                            className={inputClass}
                            value={mgmtProtocol}
                            onChange={(e) => {
                              const next = e.target.value
                              setMgmtProtocol(next)
                              if (next === 'api_ssl') setMgmtPort('8729')
                              else if (next === 'api_plain')
                                setMgmtPort('8728')
                              else if (next === 'rest_https')
                                setMgmtPort('443')
                            }}
                            disabled={!canWrite}
                          >
                            <option value="api_ssl">API-SSL (8729)</option>
                            <option value="rest_https">
                              REST HTTPS (443)
                            </option>
                            <option value="api_plain">
                              API plain (8728)
                            </option>
                          </select>
                        </label>
                        <label className="block text-sm">
                          <span className="mb-1 block text-[var(--text-muted)]">
                            Usuario
                          </span>
                          <input
                            className={inputClass}
                            value={mgmtUsername}
                            onChange={(e) => setMgmtUsername(e.target.value)}
                            autoComplete="username"
                            disabled={!canWrite}
                          />
                        </label>
                        <label className="block text-sm">
                          <span className="mb-1 block text-[var(--text-muted)]">
                            Contraseña
                            {device.hasPassword
                              ? ' (dejar vacío para no cambiar)'
                              : ''}
                          </span>
                          <input
                            type="password"
                            className={inputClass}
                            value={mgmtPassword}
                            onChange={(e) => setMgmtPassword(e.target.value)}
                            autoComplete="new-password"
                            disabled={!canWrite}
                            placeholder={
                              device.hasPassword ? '••••••••' : ''
                            }
                          />
                        </label>
                      </>
                    )}
                  </div>

                  {isRouter &&
                    isMikrotikRouterOsDevice(device.type, device.subtype) &&
                    status === 'connected' && (
                      <label className="block text-sm">
                        <span className="mb-1 block text-[var(--text-muted)]">
                          Puerto de salida a Internet
                        </span>
                        <select
                          className={inputClass}
                          value={egressSelect}
                          onChange={(e) => setEgressSelect(e.target.value)}
                          disabled={!canWrite}
                        >
                          <option value="">— Sin seleccionar —</option>
                          {(device.ports ?? [])
                            .filter((p) => p.isSynced !== false)
                            .map((p) => (
                              <optgroup key={p.id} label={p.name}>
                                <option value={`port:${p.name}`}>
                                  {p.name} (físico)
                                </option>
                                {(p.vlans ?? []).map((v) => (
                                  <option
                                    key={`${p.id}-${v.vlanId}`}
                                    value={`vlan:${p.name}:${v.vlanId}`}
                                  >
                                    {p.name} · VLAN {v.vlanId}
                                    {v.interfaceName
                                      ? ` (${v.interfaceName})`
                                      : ''}
                                  </option>
                                ))}
                              </optgroup>
                            ))}
                        </select>
                        <span className="mt-1 block text-xs text-[var(--text-muted)]">
                          Se usa para el gráfico de tráfico subida/bajada 24 h en
                          el dashboard de este router.
                        </span>
                      </label>
                    )}

                  {(saveConnMutation.error || testConnMutation.error) && (
                    <p className="text-sm text-[var(--danger)]">
                      {(saveConnMutation.error ?? testConnMutation.error)
                        ?.message}
                    </p>
                  )}

                  {canWrite && (
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="submit"
                        disabled={saveConnMutation.isPending}
                        className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-60"
                      >
                        {saveConnMutation.isPending
                          ? 'Guardando…'
                          : 'Guardar conexión'}
                      </button>
                      <button
                        type="button"
                        disabled={
                          testConnMutation.isPending || !device.hasPassword
                        }
                        onClick={() => testConnMutation.mutate()}
                        className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-60"
                      >
                        {testConnMutation.isPending
                          ? 'Probando…'
                          : 'Probar ahora'}
                      </button>
                    </div>
                  )}
                </form>
              </>
            )}

            {device && tab === 'tarjetas' && isManagedOlt && (
              <div className="space-y-4">
                <div className={oltToolbarClass}>
                  <button
                    type="button"
                    disabled={cardsQuery.isFetching}
                    onClick={() => void cardsQuery.refetch()}
                    className={oltBtnPrimary}
                  >
                    {cardsQuery.isFetching
                      ? 'Sincronizando…'
                      : 'Sincronizar'}
                  </button>
                  {cardsQuery.data?.probedAt && (
                    <span className={oltMetaClass}>
                      Última sincronización:{' '}
                      {new Date(cardsQuery.data.probedAt).toLocaleString()}
                    </span>
                  )}
                  {cardsQuery.data?.summary && (
                    <span className={oltMetaClass}>
                      {cardsQuery.data.summary}
                    </span>
                  )}
                </div>

                {cardsQuery.isLoading && (
                  <p className="text-sm text-[var(--text-muted)]">
                    Sincronizando tarjetas…
                  </p>
                )}
                {cardsQuery.error && (
                  <p className="text-sm text-[var(--danger)]">
                    {cardsQuery.error.message}
                  </p>
                )}
                {rebootCardMutation.error && (
                  <p className="text-sm text-[var(--danger)]">
                    {rebootCardMutation.error.message}
                  </p>
                )}

                {!cardsQuery.isLoading &&
                  !cardsQuery.error &&
                  (cardsQuery.data?.cards.length ?? 0) === 0 && (
                    <p className="rounded-lg border border-dashed border-[var(--border)] px-4 py-8 text-center text-sm text-[var(--text-muted)]">
                      No se encontraron tarjetas. Comprueba la conexión con la
                      OLT.
                    </p>
                  )}

                {(cardsQuery.data?.cards.length ?? 0) > 0 && (
                  <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
                    <table className="w-full min-w-[800px] text-left text-sm">
                      <thead>
                        <tr className="border-b border-[var(--border)] bg-[var(--bg-elevated)] text-[var(--text-muted)]">
                          <th className="px-3 py-2 font-medium">Slot</th>
                          <th className="px-3 py-2 font-medium">Type</th>
                          <th className="px-3 py-2 font-medium">Real type</th>
                          <th className="px-3 py-2 font-medium">Ports</th>
                          <th className="px-3 py-2 font-medium">SW</th>
                          <th className="px-3 py-2 font-medium">Status</th>
                          <th className="px-3 py-2 font-medium">Role</th>
                          <th className="px-3 py-2 font-medium">
                            Info updated
                          </th>
                          <th className="px-3 py-2 font-medium" />
                        </tr>
                      </thead>
                      <tbody>
                        {cardsQuery.data!.cards.map((c) => (
                          <tr
                            key={`${c.rack}-${c.shelf}-${c.slot}`}
                            className="border-b border-[var(--border)] last:border-0"
                          >
                            <td className="px-3 py-2.5 font-medium">
                              {c.slot}
                            </td>
                            <td className="px-3 py-2.5">{c.cfgType}</td>
                            <td className="px-3 py-2.5">{c.realType}</td>
                            <td className="px-3 py-2.5">
                              {c.ports ?? '—'}
                            </td>
                            <td className="px-3 py-2.5 font-mono text-xs">
                              {c.softVer ?? '—'}
                            </td>
                            <td className="px-3 py-2.5">{c.status}</td>
                            <td className="px-3 py-2.5">
                              {c.role ?? '—'}
                            </td>
                            <td className="px-3 py-2.5 text-xs text-[var(--text-muted)]">
                              {new Date(c.infoUpdated).toLocaleString(
                                undefined,
                                {
                                  year: 'numeric',
                                  month: '2-digit',
                                  day: '2-digit',
                                  hour: '2-digit',
                                  minute: '2-digit',
                                  second: '2-digit',
                                  hour12: false,
                                },
                              )}
                            </td>
                            <td className="px-3 py-2.5 text-right">
                              {canWrite && (
                                <button
                                  type="button"
                                  disabled={rebootCardMutation.isPending}
                                  className="rounded-md bg-[var(--accent)] px-2.5 py-1 text-xs font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-60"
                                  onClick={() => {
                                    void confirm(
                                      `¿Reiniciar tarjeta slot ${c.slot} (${c.cfgType})?`,
                                      {
                                        title: 'Reiniciar tarjeta',
                                        danger: true,
                                        confirmLabel: 'Reiniciar',
                                      },
                                    ).then((ok) => {
                                      if (!ok) return
                                      rebootCardMutation.mutate({
                                        slot: c.slot,
                                        rack: c.rack,
                                        shelf: c.shelf,
                                      })
                                    })
                                  }}
                                >
                                  Reboot-card
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {device && tab === 'bridge' && isRosSwitch && deviceId && (
              <SwitchBridgeVlansPanel
                deviceId={deviceId}
                canWrite={canWrite}
                devicePorts={device.ports}
              />
            )}

            {device && tab === 'pon' && isManagedOlt && deviceId && (
              <OltPonPortsPanel deviceId={deviceId} canWrite={canWrite} />
            )}

            {device && tab === 'uplinks' && isManagedOlt && deviceId && (
              <OltUplinksPanel deviceId={deviceId} canWrite={canWrite} />
            )}

            {device && tab === 'vlans' && isManagedOlt && deviceId && (
              <OltVlansPanel deviceId={deviceId} canWrite={canWrite} />
            )}
            {device && tab === 'speed_profiles' && isManagedOlt && deviceId && (
              <OltSpeedProfilesPanel deviceId={deviceId} canWrite={canWrite} />
            )}
          </div>
        </div>
      </div></ModalPortal>

      <PortSelectModal
        open={!!selectPortId}
        sourcePortId={selectPortId}
        onClose={() => setSelectPortId(null)}
      />
      <PortIpsModal
        open={!!ipsPortId}
        portId={ipsPortId}
        portName={ipsTitle}
        interfaceName={ipsInterfaceName}
        canWrite={canWrite}
        onClose={() => {
          setIpsPortId(null)
          setIpsInterfaceName(null)
          setIpsTitle(undefined)
        }}
      />
      <CommentEditModal
        open={!!commentEdit}
        portId={commentEdit?.portId ?? null}
        interfaceName={commentEdit?.interfaceName}
        title={commentEdit?.title ?? ''}
        initialComment={commentEdit?.comment ?? ''}
        onClose={() => setCommentEdit(null)}
      />
      <CreateVlanModal
        open={!!createVlan}
        portId={createVlan?.portId ?? null}
        portName={createVlan?.portName ?? ''}
        onClose={() => setCreateVlan(null)}
      />
      {deviceId && (
        <OnuImportModal
          open={onuImportOpen}
          oltId={deviceId}
          oltName={device?.name}
          onClose={() => setOnuImportOpen(false)}
        />
      )}
    </>
  )
}
