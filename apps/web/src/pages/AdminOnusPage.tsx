import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'
import { PanelShell } from '../components/PanelShell'
import { ModalPortal } from '../components/ModalPortal'
import {
  ListSearchInput,
  matchesSearch,
} from '../components/ListSearchInput'


const inputClass =
  'w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 outline-none ring-[var(--accent)] focus:ring-2'

type CatalogItem = {
  id: string
  vendor: string
  vendorLabel: string
  name: string
  ponType: string
  ponTypeLabel: string
  ethernetPorts: number
  wifiSsids: number
  voipPorts: number
  catv: boolean
  capability: string
  capabilityLabel: string
  allowCustomProfiles: boolean
  defaultProfileCode: string | null
  imageKey: string
  imageUrl: string
  note: string
  isActive: boolean
  registrationStatus: 'approved' | 'pending'
}

const ETH = [0, 1, 2, 3, 4, 5, 6, 7, 8]
const WIFI = [0, 1, 2, 3, 4]
const VOIP = [0, 1, 2, 3, 4]
const IMAGE_KEYS = [
  { value: 'zte-sfu', label: 'ZTE SFU' },
  { value: 'zte-hgu', label: 'ZTE HGU' },
  { value: 'huawei-sfu', label: 'Huawei SFU' },
  { value: 'huawei-hgu', label: 'Huawei HGU' },
]
const PROFILE_CODES = [
  '',
  'generic_1',
  'generic_2',
  'generic_3',
  'generic_4',
  'generic_5',
  'generic_6',
]

