import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'
import type {
  OnuProfile,
  OnuProfilesResponse,
  OnuType,
  OnuTypesResponse,
} from '../lib/onu-settings'
import { OnuConnectedPanel } from './OnuConnectedPanel'
import { OnuOrphansPanel } from './OnuOrphansPanel'
import { SettingsSubTabs } from './SettingsSubTabs'
import { ModalPortal } from './ModalPortal'

const inputClass =
  'w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 outline-none ring-[var(--accent)] focus:ring-2'

type SubView = 'connected' | 'types' | 'profiles' | 'orphans'
type TypeModal = 'create' | 'edit' | null

const ETH_OPTIONS = [0, 1, 2, 3, 4, 5, 6, 7, 8]
const WIFI_OPTIONS = [0, 1, 2, 3, 4, 5, 6, 7, 8]
const VOIP_OPTIONS = [0, 1, 2, 3, 4]

export function OnuSettingsTab({ canWrite }: { canWrite: boolean }) {
  const queryClient = useQueryClient()
  const [view, setView] = useState<SubView>('connected')
  const [typeModal, setTypeModal] = useState<TypeModal>(null)
  const [editing, setEditing] = useState<OnuType | null>(null)
  const [profileEdit, setProfileEdit] = useState<OnuProfile | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState('')

  const [ponType, setPonType] = useState<'gpon' | 'epon'>('gpon')
  const [channelGpon, setChannelGpon] = useState(true)
  const [channelXgpon, setChannelXgpon] = useState(false)
  const [channelXgspon, setChannelXgspon] = useState(false)
  const [name, setName] = useState('')
  const [ethernetPorts, setEthernetPorts] = useState(4)
  const [wifiSsids, setWifiSsids] = useState(0)
  const [voipPorts, setVoipPorts] = useState(0)
  const [catv, setCatv] = useState(false)
  const [allowCustomProfiles, setAllowCustomProfiles] = useState(true)
  const [defaultProfileId, setDefaultProfileId] = useState('')
  const [capability, setCapability] = useState<'bridging' | 'bridging_routing'>(
    'bridging_routing',
  )
  const [useDefaultImage, setUseDefaultImage] = useState(true)

  const [pName, setPName] = useState('')
  const [pDesc, setPDesc] = useState('')
  const [pVlanCli, setPVlanCli] = useState('')
  const [pPortKind, setPPortKind] = useState<'eth' | 'veip'>('eth')

  const typesQuery = useQuery({
    queryKey: ['app', 'settings', 'onus', 'types'],
    queryFn: () => apiFetch<OnuTypesResponse>('/app/settings/onus/types'),
    enabled: view === 'types' || typeModal != null,
  })

  const profilesQuery = useQuery({
    queryKey: ['app', 'settings', 'onus', 'profiles'],
    queryFn: () =>
      apiFetch<OnuProfilesResponse>('/app/settings/onus/profiles'),
  })

  function invalidate() {
    void queryClient.invalidateQueries({
      queryKey: ['app', 'settings', 'onus'],
    })
  }

  function resetTypeForm() {
    setPonType('gpon')
    setChannelGpon(true)
    setChannelXgpon(false)
    setChannelXgspon(false)
    setName('')
    setEthernetPorts(4)
    setWifiSsids(0)
    setVoipPorts(0)
    setCatv(false)
    setAllowCustomProfiles(true)
    setDefaultProfileId('')
    setCapability('bridging_routing')
    setUseDefaultImage(true)
    setDeleteConfirm('')
    setError(null)
  }

  function openCreate() {
    setEditing(null)
    resetTypeForm()
    setTypeModal('create')
  }

  function openEdit(t: OnuType) {
    setEditing(t)
    setPonType(t.ponType === 'epon' ? 'epon' : 'gpon')
    setChannelGpon(t.channelGpon)
    setChannelXgpon(t.channelXgpon)
    setChannelXgspon(t.channelXgspon)
    setName(t.name)
    setEthernetPorts(t.ethernetPorts)
    setWifiSsids(t.wifiSsids)
    setVoipPorts(t.voipPorts)
    setCatv(t.catv)
    setAllowCustomProfiles(t.allowCustomProfiles)
    setDefaultProfileId(t.defaultProfileId ?? '')
    setCapability(
      t.capability === 'bridging' ? 'bridging' : 'bridging_routing',
    )
    setUseDefaultImage(t.useDefaultImage)
    setDeleteConfirm('')
    setError(null)
    setTypeModal('edit')
  }

  function openProfileEdit(p: OnuProfile) {
    setProfileEdit(p)
    setPName(p.name)
    setPDesc(p.description)
    setPVlanCli(p.vlanCli)
    setPPortKind(p.portKind === 'veip' ? 'veip' : 'eth')
    setError(null)
  }

  const saveTypeMutation = useMutation({
    mutationFn: () => {
      const body = {
        ponType,
        channelGpon: ponType === 'gpon' ? channelGpon : false,
        channelXgpon: ponType === 'gpon' ? channelXgpon : false,
        channelXgspon: ponType === 'gpon' ? channelXgspon : false,
        name: name.trim(),
        ethernetPorts,
        wifiSsids,
        voipPorts,
        catv,
        allowCustomProfiles,
        defaultProfileId: defaultProfileId || null,
        capability,
        useDefaultImage,
      }
      if (typeModal === 'edit' && editing) {
        return apiFetch(`/app/settings/onus/types/${editing.id}`, {
          method: 'PATCH',
          body: JSON.stringify(body),
        })
      }
      return apiFetch('/app/settings/onus/types', {
        method: 'POST',
        body: JSON.stringify(body),
      })
    },
    onSuccess: () => {
      setMsg(typeModal === 'edit' ? 'Tipo actualizado' : 'Tipo creado')
      setTypeModal(null)
      invalidate()
    },
    onError: (e: Error) => setError(e.message),
  })

  const deleteTypeMutation = useMutation({
    mutationFn: () => {
      if (!editing) throw new Error('Sin tipo')
      return apiFetch(`/app/settings/onus/types/${editing.id}`, {
        method: 'DELETE',
      })
    },
    onSuccess: () => {
      setMsg('Tipo eliminado de tu empresa (el catálogo global no cambia)')
      setTypeModal(null)
      invalidate()
    },
    onError: (e: Error) => setError(e.message),
  })

  const saveProfileMutation = useMutation({
    mutationFn: () => {
      if (!profileEdit) throw new Error('Sin perfil')
      return apiFetch(`/app/settings/onus/profiles/${profileEdit.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: pName.trim(),
          description: pDesc,
          vlanCli: pVlanCli.trim(),
          portKind: pPortKind,
        }),
      })
    },
    onSuccess: () => {
      setMsg('Perfil actualizado')
      setProfileEdit(null)
      invalidate()
    },
    onError: (e: Error) => setError(e.message),
  })

  useEffect(() => {
    if (!msg) return
    const t = setTimeout(() => setMsg(null), 4000)
    return () => clearTimeout(t)
  }, [msg])

  const types = typesQuery.data?.types ?? []
  const profiles = profilesQuery.data?.profiles ?? []
  const deleteReady =
    editing != null && deleteConfirm.trim() === editing.name

  return (
    <div className="space-y-4">
      <SettingsSubTabs
        value={view}
        onChange={setView}
        tabs={
          [
            { id: 'connected', label: 'Conectadas' },
            { id: 'types', label: 'Tipos de ONU' },
            { id: 'profiles', label: 'Perfiles' },
            { id: 'orphans', label: 'Huérfanas' },
          ] as const
        }
      />

      {msg && <p className="text-sm text-emerald-500">{msg}</p>}

      {view === 'connected' && <OnuConnectedPanel canWrite={canWrite} />}

      {view === 'types' && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {canWrite && (
              <button
                type="button"
                onClick={openCreate}
                className="rounded-lg bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)]"
              >
                + Agregar tipo de ONU
              </button>
            )}
            <button
              type="button"
              disabled={typesQuery.isFetching}
              onClick={() => void typesQuery.refetch()}
              className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm hover:bg-[var(--bg)] disabled:opacity-60"
            >
              {typesQuery.isFetching ? 'Actualizando…' : 'Refrescar'}
            </button>
          </div>

          <p className="text-xs text-[var(--text-muted)]">
            Solo modelos detectados en tus ONUs importadas o que agregaste
            manualmente. Se limpia el catálogo residual no detectado al abrir
            esta vista.
          </p>

          {typesQuery.error && (
            <p className="text-sm text-[var(--danger)]">
              {typesQuery.error.message}
            </p>
          )}
          {typesQuery.isLoading && (
            <p className="text-sm text-[var(--text-muted)]">Cargando tipos…</p>
          )}

          {!typesQuery.isLoading && types.length === 0 && (
            <p className="rounded-lg border border-dashed border-[var(--border)] px-4 py-8 text-center text-sm text-[var(--text-muted)]">
              Aún no hay tipos. Se agregan al importar/sincronizar ONUs, o con
              «Agregar tipo» (ej. HG6243C, F660).
            </p>
          )}

          {types.length > 0 && (
            <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
              <table className="w-full min-w-[980px] text-left text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)] bg-[var(--bg-elevated)] text-[var(--text-muted)]">
                    <th className="px-3 py-2 font-medium">Foto</th>
                    <th className="px-3 py-2 font-medium">Fabricante</th>
                    <th className="px-3 py-2 font-medium">Tipo PON</th>
                    <th className="px-3 py-2 font-medium">Modelo</th>
                    <th className="px-3 py-2 font-medium">ONUs</th>
                    <th className="px-3 py-2 font-medium">ETH</th>
                    <th className="px-3 py-2 font-medium">WiFi</th>
                    <th className="px-3 py-2 font-medium">VoIP</th>
                    <th className="px-3 py-2 font-medium">CATV</th>
                    <th className="px-3 py-2 font-medium">Capacidad</th>
                    <th className="px-3 py-2 font-medium">Acción</th>
                  </tr>
                </thead>
                <tbody>
                  {types.map((t) => (
                    <tr
                      key={t.id}
                      className="border-b border-[var(--border)] last:border-0"
                    >
                      <td className="px-3 py-2">
                        <img
                          src={t.imageDisplayUrl || t.localImageUrl}
                          alt={t.name}
                          className="h-10 w-[96px] rounded object-contain bg-[var(--bg)]"
                        />
                      </td>
                      <td className="px-3 py-2.5">{t.vendorLabel}</td>
                      <td className="px-3 py-2.5">{t.ponTypeLabel}</td>
                      <td className="px-3 py-2.5">
                        <button
                          type="button"
                          className="font-medium text-[var(--accent)] hover:underline"
                          onClick={() => openEdit(t)}
                        >
                          {t.name}
                        </button>
                      </td>
                      <td className="px-3 py-2.5 font-medium">{t.onuCount}</td>
                      <td className="px-3 py-2.5">{t.ethernetPorts}</td>
                      <td className="px-3 py-2.5">{t.wifiSsids}</td>
                      <td className="px-3 py-2.5">{t.voipPorts}</td>
                      <td className="px-3 py-2.5">{t.catv ? 1 : 0}</td>
                      <td className="px-3 py-2.5">{t.capabilityLabel}</td>
                      <td className="px-3 py-2.5">
                        <button
                          type="button"
                          className="text-xs text-[var(--accent)] hover:underline"
                          onClick={() => openEdit(t)}
                        >
                          Editar
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {view === 'profiles' && (
        <div className="space-y-4">
          <p className="text-sm text-[var(--text-muted)]">
            Perfiles Generic_1…6: definen cómo se aplica la VLAN en la ONU
            (`eth_0/x` vs `veip_1`).
          </p>
          {profilesQuery.isLoading && (
            <p className="text-sm text-[var(--text-muted)]">
              Cargando perfiles…
            </p>
          )}
          {profilesQuery.error && (
            <p className="text-sm text-[var(--danger)]">
              {profilesQuery.error.message}
            </p>
          )}
          <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] bg-[var(--bg-elevated)] text-[var(--text-muted)]">
                  <th className="px-3 py-2 font-medium">Perfil</th>
                  <th className="px-3 py-2 font-medium">Puerto</th>
                  <th className="px-3 py-2 font-medium">CLI VLAN</th>
                  <th className="px-3 py-2 font-medium">Descripción</th>
                  <th className="px-3 py-2 font-medium">Acción</th>
                </tr>
              </thead>
              <tbody>
                {profiles.map((p) => (
                  <tr
                    key={p.id}
                    className="border-b border-[var(--border)] last:border-0"
                  >
                    <td className="px-3 py-2.5 font-medium">{p.name}</td>
                    <td className="px-3 py-2.5 uppercase">{p.portKind}</td>
                    <td className="px-3 py-2.5 font-mono text-xs">
                      {p.vlanCli}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-[var(--text-muted)]">
                      {p.description}
                    </td>
                    <td className="px-3 py-2.5">
                      {canWrite && (
                        <button
                          type="button"
                          className="text-xs text-[var(--accent)] hover:underline"
                          onClick={() => openProfileEdit(p)}
                        >
                          Editar
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {view === 'orphans' && <OnuOrphansPanel canWrite={canWrite} />}

      {typeModal && (
        <ModalPortal><div className="fixed inset-0 z-[80] modal-backdrop flex items-stretch justify-center overflow-hidden bg-black/60 sm:items-center sm:p-4">
          <div className="h-[100dvh] max-h-[100dvh] overflow-y-auto overscroll-contain w-full max-w-lg rounded-none border-0 sm:h-auto sm:max-h-[min(92dvh,920px)] sm:rounded-xl sm:border border-[var(--border)] bg-[var(--bg-elevated)] shadow-xl">
            <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
              <h3 className="text-lg font-semibold">
                {typeModal === 'create'
                  ? 'Agregar tipo de ONU'
                  : 'Editar tipo de ONU'}
              </h3>
              <button
                type="button"
                className="rounded-md px-2 py-1 text-[var(--text-muted)] hover:bg-[var(--bg)]"
                onClick={() => setTypeModal(null)}
              >
                ✕
              </button>
            </div>

            <div className="max-h-[70vh] space-y-4 overflow-y-auto px-5 py-4 text-sm">
              <fieldset>
                <legend className="mb-2 text-[var(--text-muted)]">
                  Tipo PON
                </legend>
                <div className="flex gap-4">
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      checked={ponType === 'gpon'}
                      onChange={() => {
                        setPonType('gpon')
                        setChannelGpon(true)
                      }}
                      disabled={!canWrite}
                    />
                    GPON
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      checked={ponType === 'epon'}
                      onChange={() => setPonType('epon')}
                      disabled={!canWrite}
                    />
                    EPON
                  </label>
                </div>
              </fieldset>

              {ponType === 'gpon' && (
                <fieldset>
                  <legend className="mb-2 text-[var(--text-muted)]">
                    Canales GPON
                  </legend>
                  <div className="flex flex-wrap gap-4">
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={channelGpon}
                        onChange={(e) => setChannelGpon(e.target.checked)}
                        disabled={!canWrite}
                      />
                      GPON
                    </label>
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={channelXgpon}
                        onChange={(e) => setChannelXgpon(e.target.checked)}
                        disabled={!canWrite}
                      />
                      XG-PON
                    </label>
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={channelXgspon}
                        onChange={(e) => setChannelXgspon(e.target.checked)}
                        disabled={!canWrite}
                      />
                      XGS-PON
                    </label>
                  </div>
                </fieldset>
              )}

              <label className="block">
                <span className="mb-1 block text-[var(--text-muted)]">
                  Código de modelo
                </span>
                <input
                  className={inputClass}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="ej. HG6243C / F660"
                  disabled={!canWrite}
                />
              </label>

              <div className="grid gap-3 sm:grid-cols-3">
                <label className="block">
                  <span className="mb-1 block text-[var(--text-muted)]">
                    ETH
                  </span>
                  <select
                    className={inputClass}
                    value={ethernetPorts}
                    onChange={(e) => setEthernetPorts(Number(e.target.value))}
                    disabled={!canWrite}
                  >
                    {ETH_OPTIONS.map((n) => (
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
                    disabled={!canWrite}
                  >
                    {WIFI_OPTIONS.map((n) => (
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
                    disabled={!canWrite}
                  >
                    {VOIP_OPTIONS.map((n) => (
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
                  disabled={!canWrite}
                />
                CATV
              </label>

              <label className="block">
                <span className="mb-1 block text-[var(--text-muted)]">
                  Capacidad
                </span>
                <select
                  className={inputClass}
                  value={capability}
                  onChange={(e) =>
                    setCapability(
                      e.target.value === 'bridging'
                        ? 'bridging'
                        : 'bridging_routing',
                    )
                  }
                  disabled={!canWrite}
                >
                  <option value="bridging">Bridging</option>
                  <option value="bridging_routing">Bridging/Routing</option>
                </select>
              </label>

              <label className="block">
                <span className="mb-1 block text-[var(--text-muted)]">
                  Perfil por defecto
                </span>
                <select
                  className={inputClass}
                  value={defaultProfileId}
                  onChange={(e) => setDefaultProfileId(e.target.value)}
                  disabled={!canWrite}
                >
                  <option value="">Ninguno</option>
                  {profiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={allowCustomProfiles}
                  onChange={(e) => setAllowCustomProfiles(e.target.checked)}
                  disabled={!canWrite}
                />
                Permitir perfiles personalizados
              </label>

              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={useDefaultImage}
                  onChange={(e) => setUseDefaultImage(e.target.checked)}
                  disabled={!canWrite}
                />
                Usar imagen por defecto
              </label>

              {typeModal === 'edit' && canWrite && (
                <div className="rounded-lg border border-[var(--danger)]/40 bg-[var(--danger)]/5 p-3">
                  <p className="mb-2 text-xs text-[var(--text-muted)]">
                    Eliminar solo de tu empresa. Escribe el nombre del modelo
                    para confirmar.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <input
                      className={`${inputClass} max-w-[200px]`}
                      value={deleteConfirm}
                      onChange={(e) => setDeleteConfirm(e.target.value)}
                      placeholder={editing?.name}
                    />
                    <button
                      type="button"
                      disabled={!deleteReady || deleteTypeMutation.isPending}
                      className="rounded-lg bg-[var(--danger)] px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                      onClick={() => deleteTypeMutation.mutate()}
                    >
                      {deleteTypeMutation.isPending
                        ? 'Eliminando…'
                        : 'Eliminar'}
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
                onClick={() => setTypeModal(null)}
              >
                Cancelar
              </button>
              {canWrite && (
                <button
                  type="button"
                  disabled={saveTypeMutation.isPending || !name.trim()}
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-60"
                  onClick={() => saveTypeMutation.mutate()}
                >
                  {saveTypeMutation.isPending ? 'Guardando…' : 'Guardar'}
                </button>
              )}
            </div>
          </div>
        </div></ModalPortal>
      )}

      {profileEdit && (
        <ModalPortal><div className="fixed inset-0 z-[80] modal-backdrop flex items-stretch justify-center overflow-hidden bg-black/60 sm:items-center sm:p-4">
          <div className="h-[100dvh] max-h-[100dvh] overflow-y-auto overscroll-contain w-full max-w-md rounded-none border-0 sm:h-auto sm:max-h-[min(92dvh,920px)] sm:rounded-xl sm:border border-[var(--border)] bg-[var(--bg-elevated)] shadow-xl">
            <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
              <h3 className="text-lg font-semibold">
                Editar perfil {profileEdit.name}
              </h3>
              <button
                type="button"
                className="rounded-md px-2 py-1 text-[var(--text-muted)] hover:bg-[var(--bg)]"
                onClick={() => setProfileEdit(null)}
              >
                ✕
              </button>
            </div>
            <div className="space-y-3 px-5 py-4 text-sm">
              <label className="block">
                <span className="mb-1 block text-[var(--text-muted)]">
                  Nombre
                </span>
                <input
                  className={inputClass}
                  value={pName}
                  onChange={(e) => setPName(e.target.value)}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-[var(--text-muted)]">
                  CLI VLAN
                </span>
                <input
                  className={inputClass}
                  value={pVlanCli}
                  onChange={(e) => setPVlanCli(e.target.value)}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-[var(--text-muted)]">
                  Tipo de puerto
                </span>
                <select
                  className={inputClass}
                  value={pPortKind}
                  onChange={(e) =>
                    setPPortKind(e.target.value === 'veip' ? 'veip' : 'eth')
                  }
                >
                  <option value="eth">eth</option>
                  <option value="veip">veip</option>
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-[var(--text-muted)]">
                  Descripción
                </span>
                <textarea
                  className={inputClass}
                  rows={3}
                  value={pDesc}
                  onChange={(e) => setPDesc(e.target.value)}
                />
              </label>
              {error && (
                <p className="text-sm text-[var(--danger)]">{error}</p>
              )}
            </div>
            <div className="flex justify-end gap-2 border-t border-[var(--border)] px-5 py-3">
              <button
                type="button"
                className="rounded-lg px-3 py-2 text-sm text-[var(--accent)] hover:underline"
                onClick={() => setProfileEdit(null)}
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={saveProfileMutation.isPending}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-60"
                onClick={() => saveProfileMutation.mutate()}
              >
                {saveProfileMutation.isPending ? 'Guardando…' : 'Guardar'}
              </button>
            </div>
          </div>
        </div></ModalPortal>
      )}
    </div>
  )
}
