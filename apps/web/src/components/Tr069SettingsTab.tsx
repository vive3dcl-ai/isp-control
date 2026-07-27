import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'
import type { Tr069Profile, Tr069ProfilesResponse } from '../lib/tr069'
import type { TopologyDevice } from '../lib/topology'
import { Tr069StatusView } from './Tr069StatusView'
import { useNotify } from './NotifyProvider'
import { SettingsSubTabs } from './SettingsSubTabs'

const inputClass =
  'w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 outline-none ring-[var(--accent)] focus:ring-2'

type Modal = 'create' | 'view' | 'olts' | null
type Tr069View = 'profiles' | 'status'

export function Tr069SettingsTab({ canWrite }: { canWrite: boolean }) {
  const queryClient = useQueryClient()
  const { confirm } = useNotify()
  const [view, setView] = useState<Tr069View>('status')
  const [infoOpen, setInfoOpen] = useState(false)
  const [profilesOpen, setProfilesOpen] = useState(true)
  const [modal, setModal] = useState<Modal>(null)
  const [selected, setSelected] = useState<Tr069Profile | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [name, setName] = useState('ISP Control')
  const [acsUrl, setAcsUrl] = useState('')
  const [viewDraft, setViewDraft] = useState<Partial<Tr069Profile> | null>(
    null,
  )
  const [oltSelection, setOltSelection] = useState<string[]>([])

  const profilesQuery = useQuery({
    queryKey: ['app', 'settings', 'tr069', 'profiles'],
    queryFn: () =>
      apiFetch<Tr069ProfilesResponse>('/app/settings/tr069/profiles'),
    enabled: view === 'profiles' || modal !== null,
  })

  const topologyQuery = useQuery({
    queryKey: ['app', 'topology'],
    queryFn: () =>
      apiFetch<{ devices: TopologyDevice[] }>('/app/topology'),
    enabled: modal === 'olts',
  })

  const olts = useMemo(
    () =>
      (topologyQuery.data?.devices ?? []).filter(
        (d) => d.type === 'olt' && d.isActive,
      ),
    [topologyQuery.data?.devices],
  )

  const createMutation = useMutation({
    mutationFn: () =>
      apiFetch<Tr069Profile>('/app/settings/tr069/profiles', {
        method: 'POST',
        body: JSON.stringify({
          name: name.trim() || undefined,
          acsUrl: acsUrl.trim() || undefined,
        }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ['app', 'settings', 'tr069'],
      })
      setModal(null)
      setError(null)
      setName('ISP Control')
      setAcsUrl('')
    },
    onError: (e: Error) => setError(e.message),
  })

  const updateMutation = useMutation({
    mutationFn: () => {
      if (!selected || !viewDraft) throw new Error('Sin perfil')
      return apiFetch<Tr069Profile>(
        `/app/settings/tr069/profiles/${selected.id}`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            name: viewDraft.name,
            acsUrl: viewDraft.acsUrl,
            acsPort: viewDraft.acsPort,
            acsUsername: viewDraft.acsUsername,
            acsPassword: viewDraft.acsPassword,
            connectionRequestUsername: viewDraft.connectionRequestUsername,
            connectionRequestPassword: viewDraft.connectionRequestPassword,
            periodicInformEnable: viewDraft.periodicInformEnable,
            periodicInformInterval: viewDraft.periodicInformInterval,
          }),
        },
      )
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ['app', 'settings', 'tr069'],
      })
      setModal(null)
      setSelected(null)
      setViewDraft(null)
      setError(null)
    },
    onError: (e: Error) => setError(e.message),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/app/settings/tr069/profiles/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ['app', 'settings', 'tr069'],
      })
    },
    onError: (e: Error) => setError(e.message),
  })

  const setOltsMutation = useMutation({
    mutationFn: () => {
      if (!selected) throw new Error('Sin perfil')
      return apiFetch<Tr069Profile>(
        `/app/settings/tr069/profiles/${selected.id}/olts`,
        {
          method: 'PUT',
          body: JSON.stringify({ deviceIds: oltSelection }),
        },
      )
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ['app', 'settings', 'tr069'],
      })
      setModal(null)
      setSelected(null)
      setError(null)
    },
    onError: (e: Error) => setError(e.message),
  })

  const profiles = profilesQuery.data?.profiles ?? []

  function openCreate() {
    setError(null)
    setName('ISP Control')
    setAcsUrl('')
    setModal('create')
  }

  function openView(p: Tr069Profile) {
    setError(null)
    setSelected(p)
    setViewDraft({ ...p })
    setModal('view')
  }

  function openOlts(p: Tr069Profile) {
    setError(null)
    setSelected(p)
    setOltSelection([...p.oltIds])
    setModal('olts')
  }

  function onDelete(p: Tr069Profile) {
    void confirm(`¿Eliminar el perfil "${p.name}"?`, {
      title: 'Eliminar perfil TR069',
      danger: true,
      confirmLabel: 'Eliminar',
    }).then((ok) => {
      if (ok) deleteMutation.mutate(p.id)
    })
  }

  return (
    <div className="space-y-3">
      <SettingsSubTabs
        aria-label="Vista TR069"
        value={view}
        onChange={setView}
        tabs={
          [
            { id: 'status', label: 'Status' },
            { id: 'profiles', label: 'Profiles' },
          ] as const
        }
      />

      {error && !modal && (
        <p className="text-sm text-[var(--danger)]">{error}</p>
      )}
      {view === 'profiles' && profilesQuery.error && (
        <p className="text-sm text-[var(--danger)]">
          {profilesQuery.error.message}
        </p>
      )}

      <section className="overflow-hidden rounded-xl border border-[var(--border)]">
        <button
          type="button"
          className="flex w-full items-center justify-between bg-[var(--bg-elevated)] px-4 py-3 text-left text-sm font-semibold"
          onClick={() => setInfoOpen((v) => !v)}
        >
          <span>Info</span>
          <span className="text-[var(--text-muted)]">
            {infoOpen ? '▾' : '▸'}
          </span>
        </button>
        {infoOpen && (
          <div className="space-y-3 border-t border-[var(--border)] bg-[var(--bg)] px-4 py-4 text-sm leading-relaxed text-[var(--text-muted)]">
            <p>
              Para usar el protocolo TR069 en tu red debes tener un túnel VPN
              configurado y un perfil TR069 definido y adjunto a cada OLT donde
              quieras este servicio disponible.
            </p>
            <p>
              En cada ONU debes aplicar el perfil TR069 en ISP Control para
              activar TR069. El perfil contiene solo la información mínima
              requerida y autocompletamos el formulario con la configuración
              recomendada, para que sea lo más sencillo posible.
            </p>
            <p className="text-xs">
              Crea el túnel en Topología → VPN. En modo concentrador el ACS
              suele ir en la IP del peer (.1). En modo inverso lab (MikroTik
              servidor / ACS local cliente) usamos la IP del cliente del túnel
              (p. ej. http://10.69.x.2:14501). Status sondea CWMP (TCP); NBI/FS
              e inventario ONU se llenan cuando GenieACS esté integrado.
            </p>
          </div>
        )}
      </section>

      {view === 'status' && <Tr069StatusView />}

      {view === 'profiles' && (
        <section className="overflow-hidden rounded-xl border border-[var(--border)]">
          <button
            type="button"
            className="flex w-full items-center justify-between bg-[var(--bg-elevated)] px-4 py-3 text-left text-sm font-semibold"
            onClick={() => setProfilesOpen((v) => !v)}
          >
            <span>Defined profiles</span>
            <span className="text-[var(--text-muted)]">
              {profilesOpen ? '▾' : '▸'}
            </span>
          </button>
          {profilesOpen && (
            <div className="border-t border-[var(--border)] bg-[var(--bg)] px-4 py-4">
              {profilesQuery.isLoading && (
                <p className="text-sm text-[var(--text-muted)]">Cargando…</p>
              )}
              {!profilesQuery.isLoading && profiles.length === 0 && (
                <p className="mb-4 rounded-lg border border-dashed border-[var(--border)] px-4 py-8 text-center text-sm text-[var(--text-muted)]">
                  No hay perfiles. Crea el primero con Add a new profile.
                </p>
              )}
              {profiles.length > 0 && (
                <div className="mb-4 overflow-x-auto">
                  <table className="w-full min-w-[720px] text-left text-sm">
                    <thead>
                      <tr className="border-b border-[var(--border)] text-[var(--text-muted)]">
                        <th className="px-2 py-2 font-medium">Profile name</th>
                        <th className="px-2 py-2 font-medium">CWMP ACS</th>
                        <th className="px-2 py-2 font-medium">Status</th>
                        <th className="px-2 py-2 font-medium">OLTs</th>
                        <th className="px-2 py-2 font-medium">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {profiles.map((p) => (
                        <tr
                          key={p.id}
                          className="border-b border-[var(--border)] last:border-0"
                        >
                          <td className="px-2 py-3 font-medium">{p.name}</td>
                          <td className="px-2 py-3 font-mono text-xs">
                            {p.acsUrl}
                          </td>
                          <td className="px-2 py-3">
                            <span className="inline-flex items-center gap-1.5 text-xs">
                              CWMP:
                              <span
                                className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-[var(--danger)] text-[10px] font-bold text-white"
                                title="ACS offline (pendiente)"
                              >
                                ✕
                              </span>
                            </span>
                          </td>
                          <td className="px-2 py-3">
                            {p.olts.length === 0 ? (
                              <span className="text-xs text-[var(--text-muted)]">
                                —
                              </span>
                            ) : (
                              <select
                                className="max-w-[160px] rounded border border-[var(--border)] bg-[var(--bg-elevated)] px-2 py-1 text-xs"
                                defaultValue={p.olts[0]?.id}
                                aria-label="OLTs adjuntas"
                              >
                                {p.olts.map((o, i) => (
                                  <option key={o.id} value={o.id}>
                                    {i + 1} - {o.name}
                                  </option>
                                ))}
                              </select>
                            )}
                          </td>
                          <td className="px-2 py-3">
                            <div className="flex flex-wrap gap-1">
                              {canWrite && (
                                <button
                                  type="button"
                                  className="rounded border border-[var(--border)] px-2 py-1 text-xs hover:bg-[var(--bg-elevated)]"
                                  onClick={() => openOlts(p)}
                                >
                                  Set OLTs
                                </button>
                              )}
                              <button
                                type="button"
                                className="rounded bg-[var(--accent)] px-2 py-1 text-xs font-medium text-white"
                                onClick={() => openView(p)}
                              >
                                View
                              </button>
                              <button
                                type="button"
                                disabled
                                title="Próximamente"
                                className="rounded border border-[var(--border)] px-2 py-1 text-xs opacity-50"
                              >
                                Files
                              </button>
                              {canWrite && (
                                <button
                                  type="button"
                                  className="rounded bg-[var(--danger)] px-2 py-1 text-xs font-medium text-white"
                                  onClick={() => onDelete(p)}
                                  disabled={deleteMutation.isPending}
                                >
                                  Del
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {canWrite && (
                <button
                  type="button"
                  onClick={openCreate}
                  className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)]"
                >
                  Add a new profile
                </button>
              )}
            </div>
          )}
        </section>
      )}

      {modal && (
        <div className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-black/60 p-4 sm:items-center">
          <div
            role="dialog"
            aria-modal="true"
            className="max-h-[min(92vh,100dvh)] overflow-y-auto w-full max-w-lg rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] shadow-xl"
          >
            <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
              <h3 className="text-lg font-semibold">
                {modal === 'create' && 'Add TR069 profile'}
                {modal === 'view' && `Profile: ${selected?.name}`}
                {modal === 'olts' && `Set OLTs — ${selected?.name}`}
              </h3>
              <button
                type="button"
                className="rounded-md px-2 py-1 text-[var(--text-muted)] hover:bg-[var(--bg)]"
                onClick={() => {
                  setModal(null)
                  setError(null)
                }}
              >
                ✕
              </button>
            </div>
            <div className="space-y-3 px-5 py-4">
              {error && (
                <p className="text-sm text-[var(--danger)]">{error}</p>
              )}

              {modal === 'create' && (
                <>
                  <p className="text-sm text-[var(--text-muted)]">
                    Autocompletamos ACS URL desde el túnel VPN (inverso →
                    http://10.69.x.2:14501; concentrador → .1) y generamos
                    credenciales recomendadas. Puedes sobrescribir la URL si
                    hace falta.
                  </p>
                  <label className="block text-sm">
                    <span className="mb-1 block text-[var(--text-muted)]">
                      Profile name
                    </span>
                    <input
                      className={inputClass}
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="mb-1 block text-[var(--text-muted)]">
                      CWMP ACS URL (opcional)
                    </span>
                    <input
                      className={inputClass}
                      value={acsUrl}
                      onChange={(e) => setAcsUrl(e.target.value)}
                      placeholder="http://10.69.x.1:14501"
                    />
                  </label>
                </>
              )}

              {modal === 'view' && viewDraft && (
                <div className="grid gap-3 sm:grid-cols-2">
                  {(
                    [
                      ['name', 'Profile name'],
                      ['acsUrl', 'ManagementServer.URL'],
                      ['acsUsername', 'ACS Username'],
                      ['acsPassword', 'ACS Password'],
                      [
                        'connectionRequestUsername',
                        'ConnectionRequest Username',
                      ],
                      [
                        'connectionRequestPassword',
                        'ConnectionRequest Password',
                      ],
                      ['periodicInformInterval', 'PeriodicInformInterval (s)'],
                    ] as const
                  ).map(([key, label]) => (
                    <label
                      key={key}
                      className={`block text-sm ${key === 'acsUrl' || key === 'name' ? 'sm:col-span-2' : ''}`}
                    >
                      <span className="mb-1 block text-[var(--text-muted)]">
                        {label}
                      </span>
                      <input
                        className={inputClass}
                        type="text"
                        value={String(viewDraft[key] ?? '')}
                        disabled={!canWrite}
                        onChange={(e) => {
                          const raw = e.target.value
                          setViewDraft((d) =>
                            d
                              ? {
                                  ...d,
                                  [key]:
                                    key === 'periodicInformInterval'
                                      ? Number(raw) || 300
                                      : raw,
                                }
                              : d,
                          )
                        }}
                      />
                    </label>
                  ))}
                  <label className="flex items-center gap-2 text-sm sm:col-span-2">
                    <input
                      type="checkbox"
                      checked={!!viewDraft.periodicInformEnable}
                      disabled={!canWrite}
                      onChange={(e) =>
                        setViewDraft((d) =>
                          d
                            ? {
                                ...d,
                                periodicInformEnable: e.target.checked,
                              }
                            : d,
                        )
                      }
                    />
                    PeriodicInformEnable
                  </label>
                </div>
              )}

              {modal === 'olts' && (
                <>
                  <p className="text-sm text-[var(--text-muted)]">
                    Selecciona las OLTs donde este perfil estará disponible.
                  </p>
                  {topologyQuery.isLoading && (
                    <p className="text-sm text-[var(--text-muted)]">
                      Cargando OLTs…
                    </p>
                  )}
                  {olts.length === 0 && !topologyQuery.isLoading && (
                    <p className="text-sm text-[var(--text-muted)]">
                      No hay OLTs en Topología.
                    </p>
                  )}
                  <ul className="max-h-64 space-y-2 overflow-y-auto">
                    {olts.map((d) => {
                      const checked = oltSelection.includes(d.id)
                      return (
                        <li key={d.id}>
                          <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-2 text-sm hover:bg-[var(--bg)]">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => {
                                setOltSelection((prev) =>
                                  checked
                                    ? prev.filter((id) => id !== d.id)
                                    : [...prev, d.id],
                                )
                              }}
                            />
                            <span>{d.name}</span>
                            {d.mgmtHost && (
                              <span className="text-xs text-[var(--text-muted)]">
                                {d.mgmtHost}
                              </span>
                            )}
                          </label>
                        </li>
                      )
                    })}
                  </ul>
                </>
              )}
            </div>
            <div className="flex justify-end gap-2 border-t border-[var(--border)] px-5 py-3">
              <button
                type="button"
                className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm"
                onClick={() => {
                  setModal(null)
                  setError(null)
                }}
              >
                Cancelar
              </button>
              {modal === 'create' && canWrite && (
                <button
                  type="button"
                  className="rounded-lg bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                  disabled={createMutation.isPending}
                  onClick={() => createMutation.mutate()}
                >
                  {createMutation.isPending ? 'Creando…' : 'Crear'}
                </button>
              )}
              {modal === 'view' && canWrite && (
                <button
                  type="button"
                  className="rounded-lg bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                  disabled={updateMutation.isPending}
                  onClick={() => updateMutation.mutate()}
                >
                  {updateMutation.isPending ? 'Guardando…' : 'Guardar'}
                </button>
              )}
              {modal === 'olts' && canWrite && (
                <button
                  type="button"
                  className="rounded-lg bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                  disabled={setOltsMutation.isPending}
                  onClick={() => setOltsMutation.mutate()}
                >
                  {setOltsMutation.isPending ? 'Guardando…' : 'Guardar OLTs'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