export function AdminOnusPage() {
  const queryClient = useQueryClient()
  const [modal, setModal] = useState<'create' | 'edit' | null>(null)
  const [editing, setEditing] = useState<CatalogItem | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  const [vendor, setVendor] = useState('zte')
  const [name, setName] = useState('')
  const [ponType, setPonType] = useState<'gpon' | 'epon'>('gpon')
  const [ethernetPorts, setEthernetPorts] = useState(4)
  const [wifiSsids, setWifiSsids] = useState(0)
  const [voipPorts, setVoipPorts] = useState(0)
  const [catv, setCatv] = useState(false)
  const [capability, setCapability] = useState<'bridging' | 'bridging_routing'>(
    'bridging_routing',
  )
  const [allowCustomProfiles, setAllowCustomProfiles] = useState(true)
  const [defaultProfileCode, setDefaultProfileCode] = useState('generic_6')
  const [imageKey, setImageKey] = useState('zte-hgu')
  const [note, setNote] = useState('')
  const [isActive, setIsActive] = useState(true)
  const [deleteConfirm, setDeleteConfirm] = useState('')

  const listQuery = useQuery({
    queryKey: ['admin', 'onus'],
    queryFn: () =>
      apiFetch<{ items: CatalogItem[] }>('/admin/onus'),
  })

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ['admin', 'onus'] })
  }

  function resetForm() {
    setVendor('zte')
    setName('')
    setPonType('gpon')
    setEthernetPorts(4)
    setWifiSsids(0)
    setVoipPorts(0)
    setCatv(false)
    setCapability('bridging_routing')
    setAllowCustomProfiles(true)
    setDefaultProfileCode('generic_6')
    setImageKey('zte-hgu')
    setNote('')
    setIsActive(true)
    setDeleteConfirm('')
    setError(null)
  }

  function openCreate() {
    setEditing(null)
    resetForm()
    setModal('create')
  }

  function openEdit(item: CatalogItem) {
    setEditing(item)
    setVendor(item.vendor)
    setName(item.name)
    setPonType(item.ponType === 'epon' ? 'epon' : 'gpon')
    setEthernetPorts(item.ethernetPorts)
    setWifiSsids(item.wifiSsids)
    setVoipPorts(item.voipPorts)
    setCatv(item.catv)
    setCapability(
      item.capability === 'bridging' ? 'bridging' : 'bridging_routing',
    )
    setAllowCustomProfiles(item.allowCustomProfiles)
    setDefaultProfileCode(item.defaultProfileCode ?? '')
    setImageKey(item.imageKey)
    setNote(item.note ?? '')
    setIsActive(item.isActive)
    setDeleteConfirm('')
    setError(null)
    setModal('edit')
  }

  const body = () => ({
    vendor,
    name: name.trim(),
    ponType,
    ethernetPorts,
    wifiSsids,
    voipPorts,
    catv,
    capability,
    allowCustomProfiles,
    defaultProfileCode: defaultProfileCode || null,
    imageKey,
    note,
    isActive,
  })

  const saveMutation = useMutation({
    mutationFn: () => {
      if (modal === 'edit' && editing) {
        return apiFetch(`/admin/onus/${editing.id}`, {
          method: 'PATCH',
          body: JSON.stringify(body()),
        })
      }
      return apiFetch('/admin/onus', {
        method: 'POST',
        body: JSON.stringify(body()),
      })
    },
    onSuccess: () => {
      setMsg(
        modal === 'edit'
          ? 'Modelo actualizado y propagado a los tenants'
          : 'Modelo creado y cargado en todos los tenants',
      )
      setModal(null)
      invalidate()
    },
    onError: (e: Error) => setError(e.message),
  })

  const deleteMutation = useMutation({
    mutationFn: () => {
      if (!editing) throw new Error('Sin modelo')
      return apiFetch(`/admin/onus/${editing.id}`, { method: 'DELETE' })
    },
    onSuccess: () => {
      setMsg('Modelo eliminado del catálogo global')
      setModal(null)
      invalidate()
    },
    onError: (e: Error) => setError(e.message),
  })

  const approveMutation = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/admin/onus/${id}/approve`, { method: 'POST' }),
    onSuccess: () => {
      setMsg(
        'Modelo aprobado. Los tenants que ya lo tienen reciben los specs; el resto lo obtendrá al detectarlo.',
      )
      invalidate()
    },
    onError: (e: Error) => setError(e.message),
  })

  useEffect(() => {
    if (!msg) return
    const t = setTimeout(() => setMsg(null), 4000)
    return () => clearTimeout(t)
  }, [msg])

  const allItems = listQuery.data?.items ?? []
  const pendingCount = allItems.filter(
    (i) => i.registrationStatus === 'pending',
  ).length
  const items = useMemo(
    () =>
      allItems.filter((item) =>
        matchesSearch(
          search,
          item.name,
          item.vendorLabel,
          item.ponTypeLabel,
          item.registrationStatus,
          item.isActive ? 'activo' : 'inactivo',
          item.defaultProfileCode,
        ),
      ),
    [allItems, search],
  )

  return (
    <PanelShell
      title="ONUs"
      subtitle="Catálogo global de modelos (códigos: HG8245H, F660…)"
      variant="admin"
    >
      <div className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
          <ListSearchInput
            value={search}
            onChange={setSearch}
            placeholder="Buscar modelo, fabricante…"
            className="sm:max-w-sm"
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={openCreate}
              className="rounded-lg bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)]"
            >
              + Agregar modelo ONU
            </button>
            <button
              type="button"
              disabled={listQuery.isFetching}
              onClick={() => void listQuery.refetch()}
              className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm hover:bg-[var(--bg)]"
            >
              Refrescar
            </button>
          </div>
        </div>

        {pendingCount > 0 && (
          <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
            {pendingCount} modelo(s) pendiente(s) de registro — completa ETH /
            WiFi / VoIP y pulsa Aprobar.
          </p>
        )}

        {msg && <p className="text-sm text-emerald-500">{msg}</p>}
        {listQuery.error && (
          <p className="text-sm text-[var(--danger)]">
            {listQuery.error.message}
          </p>
        )}
        {error && !modal && (
          <p className="text-sm text-[var(--danger)]">{error}</p>
        )}

        {/* Mobile: lista compacta */}
        <div className="overflow-hidden rounded-xl border border-[var(--border)] md:hidden">
          {items.length === 0 && !listQuery.isLoading && (
            <p className="px-4 py-8 text-center text-sm text-[var(--text-muted)]">
              Sin modelos en el catálogo.
            </p>
          )}
          {listQuery.isLoading && (
            <p className="px-4 py-6 text-sm text-[var(--text-muted)]">
              Cargando…
            </p>
          )}
          <ul className="divide-y divide-[var(--border)]">
            {items.map((item) => (
              <li key={item.id} className="space-y-1 px-3 py-2.5">
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    className="min-w-0 flex-1 truncate text-left text-sm font-semibold text-[var(--accent)] hover:underline"
                    onClick={() => openEdit(item)}
                  >
                    {item.name}
                  </button>
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      className="text-xs text-[var(--accent)] hover:underline"
                      onClick={() => openEdit(item)}
                    >
                      Editar
                    </button>
                    {item.registrationStatus === 'pending' && (
                      <button
                        type="button"
                        className="text-xs font-medium text-emerald-400 hover:underline"
                        disabled={approveMutation.isPending}
                        onClick={() => approveMutation.mutate(item.id)}
                      >
                        Aprobar
                      </button>
                    )}
                  </div>
                </div>
                <div className="flex items-center justify-between gap-2 text-[11px] text-[var(--text-muted)]">
                  <span className="min-w-0 truncate">{item.vendorLabel}</span>
                  <span className="shrink-0 text-right">
                    {item.registrationStatus === 'pending'
                      ? 'Pendiente'
                      : 'Aprobado'}
                    {' · '}
                    WiFi {item.wifiSsids}
                    {' · '}
                    {item.isActive ? 'Activo' : 'Inactivo'}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </div>

        {/* Desktop: tabla completa */}
        <div className="hidden overflow-x-auto rounded-xl border border-[var(--border)] md:block">
          <table className="w-full min-w-[960px] text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--bg-elevated)] text-[var(--text-muted)]">
                <th className="px-3 py-2 font-medium">Foto</th>
                <th className="px-3 py-2 font-medium">Fabricante</th>
                <th className="px-3 py-2 font-medium">Modelo</th>
                <th className="px-3 py-2 font-medium">Estado</th>
                <th className="px-3 py-2 font-medium">PON</th>
                <th className="px-3 py-2 font-medium">ETH</th>
                <th className="px-3 py-2 font-medium">WiFi</th>
                <th className="px-3 py-2 font-medium">VoIP</th>
                <th className="px-3 py-2 font-medium">CATV</th>
                <th className="px-3 py-2 font-medium">Capacidad</th>
                <th className="px-3 py-2 font-medium">Perfil</th>
                <th className="px-3 py-2 font-medium">Activo</th>
                <th className="px-3 py-2 font-medium">Acción</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr
                  key={item.id}
                  className="border-b border-[var(--border)] last:border-0"
                >
                  <td className="px-3 py-2">
                    <img
                      src={item.imageUrl}
                      alt={item.name}
                      className="h-9 w-[80px] rounded object-contain bg-[var(--bg)]"
                    />
                  </td>
                  <td className="px-3 py-2.5">{item.vendorLabel}</td>
                  <td className="px-3 py-2.5">
                    <button
                      type="button"
                      className="font-medium text-[var(--accent)] hover:underline"
                      onClick={() => openEdit(item)}
                    >
                      {item.name}
                    </button>
                  </td>
                  <td className="px-3 py-2.5">
                    {item.registrationStatus === 'pending' ? (
                      <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-xs text-amber-300">
                        Pendiente
                      </span>
                    ) : (
                      <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-xs text-emerald-400">
                        Aprobado
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5">{item.ponTypeLabel}</td>
                  <td className="px-3 py-2.5">{item.ethernetPorts}</td>
                  <td className="px-3 py-2.5">{item.wifiSsids}</td>
                  <td className="px-3 py-2.5">{item.voipPorts}</td>
                  <td className="px-3 py-2.5">{item.catv ? 1 : 0}</td>
                  <td className="px-3 py-2.5">{item.capabilityLabel}</td>
                  <td className="px-3 py-2.5 text-xs">
                    {item.defaultProfileCode ?? '—'}
                  </td>
                  <td className="px-3 py-2.5">
                    {item.isActive ? 'Sí' : 'No'}
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="text-xs text-[var(--accent)] hover:underline"
                        onClick={() => openEdit(item)}
                      >
                        Editar
                      </button>
                      {item.registrationStatus === 'pending' && (
                        <button
                          type="button"
                          className="text-xs font-medium text-emerald-400 hover:underline"
                          disabled={approveMutation.isPending}
                          onClick={() => approveMutation.mutate(item.id)}
                        >
                          Aprobar
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {modal && (
        <ModalPortal><div className="fixed inset-0 z-[80] modal-backdrop flex items-stretch justify-center overflow-hidden bg-black/60 sm:items-center sm:p-4">
          <div className="h-[100dvh] max-h-[100dvh] overflow-y-auto overscroll-contain w-full max-w-lg rounded-none border-0 sm:h-auto sm:max-h-[min(92dvh,920px)] sm:rounded-xl sm:border border-[var(--border)] bg-[var(--bg-elevated)] shadow-xl">
            <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
              <h3 className="text-lg font-semibold">
                {modal === 'create' ? 'Agregar modelo ONU' : 'Editar modelo ONU'}
              </h3>
              <button
                type="button"
                className="rounded-md px-2 py-1 text-[var(--text-muted)] hover:bg-[var(--bg)]"
                onClick={() => setModal(null)}
              >
                ✕
              </button>
            </div>
            <div className="max-h-[70vh] space-y-3 overflow-y-auto px-5 py-4 text-sm">
              <div className="rounded-lg border border-[var(--border)] bg-[var(--bg)] p-3">
                <img
                  src={`/onu/${imageKey}.svg`}
                  alt=""
                  className="mx-auto h-[90px] object-contain"
                />
              </div>

              <label className="block">
                <span className="mb-1 block text-[var(--text-muted)]">
                  Fabricante
                </span>
                <select
                  className={inputClass}
                  value={vendor}
                  onChange={(e) => {
                    setVendor(e.target.value)
                    setImageKey(
                      e.target.value === 'huawei'
                        ? capability === 'bridging'
                          ? 'huawei-sfu'
                          : 'huawei-hgu'
                        : capability === 'bridging'
                          ? 'zte-sfu'
                          : 'zte-hgu',
                    )
                  }}
                >
                  <option value="zte">ZTE</option>
                  <option value="huawei">Huawei</option>
                  <option value="fiberhome">FiberHome</option>
                  <option value="other">Otro</option>
                </select>
              </label>

              <label className="block">
                <span className="mb-1 block text-[var(--text-muted)]">
                  Nombre del modelo
                </span>
                <input
                  className={inputClass}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="F660 / HG8245H"
                />
              </label>

              <fieldset>
                <legend className="mb-1 text-[var(--text-muted)]">Tipo PON</legend>
                <div className="flex gap-4">
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      checked={ponType === 'gpon'}
                      onChange={() => setPonType('gpon')}
                    />
                    GPON
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      checked={ponType === 'epon'}
                      onChange={() => setPonType('epon')}
                    />
                    EPON
                  </label>
                </div>
              </fieldset>

              <div className="grid gap-3 sm:grid-cols-3">
                <label className="block">
                  <span className="mb-1 block text-[var(--text-muted)]">ETH</span>
                  <select
                    className={inputClass}
                    value={ethernetPorts}
                    onChange={(e) => setEthernetPorts(Number(e.target.value))}
                  >
                    {ETH.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-[var(--text-muted)]">
                    WiFi
                  </span>
                  <select
                    className={inputClass}
                    value={wifiSsids}
                    onChange={(e) => setWifiSsids(Number(e.target.value))}
                  >
                    {WIFI.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-[var(--text-muted)]">
                    VoIP
                  </span>
                  <select
                    className={inputClass}
                    value={voipPorts}
                    onChange={(e) => setVoipPorts(Number(e.target.value))}
                  >
                    {VOIP.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={catv}
                  onChange={(e) => setCatv(e.target.checked)}
                />
                CATV
              </label>

              <fieldset>
                <legend className="mb-1 text-[var(--text-muted)]">
                  Capacidad
                </legend>
                <div className="flex gap-4">
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      checked={capability === 'bridging'}
                      onChange={() => {
                        setCapability('bridging')
                        setImageKey(
                          vendor === 'huawei' ? 'huawei-sfu' : 'zte-sfu',
                        )
                        setDefaultProfileCode('generic_1')
                      }}
                    />
                    Bridging
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      checked={capability === 'bridging_routing'}
                      onChange={() => {
                        setCapability('bridging_routing')
                        setImageKey(
                          vendor === 'huawei' ? 'huawei-hgu' : 'zte-hgu',
                        )
                        setDefaultProfileCode('generic_6')
                      }}
                    />
                    Bridging/Routing
                  </label>
                </div>
              </fieldset>

              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={allowCustomProfiles}
                  onChange={(e) => setAllowCustomProfiles(e.target.checked)}
                />
                Permitir perfiles personalizados
              </label>

              <label className="block">
                <span className="mb-1 block text-[var(--text-muted)]">
                  Perfil por defecto
                </span>
                <select
                  className={inputClass}
                  value={defaultProfileCode}
                  onChange={(e) => setDefaultProfileCode(e.target.value)}
                >
                  {PROFILE_CODES.map((c) => (
                    <option key={c || 'none'} value={c}>
                      {c || 'Ninguno'}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="mb-1 block text-[var(--text-muted)]">
                  Imagen
                </span>
                <select
                  className={inputClass}
                  value={imageKey}
                  onChange={(e) => setImageKey(e.target.value)}
                >
                  {IMAGE_KEYS.map((k) => (
                    <option key={k.value} value={k.value}>
                      {k.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="mb-1 block text-[var(--text-muted)]">Nota</span>
                <input
                  className={inputClass}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </label>

              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                />
                Activo (visible en tenants)
              </label>

              {modal === 'edit' && editing && (
                <div className="rounded-lg border border-[var(--danger)]/40 p-3">
                  <p className="mb-2 text-sm font-medium text-[var(--danger)]">
                    Eliminar del catálogo
                  </p>
                  <p className="mb-2 text-xs text-[var(--text-muted)]">
                    Escribe {editing.name} para confirmar.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <input
                      className={`${inputClass} max-w-[200px]`}
                      value={deleteConfirm}
                      onChange={(e) => setDeleteConfirm(e.target.value)}
                    />
                    <button
                      type="button"
                      disabled={
                        deleteConfirm !== editing.name ||
                        deleteMutation.isPending
                      }
                      className="rounded-lg bg-[var(--danger)] px-3 py-2 text-sm text-white disabled:opacity-50"
                      onClick={() => deleteMutation.mutate()}
                    >
                      Eliminar
                    </button>
                  </div>
                </div>
              )}

              {error && (
                <p className="text-sm text-[var(--danger)]">{error}</p>
              )}
            </div>
            <div className="flex justify-end gap-2 border-t border-[var(--border)] px-5 py-3">
              <button
                type="button"
                className="rounded-lg px-3 py-2 text-sm text-[var(--accent)] hover:underline"
                onClick={() => setModal(null)}
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={saveMutation.isPending || !name.trim()}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
                onClick={() => saveMutation.mutate()}
              >
                {saveMutation.isPending ? 'Guardando…' : 'Guardar'}
              </button>
            </div>
          </div>
        </div></ModalPortal>
      )}
    </PanelShell>
  )
}
